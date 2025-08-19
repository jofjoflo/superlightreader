# AVIF-CBZ Converter + Web Comic Reader

A complete solution for converting comics to AVIF format and reading them in a modern web interface.

## Project Structure

```
/apps
  /reader        # SvelteKit-app (TS) - Web comic reader
    /src/lib
    /src/routes
    /public/models  # ONNX-modeller (SR) - For future AI upscaling
  /tools
    /converter   # Python CLI (AVIF + CBZ) - Image converter
  /docs
```

## Features

### 🛠️ Python Converter (`/apps/tools/converter`)

- Convert JPG/PNG/WebP images to AVIF format
- Package converted images into CBZ archives
- Preserve image order with zero-padding (001, 002, ...)
- Configurable quality, size constraints, and lossless mode
- Comprehensive error handling and validation

**Usage:**
```bash
cd apps/tools/converter
python -m converter --src ./input_chapter --dst ./out/chapter.cbz --quality 40 --max-width 1400
```

**Options:**
- `--src`: Source directory with images
- `--dst`: Output CBZ file path
- `--quality`: AVIF quality (1-100, default: 40)
- `--max-width`: Maximum width for resizing
- `--max-height`: Maximum height for resizing
- `--lossless`: Use lossless AVIF encoding

### 📖 Web Comic Reader (`/apps/reader`)

- Modern SvelteKit-based web application
- Drag & drop CBZ file support
- AVIF format detection and warnings
- Lazy loading with prefetching
- Keyboard navigation (arrow keys, space, home, end)
- Responsive design for mobile and desktop
- Local storage for settings

**Features:**
- Opens CBZ files locally (no server upload)
- Supports AVIF, WebP, JPEG, PNG formats
- Automatic format detection and MIME handling
- Clean, dark UI optimized for reading
- Memory-efficient URL management

## Quick Start

### 1. Install Python Dependencies

```bash
cd apps/tools/converter
pip install -r requirements.txt
```

### 2. Start the Reader

```bash
cd apps/reader
pnpm install
pnpm run dev
```

### 3. Convert and Read

```bash
# Convert a folder of images to CBZ
python -m converter --src ./my_comic_pages --dst ./my_comic.cbz

# Open the reader at http://localhost:5173
# Drag and drop the CBZ file to start reading
```

## Dependencies

### Python Converter
- Python 3.10+
- Pillow>=10.0.0
- pillow-avif-plugin>=1.4.0
- tqdm>=4.64.0

### Web Reader
- Node.js 18+
- SvelteKit
- TypeScript
- fflate (ZIP handling)
- idb-keyval (settings storage)
- onnxruntime-web (future AI features)

## Development Status

✅ **Step 1 Complete:**
- Python CLI converter (AVIF + CBZ)
- SvelteKit reader with AVIF support
- Unit tests and error handling
- Local CBZ file reading
- AVIF compatibility detection

🔄 **Step 2 (Future):**
- AI Super Resolution (ONNX.js)
- Real-time upscaling in browser
- Low-res storage → high-res display

## Browser Compatibility

The reader works best in modern browsers with AVIF support:
- Chrome 85+
- Firefox 93+
- Safari 16+
- Edge 85+

For browsers without AVIF support, the reader will display a warning but still work with JPEG/PNG/WebP images.

## License

MIT License - Feel free to use and modify for your projects.
