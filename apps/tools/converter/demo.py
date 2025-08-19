#!/usr/bin/env python3
"""
Demo script to test the AVIF-CBZ converter
Creates sample images and converts them to test the functionality
"""

import tempfile
import pathlib
import shutil
from PIL import Image

def create_demo_images(output_dir: pathlib.Path):
    """Create sample comic pages for testing"""
    colors = [
        ("red", (255, 0, 0)),
        ("green", (0, 255, 0)), 
        ("blue", (0, 0, 255)),
        ("yellow", (255, 255, 0)),
        ("purple", (255, 0, 255))
    ]
    
    for i, (color_name, color) in enumerate(colors):
        # Create a simple test image
        img = Image.new('RGB', (800, 1200), color=color)
        
        # Add some text to make it look more like a comic page
        try:
            from PIL import ImageDraw, ImageFont
            draw = ImageDraw.Draw(img)
            
            # Try to use a system font, fallback to default
            try:
                font = ImageFont.truetype("arial.ttf", 48)
            except:
                font = ImageFont.load_default()
            
            text = f"Page {i+1:03d}\n{color_name.upper()}"
            
            # Get text size for centering
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            
            x = (800 - text_width) // 2
            y = (1200 - text_height) // 2
            
            # Draw text with outline for visibility
            outline_color = (255, 255, 255) if sum(color) < 384 else (0, 0, 0)
            for dx in [-2, -1, 0, 1, 2]:
                for dy in [-2, -1, 0, 1, 2]:
                    if dx != 0 or dy != 0:
                        draw.text((x+dx, y+dy), text, font=font, fill=outline_color)
            
            text_color = (0, 0, 0) if sum(color) > 384 else (255, 255, 255)
            draw.text((x, y), text, font=font, fill=text_color)
            
        except ImportError:
            # PIL doesn't have text drawing support
            pass
        
        # Save with proper naming for sorting
        filename = f"{i+1:03d}_{color_name}.jpg"
        img.save(output_dir / filename, format='JPEG', quality=95)
        print(f"Created demo image: {filename}")

def main():
    """Run the demo"""
    print("🎯 AVIF-CBZ Converter Demo")
    print("=" * 40)
    
    # Create temporary directories
    with tempfile.TemporaryDirectory(prefix="cbr_demo_") as temp_dir:
        temp_path = pathlib.Path(temp_dir)
        input_dir = temp_path / "input"
        output_dir = temp_path / "output"
        
        input_dir.mkdir()
        output_dir.mkdir()
        
        # Create demo images
        print("📸 Creating demo images...")
        create_demo_images(input_dir)
        
        # Import and run converter
        print("\n🔄 Converting to AVIF and creating CBZ...")
        try:
            import sys
            sys.path.insert(0, str(pathlib.Path(__file__).parent))
            from main import create_cbz
            
            output_cbz = output_dir / "demo_comic.cbz"
            
            create_cbz(
                src_dir=input_dir,
                dst_path=output_cbz,
                quality=50,
                max_width=1200
            )
            
            print(f"✅ Successfully created: {output_cbz}")
            print(f"📊 File size: {output_cbz.stat().st_size / 1024:.1f} KB")
            
            # Copy to current directory for testing
            final_output = pathlib.Path("demo_comic.cbz")
            shutil.copy2(output_cbz, final_output)
            print(f"📁 Demo file copied to: {final_output.absolute()}")
            
            print("\n🎉 Demo completed successfully!")
            print("You can now test the demo_comic.cbz file in the web reader.")
            
        except Exception as e:
            print(f"❌ Error during conversion: {e}")
            return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
