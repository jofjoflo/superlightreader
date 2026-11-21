#!/usr/bin/env python3
"""
AVIF-CBZ Converter
Converts image folders and comic archives (CBZ/CBR) to AVIF and packages them into CBZ files.

Batch mode converts every .cbz/.cbr directly inside one folder:
    MAPP/avif/      AVIF versions (same name, .cbz)
    MAPP/notavif/   the originals, moved here after a successful conversion
"""

import argparse
import contextlib
import io
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple, Union

try:
    import rarfile  # For CBR support
    CBR_SUPPORT = True

    # Configure rarfile to use WinRAR's UnRAR.exe
    winrar_path = r"C:\Program Files\WinRAR\UnRAR.exe"
    if os.path.exists(winrar_path):
        rarfile.UNRAR_TOOL = winrar_path
        print(f"🔧 Configured rarfile to use: {winrar_path}")
    else:
        # Try alternative paths
        alt_paths = [
            r"C:\Program Files (x86)\WinRAR\UnRAR.exe",
            r"C:\Program Files\WinRAR\unrar.exe",
            r"C:\Program Files (x86)\WinRAR\unrar.exe"
        ]
        for path in alt_paths:
            if os.path.exists(path):
                rarfile.UNRAR_TOOL = path
                print(f"🔧 Configured rarfile to use: {path}")
                break

except ImportError:
    CBR_SUPPORT = False

try:
    from PIL import Image
    import pillow_avif  # registers AVIF support
except ImportError:
    print("Error: Missing required dependencies. Please install:")
    print("pip install Pillow>=10 pillow-avif-plugin tqdm")
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    # Fallback if tqdm is not available
    def tqdm(iterable, **kwargs):
        return iterable


IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}
COMIC_EXTENSIONS = {'.cbz', '.cbr'}
AVIF_DIR = 'avif'          # batch: converted files
ORIGINAL_DIR = 'notavif'   # batch: originals
BATCH_MAX_WIDTH = 1400     # batch default: sharp enough for a tablet, much smaller files (0 = keep size)


def validate_avif_support() -> bool:
    """True if Pillow can actually encode AVIF (encodes a 1x1 test image)."""
    try:
        buf = io.BytesIO()
        Image.new('RGB', (1, 1)).save(buf, format='AVIF')
        return len(buf.getvalue()) > 0
    except Exception as e:
        print(f"AVIF validation failed: {e}")
        return False


# ───────────────────────── names and archive entries ─────────────────────────

