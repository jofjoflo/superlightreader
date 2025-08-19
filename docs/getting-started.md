# Getting Started Guide

## Step 1: Setup Python Converter

1. **Navigate to the converter directory:**
   ```bash
   cd apps/tools/converter
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Test the converter:**
   ```bash
   python demo.py
   ```

This will create a `demo_comic.cbz` file with sample pages.

## Step 2: Setup Web Reader

1. **Navigate to the reader directory:**
   ```bash
   cd apps/reader
   ```

2. **Install Node.js dependencies:**
   ```bash
   pnpm install
   ```

3. **Start the development server:**
   ```bash
   pnpm run dev
   ```

4. **Open the reader:**
   Open http://localhost:5173 in your browser

## Step 3: Test the Complete Workflow

1. **Create a test comic:**
   ```bash
   cd apps/tools/converter
   
   # Create a folder with some images
   mkdir test_images
   # Copy some JPG/PNG files into test_images/
   
   # Convert to CBZ
   python -m converter --src test_images --dst my_comic.cbz --quality 50
   ```

2. **Read in the web app:**
   - Open http://localhost:5173
   - Drag and drop `my_comic.cbz` onto the reader
   - Navigate with arrow keys or buttons

## Features Checklist

### ✅ Python Converter
- [x] Convert JPG/PNG/WebP to AVIF
- [x] Package as CBZ files
- [x] Natural sorting (001, 002, etc.)
- [x] Quality and size options
- [x] Error handling
- [x] Progress bars
- [x] Unit tests

### ✅ Web Reader
- [x] Drag & drop CBZ support
- [x] AVIF format detection
- [x] Keyboard navigation
- [x] Lazy loading with prefetch
- [x] Responsive design
- [x] Settings persistence
- [x] Memory management (URL cleanup)

### 🔄 Future Enhancements (Step 2)
- [ ] AI Super Resolution with ONNX.js
- [ ] Real-time upscaling
- [ ] Advanced reader features
- [ ] Mobile app with Capacitor

## Browser Compatibility

| Browser | AVIF Support | Reader Support |
|---------|--------------|----------------|
| Chrome 85+ | ✅ | ✅ |
| Firefox 93+ | ✅ | ✅ |
| Safari 16+ | ✅ | ✅ |
| Edge 85+ | ✅ | ✅ |
| Older browsers | ⚠️ | ✅ (with warning) |

## Troubleshooting

### Python Issues
- **AVIF not working:** Install `pillow-avif-plugin` and ensure you have a recent libavif
- **Import errors:** Use `pip install -r requirements.txt`

### Reader Issues
- **CBZ not loading:** Check browser console for errors
- **AVIF warning:** Update your browser or use JPEG/PNG comics

### Performance Tips
- Use `--quality 40-60` for good balance of size/quality
- Set `--max-width 1400` for web reading
- Use `--lossless` only for archival purposes

## Command Examples

```bash
# Basic conversion
python -m converter --src ./chapter1 --dst ./chapter1.cbz

# High quality with size limit
python -m converter --src ./images --dst ./comic.cbz --quality 70 --max-width 1600

# Lossless archival
python -m converter --src ./originals --dst ./archive.cbz --lossless

# Mobile-optimized
python -m converter --src ./pages --dst ./mobile.cbz --quality 40 --max-width 800
```
