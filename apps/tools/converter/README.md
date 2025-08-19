# AVIF-CBZ Converter

A Python CLI tool for converting image folders AND existing CBZ files to AVIF format and packaging them as CBZ files.

## Installation

```bash
pip install -e .
```

This installs the `avif-converter` command globally.

## Usage

### Convert Directory to CBZ

```bash
avif-converter --src ./input_folder --dst ./output.cbz
```

### Convert Existing CBZ (JPG/PNG → AVIF)

```bash
avif-converter --src existing_comic.cbz --dst avif_comic.cbz
```

### Advanced Options

```bash
avif-converter \
  --src ./my_comic_pages \
  --dst ./comics/chapter1.cbz \
  --quality 60 \
  --max-width 1400 \
  --max-height 2000
```

### Lossless Mode

```bash
avif-converter --src ./pages --dst ./high_quality.cbz --lossless
```

## Options

- `--src` (required): Source directory containing images OR existing CBZ file
- `--dst` (required): Output CBZ file path  
- `--quality`: AVIF quality (1-100, default: 40)
- `--max-width`: Maximum width for resizing (preserves aspect ratio)
- `--max-height`: Maximum height for resizing (preserves aspect ratio)
- `--lossless`: Use lossless AVIF encoding (ignores --quality)

## Supported Input Formats

### From Directory:
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- BMP (.bmp)
- TIFF (.tiff, .tif)

### From CBZ:
- Any CBZ file containing the above image formats

## Features

- ✅ **CBZ-to-CBZ conversion** (JPG/PNG → AVIF)
- ✅ **Directory-to-CBZ conversion**
- ✅ Natural sorting (001, 002, 010, etc.)
- ✅ Progress bars with tqdm
- ✅ **Massive file size reduction** (up to 90%+ smaller)
- ✅ Error handling and validation
- ✅ Memory efficient processing
- ✅ Configurable compression settings
- ✅ Image resizing with aspect ratio preservation

## Real-World Example

Converting a 82MB X-Men comic (JPG) to AVIF:

```bash
avif-converter --src "X-Men 020.cbz" --dst "X-Men 020 AVIF.cbz" --quality 40 --max-width 1400
```

**Result**: 82MB → 5.4MB (**93.4% file size reduction!**)

## Testing

Create test files:

```bash
python create_test_cbz.py  # Creates test_jpg_comic.cbz
avif-converter --src test_jpg_comic.cbz --dst test_avif.cbz
```

Run unit tests:

```bash
python -m unittest test_converter.py
```

## Requirements

- Python 3.10+
- Pillow>=10.0.0
- pillow-avif-plugin>=1.4.0  
- tqdm>=4.64.0

## Output

The tool creates CBZ files (ZIP archives) containing AVIF images with standardized naming:
- 001.avif
- 002.avif
- 003.avif
- etc.

CBZ files can be opened by most comic readers and the included web reader.
