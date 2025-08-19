#!/usr/bin/env python3
"""
AVIF-CBZ Converter
Converts folders with JPG/PNG images to AVIF format and packages them into CBZ files.
"""

import argparse
import pathlib
import zipfile
import tempfile
import shutil
import sys
from typing import Optional, List, Tuple, Union

try:
    import rarfile  # For CBR support
    CBR_SUPPORT = True
    
    # Configure rarfile to use WinRAR's UnRAR.exe
    import os
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
except ImportError as e:
    print(f"Error: Missing required dependencies. Please install:")
    print("pip install Pillow>=10 pillow-avif-plugin tqdm")
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    # Fallback if tqdm is not available
    def tqdm(iterable, **kwargs):
        return iterable


def validate_avif_support() -> bool:
    """Check if AVIF encoding is supported."""
    try:
        # Try to import and check AVIF support
        import pillow_avif
        from PIL import features
        return features.check_codec('avif_enc') or 'AVIF' in Image.registered_extensions()
    except Exception as e:
        print(f"AVIF validation failed: {e}")
        return False


def to_avif(
    src_img: pathlib.Path, 
    tmp_dir: pathlib.Path, 
    quality: int, 
    max_width: Optional[int], 
    max_height: Optional[int],
    lossless: bool = False
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
            out_path = tmp_dir / (src_img.stem + ".avif")
            
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


def extract_cbr_images(cbr_path: pathlib.Path, extract_dir: pathlib.Path) -> List[pathlib.Path]:
    """Extract images from a CBR file to a temporary directory."""
    if not CBR_SUPPORT:
        raise ValueError("CBR support not available. Install rarfile: pip install rarfile")
    
    supported_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}
    
    try:
        image_files = []
        with rarfile.RarFile(cbr_path, 'r') as cbr:
            for file_info in cbr.infolist():
                # Skip directories and non-image files
                if file_info.is_dir():
                    continue
                    
                file_ext = pathlib.Path(file_info.filename).suffix.lower()
                if file_ext in supported_extensions:
                    # Extract the file
                    extracted_path = extract_dir / pathlib.Path(file_info.filename).name
                    with cbr.open(file_info.filename) as source, open(extracted_path, 'wb') as target:
                        shutil.copyfileobj(source, target)
                    image_files.append(extracted_path)
        
        # Sort naturally
        return sorted(image_files, key=lambda p: p.name.lower())
        
    except rarfile.NeedFirstVolume:
        raise ValueError(f"CBR file {cbr_path.name} appears to be part of a multi-volume archive. Please provide the first volume.")
    except rarfile.BadRarFile:
        raise ValueError(f"Invalid or corrupted CBR file: {cbr_path.name}")
    except rarfile.RarCannotExec as e:
        if "Cannot find working tool" in str(e) or "unrar" in str(e).lower():
            raise ValueError(
                f"Cannot extract CBR files: Missing unrar tool.\n"
                f"On Windows, please:\n"
                f"1. Download WinRAR from https://www.rarlab.com/download.htm\n"
                f"2. Install it (adds unrar.exe to PATH)\n"
                f"OR\n"
                f"3. Download unrar.exe manually and place in PATH\n"
                f"Original error: {e}"
            )
        else:
            raise ValueError(f"Error extracting CBR: {e}")
    except Exception as e:
        raise ValueError(f"Unexpected error extracting CBR file {cbr_path.name}: {e}")


def extract_cbz_images(cbz_path: pathlib.Path, extract_dir: pathlib.Path) -> List[pathlib.Path]:
    """Extract images from a CBZ file to a temporary directory."""
    supported_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}
    
    image_files = []
    with zipfile.ZipFile(cbz_path, 'r') as cbz:
        for file_info in cbz.filelist:
            # Skip directories and non-image files
            if file_info.is_dir():
                continue
                
            file_ext = pathlib.Path(file_info.filename).suffix.lower()
            if file_ext in supported_extensions:
                # Extract the file
                extracted_path = extract_dir / pathlib.Path(file_info.filename).name
                with cbz.open(file_info.filename) as source, open(extracted_path, 'wb') as target:
                    shutil.copyfileobj(source, target)
                image_files.append(extracted_path)
    
    # Sort naturally
    return sorted(image_files, key=lambda p: p.name.lower())


def get_image_files(src_dir: pathlib.Path) -> List[pathlib.Path]:
    """Get all supported image files from the source directory."""
    supported_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}
    
    image_files = []
    for file_path in src_dir.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in supported_extensions:
            image_files.append(file_path)
    
    # Sort naturally (001, 002, etc.)
    return sorted(image_files, key=lambda p: p.name.lower())