def _natural_key(name: str) -> list:
    """Sort key so that 'page2' comes before 'page10'."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', name)]


def _is_safe(name: str) -> bool:
    """Archive entry without absolute paths, '..' or __MACOSX/ (Mac resource forks)."""
    parts = name.replace('\\', '/').split('/')
    return parts[0] not in ('', '__MACOSX') and '..' not in parts


def _is_page(name: str) -> bool:
    """Image entry that belongs to the comic (not ._resource forks, .DS_Store or directories)."""
    parts = name.replace('\\', '/').split('/')
    return (_is_safe(name) and not parts[-1].startswith('.')
            and pathlib.PurePosixPath(parts[-1]).suffix.lower() in IMAGE_EXTENSIONS)


def _ordered_pages(names: Sequence[str]) -> List[str]:
    return sorted((n for n in names if _is_page(n)), key=_natural_key)


def _find_comicinfo(names: Sequence[str]) -> Optional[str]:
    """The shallowest ComicInfo.xml entry (any letter case), or None."""
    hits = [n for n in names if _is_safe(n)
            and pathlib.PurePosixPath(n.replace('\\', '/')).name.lower() == 'comicinfo.xml']
    return min(hits, key=lambda n: (n.count('/'), n)) if hits else None


def to_avif(
    src_img: pathlib.Path,
    tmp_dir: pathlib.Path,
    quality: int,
    max_width: Optional[int],
    max_height: Optional[int],
    lossless: bool = False,
    out_stem: Optional[str] = None
) -> pathlib.Path:
    """Convert a single image to AVIF format."""
    try:
        with Image.open(src_img) as im:
            # Convert to RGB to ensure compatibility
            if im.mode != 'RGB':
                im = im.convert('RGB')

            # Apply size constraints if specified
            if max_width or max_height:
                original_size = im.size
                im.thumbnail((max_width or im.width, max_height or im.height), Image.Resampling.LANCZOS)
                if im.size != original_size:
                    print(f"  Resized {src_img.name}: {original_size} → {im.size}")

            # Generate output path with proper naming
            out_path = tmp_dir / ((out_stem or src_img.stem) + ".avif")

            # Save as AVIF
            save_kwargs = {'format': 'AVIF'}
            if lossless:
                save_kwargs['lossless'] = True
            else:
                save_kwargs['quality'] = quality

            im.save(out_path, **save_kwargs)
            return out_path

    except Exception as e:
        print(f"Error converting {src_img.name}: {e}")
        raise


# ───────────────────────── extraction ─────────────────────────

def extract_cbz_images(cbz_path: pathlib.Path, extract_dir: pathlib.Path) -> Tuple[List[pathlib.Path], Optional[bytes]]:
    """Extract the page images of a CBZ. Returns (pages in reading order, ComicInfo.xml bytes or None)."""
    try:
        with zipfile.ZipFile(cbz_path, 'r') as cbz:
            names = cbz.namelist()
            pages = []
            for idx, name in enumerate(_ordered_pages(names)):
                # Index-based file names: archives may hold the same base name in several folders
                target = extract_dir / f"{idx:05d}{pathlib.PurePosixPath(name).suffix.lower()}"
                with cbz.open(name) as source, open(target, 'wb') as dest:
                    shutil.copyfileobj(source, dest)
                pages.append(target)
            info = _find_comicinfo(names)
            return pages, (cbz.read(info) if info else None)
    except zipfile.BadZipFile:
        raise ValueError(f"Ogiltig CBZ-fil (trasig eller inte en zip-fil): {cbz_path.name}")


def _extract_rar(rar_path: pathlib.Path, dest: pathlib.Path, wanted: Sequence[str]) -> None:
    """Unpack RAR members into dest.

    bsdtar (built into macOS, included in Windows 10+) unpacks everything in one pass. rarfile's own
    extraction starts the RAR tool once per member, which rereads the whole archive every time.
    """
    dest.mkdir(parents=True, exist_ok=True)
    bsdtar = shutil.which('bsdtar')
    if bsdtar:
        result = subprocess.run([bsdtar, '-x', '-f', str(rar_path), '-C', str(dest)],
                                capture_output=True)
        if result.returncode != 0:
            detail = result.stderr.decode('utf-8', 'replace').strip() or 'okänt fel'
            raise ValueError(f"Kunde inte packa upp {rar_path.name}: {detail}")
        return
    # Slow fallback (unrar, unar or 7z through rarfile)
    with rarfile.RarFile(rar_path, 'r') as rar:
        for name in wanted:
            rar.extract(name, path=str(dest))


def extract_cbr_images(cbr_path: pathlib.Path, extract_dir: pathlib.Path) -> Tuple[List[pathlib.Path], Optional[bytes]]:
    """Extract the page images of a CBR (RAR). Returns (pages in reading order, ComicInfo.xml bytes or None)."""
    if not CBR_SUPPORT:
        raise ValueError("CBR support not available. Install rarfile: pip install rarfile")

    try:
        with rarfile.RarFile(cbr_path, 'r') as rar:  # reads headers only
            names = [info.filename for info in rar.infolist() if not info.is_dir()]
        pages = _ordered_pages(names)
        info_name = _find_comicinfo(names)
        staging = extract_dir / 'rar'
        _extract_rar(cbr_path, staging, pages + ([info_name] if info_name else []))
        comicinfo = (staging / info_name).read_bytes() if info_name else None
        return [staging / name for name in pages], comicinfo

    except rarfile.NeedFirstVolume:
        raise ValueError(f"CBR file {cbr_path.name} appears to be part of a multi-volume archive. Please provide the first volume.")
    except rarfile.BadRarFile:
        raise ValueError(f"Invalid or corrupted CBR file: {cbr_path.name}")
    except rarfile.RarCannotExec as e:
        raise ValueError(f"Cannot extract CBR files: no RAR tool found (bsdtar, unar, unrar or 7z). {e}")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Unexpected error extracting CBR file {cbr_path.name}: {e}")


def get_image_files(src_dir: pathlib.Path) -> List[pathlib.Path]:
    """Image files directly in src_dir, in reading order."""
    files = [p for p in src_dir.iterdir()
             if p.is_file() and not p.name.startswith('.') and p.suffix.lower() in IMAGE_EXTENSIONS]
    return sorted(files, key=lambda p: _natural_key(p.name))


def _read_dir_comicinfo(src_dir: pathlib.Path) -> Optional[bytes]:
    for p in src_dir.iterdir():
        if p.is_file() and p.name.lower() == 'comicinfo.xml':
            return p.read_bytes()
    return None


# ───────────────────────── conversion ─────────────────────────

def create_cbz(
    src: Union[pathlib.Path, str],
    dst_path: pathlib.Path,
    quality: int = 40,
    max_width: Optional[int] = None,
    max_height: Optional[int] = None,
    lossless: bool = False,
    *,
    strict: bool = False,
    keep_comicinfo: bool = True
) -> int:
    """Convert images to AVIF and create a CBZ archive. Returns the number of pages written.

    Args:
        src: Source directory containing images, or a .cbz/.cbr file
        dst_path: Output CBZ file path
        quality: AVIF quality (1-100)
        max_width: Maximum width for resizing
        max_height: Maximum height for resizing
        lossless: Use lossless AVIF encoding
        strict: Fail if any page cannot be converted (otherwise that page is skipped)
        keep_comicinfo: Copy ComicInfo.xml when every page was converted
    """
    src_path = pathlib.Path(src)

    if src_path.is_file():
        file_ext = src_path.suffix.lower()
        if file_ext not in COMIC_EXTENSIONS:
            raise ValueError(f"Unsupported file format: {file_ext}. Supported: .cbz, .cbr")
        kind = file_ext[1:].upper()
        print(f"Converting existing {kind} file: {src_path}")
        extract = extract_cbz_images if file_ext == '.cbz' else extract_cbr_images
        with tempfile.TemporaryDirectory(prefix=f"{file_ext[1:]}_extract_") as extract_dir_str:
            image_files, comicinfo = extract(src_path, pathlib.Path(extract_dir_str))
            if not image_files:
                raise ValueError(f"No supported image files found in {kind}: {src_path}")
            print(f"Extracted {len(image_files)} image files from {kind}")
            return _process_images_to_cbz(image_files, dst_path, quality, max_width, max_height, lossless,
                                          strict=strict, comicinfo=comicinfo if keep_comicinfo else None)

    if src_path.is_dir():
        print(f"Converting directory: {src_path}")
        image_files = get_image_files(src_path)
        if not image_files:
            raise ValueError(f"No supported image files found in: {src_path}")
        print(f"Found {len(image_files)} image files in directory")
        comicinfo = _read_dir_comicinfo(src_path) if keep_comicinfo else None
        return _process_images_to_cbz(image_files, dst_path, quality, max_width, max_height, lossless,
                                      strict=strict, comicinfo=comicinfo)

    raise ValueError(f"Source must be a directory, CBZ file, or CBR file: {src_path}")


def _process_images_to_cbz(
    image_files: List[pathlib.Path],
    dst_path: pathlib.Path,
    quality: int,
    max_width: Optional[int],
    max_height: Optional[int],
    lossless: bool,
    *,
    strict: bool = False,
    comicinfo: Optional[bytes] = None
) -> int:
    """Convert a list of image files into a CBZ archive. Returns the number of pages written."""
    with tempfile.TemporaryDirectory(prefix="avif_convert_") as tmp_dir_str:
        tmp_dir = pathlib.Path(tmp_dir_str)

        converted_files: List[Tuple[str, pathlib.Path]] = []
        failed: List[str] = []

        for i, img_path in enumerate(tqdm(image_files, desc="Converting to AVIF")):
            try:
                avif_path = to_avif(img_path, tmp_dir, quality, max_width, max_height, lossless,
                                    out_stem=f"{i+1:03d}")
                # Zero-padded numbering keeps the reading order
                converted_files.append((f"{i+1:03d}.avif", avif_path))
            except Exception as e:
                # Temp paths mean nothing to the user: name the page by position instead
                failed.append(f"sida {i+1} ({str(e).replace(str(img_path), img_path.name)})")
                print(f"Failed to convert {img_path.name}: {e}")

        if strict and failed:
            raise ValueError(f"{len(failed)} av {len(image_files)} sidor kunde inte konverteras: " + "; ".join(failed[:3]))
        if not converted_files:
            raise ValueError("No images could be converted to AVIF")

        dst_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"Creating CBZ archive: {dst_path}")
        # AVIF is already compressed, so the archive stores the entries as they are
        with zipfile.ZipFile(dst_path, 'w', zipfile.ZIP_STORED) as cbz:
            for archive_name, avif_path in tqdm(converted_files, desc="Creating CBZ"):
                cbz.write(avif_path, arcname=archive_name)
            if comicinfo is not None:
                # ComicInfo.xml page numbers only match when no page was dropped
                if len(converted_files) == len(image_files):
                    cbz.writestr('ComicInfo.xml', comicinfo)
                else:
                    print("ComicInfo.xml left out: the page count changed")

        print(f"Successfully created {dst_path} with {len(converted_files)} pages")
        return len(converted_files)


# ───────────────────────── batch ─────────────────────────

@dataclass
class BatchResult:
    name: str
    status: str  # 'ok' | 'warn' | 'skip' | 'fail'
    message: str = ''
    pages: int = 0
    src_bytes: int = 0
    dst_bytes: int = 0
    seconds: float = 0.0


def _verify_cbz(path: pathlib.Path, pages: int) -> None:
    with zipfile.ZipFile(path, 'r') as cbz:
        if cbz.testzip() is not None:
            raise ValueError('den nya CBZ-filen är skadad')
        written = sum(1 for name in cbz.namelist() if name.endswith('.avif'))
    if written != pages:
        raise ValueError(f'fel antal sidor i den nya filen ({written} i stället för {pages})')


def _convert_one(src: pathlib.Path, dst: pathlib.Path, original: pathlib.Path,
                 quality: int, max_width: Optional[int], max_height: Optional[int], lossless: bool) -> BatchResult:
    """Convert one comic. Runs in a worker process.

    The AVIF file is written under a temporary name and renamed only after it verifies. The original
    is moved last, so any failure leaves the original where it was.
    """
    started = time.time()
    result = BatchResult(name=src.name, status='fail')
    tmp = dst.with_name(f".{src.name}.partial")
    try:
        result.src_bytes = src.stat().st_size
        dst.parent.mkdir(parents=True, exist_ok=True)
        log = io.StringIO()  # per-page messages would interleave between workers
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            result.pages = create_cbz(src, tmp, quality, max_width, max_height, lossless, strict=True)
        _verify_cbz(tmp, result.pages)
        os.replace(tmp, dst)
        result.dst_bytes = dst.stat().st_size
        result.status = 'ok'
    except Exception as e:
        result.message = str(e) or type(e).__name__
    finally:
        with contextlib.suppress(OSError):
            tmp.unlink()  # only exists if the conversion did not finish

    if result.status == 'ok':
        try:
            original.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(original))
        except OSError as e:
            result.status = 'warn'
            result.message = f'konverterad, men originalet kunde inte flyttas: {e}'

    result.seconds = time.time() - started
    return result


def find_comics(folder: pathlib.Path) -> List[pathlib.Path]:
    """.cbz/.cbr files directly in folder (subfolders are not searched), in reading order."""
    files = [p for p in folder.iterdir()
             if p.is_file() and not p.name.startswith('.') and p.suffix.lower() in COMIC_EXTENSIONS]
    return sorted(files, key=lambda p: _natural_key(p.name))


_LABELS = {'ok': 'OK', 'warn': 'VARNING', 'skip': 'HOPPAS ÖVER', 'fail': 'FEL'}


def _mb(n: int) -> str:
    return f"{n / 1_000_000:.1f}".replace('.', ',')


def _line(r: BatchResult, number: int, total: int) -> str:
    head = f"[{number}/{total}] {_LABELS[r.status]:<12} {r.name}"
    if r.status in ('ok', 'warn'):
        head += f"  {r.pages} sidor, {_mb(r.src_bytes)} → {_mb(r.dst_bytes)} MB, {r.seconds:.0f} s"
    if r.message:
        head += f"\n      {r.message}"
    return head


def _summary(results: List[BatchResult], folder: pathlib.Path) -> str:
    def count(status: str) -> int:
        return sum(1 for r in results if r.status == status)
    return (f"Klart: {count('ok')} konverterade, {count('warn')} med varning, "
            f"{count('skip')} hoppade över, {count('fail')} fel.\n"
            f"AVIF-filer: {folder / AVIF_DIR}\n"
            f"Original:   {folder / ORIGINAL_DIR}")


def convert_folder(
    folder: pathlib.Path,
    quality: int = 40,
    max_width: Optional[int] = BATCH_MAX_WIDTH,
    max_height: Optional[int] = None,
    lossless: bool = False,
    jobs: Optional[int] = None
) -> List[BatchResult]:
    """Convert every comic directly in `folder`, `jobs` files at a time.

    AVIF versions go to folder/avif/, originals are moved to folder/notavif/. Files whose
    output name already exists are skipped and left alone. Prints one line per file as it finishes.
    """
    folder = folder.expanduser().resolve()
    files = find_comics(folder)
    total = len(files)
    jobs = jobs or min(4, os.cpu_count() or 1)

    results: List[BatchResult] = []
    todo: List[Tuple[pathlib.Path, pathlib.Path, pathlib.Path]] = []
    claimed = set()  # output names taken in this run (macOS file systems ignore letter case)
    for src in files:
        dst = folder / AVIF_DIR / (src.stem + '.cbz')
        original = folder / ORIGINAL_DIR / src.name
        if dst.name.lower() in claimed:
            results.append(BatchResult(src.name, 'skip', 'samma utnamn som en annan fil i mappen'))
        elif dst.exists() or original.exists():
            results.append(BatchResult(src.name, 'skip', f'finns redan i {AVIF_DIR}/ eller {ORIGINAL_DIR}/'))
        else:
            claimed.add(dst.name.lower())
            todo.append((src, dst, original))

    print(f"Hittade {total} CBZ/CBR-filer i {folder}."
          + (f" Konverterar {len(todo)} med {min(jobs, len(todo))} åt gången." if todo else ""), flush=True)
    done = 0
    for r in results:
        done += 1
        print(_line(r, done, total), flush=True)
    if not todo:
        return results

    pool = ProcessPoolExecutor(max_workers=min(jobs, len(todo)))
    try:
        futures = {pool.submit(_convert_one, src, dst, original, quality, max_width, max_height, lossless): src
                   for src, dst, original in todo}
        for future in as_completed(futures):
            try:
                r = future.result()
            except Exception as e:  # the worker process itself failed
                r = BatchResult(futures[future].name, 'fail', f'oväntat fel: {e}')
            results.append(r)
            done += 1
            print(_line(r, done, total), flush=True)
    except KeyboardInterrupt:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    finally:
        pool.shutdown(wait=True)
    return results


# ───────────────────────── CLI ─────────────────────────

def main():
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        description="Convert image folders and CBZ/CBR files to AVIF format and package as CBZ",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m apps.tools.converter --batch ~/Downloads/Serier
  python -m converter --src ./chapter1 --dst ./out/chapter1.cbz
  python -m converter --src ./images --dst ./comic.cbz --quality 60 --max-width 1400
  python -m converter --src ./pages --dst ./hq.cbz --lossless
  python -m converter --check-cbr  # Test CBR support
        """
    )

    parser.add_argument('--src', type=pathlib.Path,
                        help='Source directory containing images OR existing CBZ/CBR file')
    parser.add_argument('--dst', type=pathlib.Path,
                        help='Output CBZ file path')
    parser.add_argument('--batch', type=pathlib.Path, metavar='MAPP',
                        help='Convert every CBZ/CBR directly in MAPP: AVIF files go to avif/, originals to notavif/')
    parser.add_argument('--jobs', type=int, default=None,
                        help='Batch: files converted at the same time (default: 4, or the number of cores if fewer)')
    parser.add_argument('--quality', type=int, default=40, choices=range(1, 101),
                        help='AVIF quality (1-100, default: 40)')
    parser.add_argument('--max-width', type=int,
                        help=f'Maximum width for resizing (preserves aspect ratio). Batch default: {BATCH_MAX_WIDTH}; 0 = keep size')
    parser.add_argument('--max-height', type=int,
                        help='Maximum height for resizing (preserves aspect ratio)')
    parser.add_argument('--lossless', action='store_true',
                        help='Use lossless AVIF encoding (ignores --quality)')
    parser.add_argument('--check-cbr', action='store_true',
                        help='Check if CBR/RAR support is available and exit')

    args = parser.parse_args()

    # Handle CBR check
    if args.check_cbr:
        print("Checking CBR/RAR support...")
        if not CBR_SUPPORT:
            print("❌ CBR support: NOT AVAILABLE")
            print("   Install rarfile: pip install rarfile")
            sys.exit(1)
        print("✅ CBR support: rarfile installed")
        tools = [t for t in ('bsdtar', 'unar', 'unrar', '7z') if shutil.which(t)]
        if not tools:
            print("❌ No RAR program found (bsdtar, unar, unrar or 7z)")
            sys.exit(1)
        print(f"✅ RAR program found: {', '.join(tools)}")
        return

    if args.batch:
        if not args.batch.expanduser().is_dir():
            parser.error(f"--batch needs a folder: {args.batch}")
        max_width = args.max_width if args.max_width is not None else BATCH_MAX_WIDTH
        try:
            results = convert_folder(args.batch, quality=args.quality, max_width=max_width or None,
                                     max_height=args.max_height, lossless=args.lossless, jobs=args.jobs)
        except KeyboardInterrupt:
            print("\nAvbrutet. Klara filer ligger i avif/ och notavif/; övriga är oförändrade.")
            sys.exit(1)
        if not results:
            print(f"Inga CBZ/CBR-filer direkt i {args.batch}")
            return
        print()
        print(_summary(results, args.batch.expanduser().resolve()))
        if any(r.status in ('fail', 'warn') for r in results):
            sys.exit(1)
        return

    # Validate required arguments for conversion
    if not args.src or not args.dst:
        parser.error("Both --src and --dst are required for conversion (or use --batch MAPP)")

    try:
        create_cbz(
            src=args.src,
            dst_path=args.dst,
            quality=args.quality,
            max_width=args.max_width,
            max_height=args.max_height,
            lossless=args.lossless
        )

    except KeyboardInterrupt:
        print("\nOperation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