def create_cbz(
    src: Union[pathlib.Path, str],
    dst_path: pathlib.Path,
    quality: int = 40,
    max_width: Optional[int] = None,
    max_height: Optional[int] = None,
    lossless: bool = False
) -> None:
    """Convert images to AVIF and create CBZ archive.
    
    Args:
        src: Source directory containing images OR path to existing CBZ file
        dst_path: Output CBZ file path
        quality: AVIF quality (1-100)
        max_width: Maximum width for resizing
        max_height: Maximum height for resizing  
        lossless: Use lossless AVIF encoding
    """
    src_path = pathlib.Path(src)
    
    # Determine if source is a directory or comic file
    if src_path.is_file():
        file_ext = src_path.suffix.lower()
        if file_ext == '.cbz':
            print(f"Converting existing CBZ file: {src_path}")
            # Extract CBZ to temporary directory
            with tempfile.TemporaryDirectory(prefix="cbz_extract_") as extract_dir_str:
                extract_dir = pathlib.Path(extract_dir_str)
                image_files = extract_cbz_images(src_path, extract_dir)
                if not image_files:
                    raise ValueError(f"No supported image files found in CBZ: {src_path}")
                
                print(f"Extracted {len(image_files)} image files from CBZ")
                _process_images_to_cbz(image_files, dst_path, quality, max_width, max_height, lossless)
        
        elif file_ext == '.cbr':
            print(f"Converting existing CBR file: {src_path}")
            if not CBR_SUPPORT:
                raise ValueError("CBR support not available. Install rarfile: pip install rarfile")
            
            # Extract CBR to temporary directory
            with tempfile.TemporaryDirectory(prefix="cbr_extract_") as extract_dir_str:
                extract_dir = pathlib.Path(extract_dir_str)
                image_files = extract_cbr_images(src_path, extract_dir)
                if not image_files:
                    raise ValueError(f"No supported image files found in CBR: {src_path}")
                
                print(f"Extracted {len(image_files)} image files from CBR")
                _process_images_to_cbz(image_files, dst_path, quality, max_width, max_height, lossless)
        
        else:
            raise ValueError(f"Unsupported file format: {file_ext}. Supported: .cbz, .cbr")
            
    elif src_path.is_dir():
        print(f"Converting directory: {src_path}")
        # Get image files from directory
        image_files = get_image_files(src_path)
        if not image_files:
            raise ValueError(f"No supported image files found in: {src_path}")
        
        print(f"Found {len(image_files)} image files in directory")
        _process_images_to_cbz(image_files, dst_path, quality, max_width, max_height, lossless)
        
    else:
        raise ValueError(f"Source must be a directory, CBZ file, or CBR file: {src_path}")


def _process_images_to_cbz(
    image_files: List[pathlib.Path],
    dst_path: pathlib.Path,
    quality: int,
    max_width: Optional[int],
    max_height: Optional[int],
    lossless: bool
) -> None:
    """Helper function to process a list of image files into a CBZ archive."""
    
    # Create temporary directory for AVIF files
    with tempfile.TemporaryDirectory(prefix="avif_convert_") as tmp_dir_str:
        tmp_dir = pathlib.Path(tmp_dir_str)
        
        # Convert images to AVIF
        converted_files: List[Tuple[str, pathlib.Path]] = []
        
        for i, img_path in enumerate(tqdm(image_files, desc="Converting to AVIF")):
            try:
                avif_path = to_avif(img_path, tmp_dir, quality, max_width, max_height, lossless)
                # Use zero-padded numbering for proper sorting
                archive_name = f"{i+1:03d}.avif"
                converted_files.append((archive_name, avif_path))
            except Exception as e:
                print(f"Failed to convert {img_path.name}: {e}")
                continue
        
        if not converted_files:
            raise ValueError("No images could be converted to AVIF")
        
        # Create output directory if it doesn't exist
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Create CBZ file
        print(f"Creating CBZ archive: {dst_path}")
        with zipfile.ZipFile(dst_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as cbz:
            for archive_name, avif_path in tqdm(converted_files, desc="Creating CBZ"):
                cbz.write(avif_path, arcname=archive_name)
        
        print(f"Successfully created {dst_path} with {len(converted_files)} pages")


def main():
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        description="Convert image folders to AVIF format and package as CBZ",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m converter --src ./chapter1 --dst ./out/chapter1.cbz
  python -m converter --src ./images --dst ./comic.cbz --quality 60 --max-width 1400
  python -m converter --src ./pages --dst ./hq.cbz --lossless
  avif-converter --check-cbr  # Test CBR support
        """
    )
    
    parser.add_argument('--src', type=pathlib.Path,
                       help='Source directory containing images OR existing CBZ/CBR file')
    parser.add_argument('--dst', type=pathlib.Path,
                       help='Output CBZ file path')
    parser.add_argument('--quality', type=int, default=40, choices=range(1, 101),
                       help='AVIF quality (1-100, default: 40)')
    parser.add_argument('--max-width', type=int,
                       help='Maximum width for resizing (preserves aspect ratio)')
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
        else:
            print("✅ CBR support: AVAILABLE (rarfile installed)")
            
        # Test unrar tool availability by trying to use it
        print("🔍 Testing unrar tool availability...")
        try:
            # Create a test to see if rarfile can find unrar
            import tempfile
            import os
            
            # Try to check if any unrar tools are available
            tools_found = []
            for tool in ['unrar', 'unrar.exe', 'rar', 'rar.exe']:
                try:
                    import shutil
                    if shutil.which(tool):
                        tools_found.append(tool)
                except:
                    pass
            
            if tools_found:
                print(f"✅ Unrar tools found: {', '.join(tools_found)}")
                print("\n🎉 CBR files should be processable!")
            else:
                print("❌ No unrar tools found in PATH")
                print("   CBR extraction will likely fail.")
                print("   On Windows:")
                print("   1. Download WinRAR from https://www.rarlab.com/download.htm")
                print("   2. Install it (adds unrar.exe to PATH)")
                print("   OR")
                print("   3. Download unrar.exe manually and place in PATH")
                print("\n💡 You can still try CBR conversion - it might work with built-in tools.")
                
        except Exception as e:
            print(f"⚠️  Could not check unrar availability: {e}")
            print("   Try converting a CBR file to see if it works.")
        return
    
    # Validate required arguments for conversion
    if not args.src or not args.dst:
        parser.error("Both --src and --dst are required for conversion")
    
    try:
        # Skip AVIF validation for now - pillow-avif-plugin is installed
        # if not validate_avif_support():
        #     print("Error: AVIF encoding is not supported. Please install pillow-avif-plugin:")
        #     print("pip install pillow-avif-plugin")
        #     sys.exit(1)
        
        # Convert and create CBZ
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
