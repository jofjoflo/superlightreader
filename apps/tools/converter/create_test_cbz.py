#!/usr/bin/env python3
"""
Create a test CBZ with JPG images to test CBZ-to-AVIF conversion
"""

import pathlib
import zipfile
import tempfile
from PIL import Image

def create_test_jpg_cbz():
    """Create a test CBZ file containing JPG images"""
    
    # Create temporary directory for JPG images
    with tempfile.TemporaryDirectory(prefix="test_jpg_") as tmp_dir:
        tmp_path = pathlib.Path(tmp_dir)
        
        # Create some test JPG images
        colors = [
            ("red", (255, 0, 0)),
            ("green", (0, 255, 0)),
            ("blue", (0, 0, 255)),
            ("yellow", (255, 255, 0)),
            ("magenta", (255, 0, 255))
        ]
        
        jpg_files = []
        for i, (color_name, color) in enumerate(colors):
            # Create image
            img = Image.new('RGB', (600, 800), color=color)
            
            # Add some simple content
            try:
                from PIL import ImageDraw, ImageFont
                draw = ImageDraw.Draw(img)
                
                try:
                    font = ImageFont.truetype("arial.ttf", 36)
                except:
                    font = ImageFont.load_default()
                
                text = f"Test Page {i+1}\n{color_name.upper()}\nJPG Format"
                
                # Calculate text position
                bbox = draw.textbbox((0, 0), text, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
                
                x = (600 - text_width) // 2
                y = (800 - text_height) // 2
                
                # Draw text with outline
                outline_color = (255, 255, 255) if sum(color) < 384 else (0, 0, 0)
                for dx in [-2, -1, 0, 1, 2]:
                    for dy in [-2, -1, 0, 1, 2]:
                        if dx != 0 or dy != 0:
                            draw.text((x+dx, y+dy), text, font=font, fill=outline_color)
                
                text_color = (0, 0, 0) if sum(color) > 384 else (255, 255, 255)
                draw.text((x, y), text, font=font, fill=text_color)
                
            except ImportError:
                pass
            
            # Save as JPG
            jpg_file = tmp_path / f"{i+1:03d}_page.jpg"
            img.save(jpg_file, format='JPEG', quality=85)
            jpg_files.append(jpg_file)
        
        # Create CBZ file
        output_cbz = pathlib.Path("test_jpg_comic.cbz")
        
        print(f"Creating test CBZ with {len(jpg_files)} JPG pages...")
        with zipfile.ZipFile(output_cbz, 'w', zipfile.ZIP_DEFLATED) as cbz:
            for jpg_file in jpg_files:
                cbz.write(jpg_file, arcname=jpg_file.name)
        
        print(f"✅ Created test CBZ: {output_cbz.absolute()}")
        print(f"📊 File size: {output_cbz.stat().st_size / 1024:.1f} KB")
        
        return output_cbz

if __name__ == "__main__":
    create_test_jpg_cbz()
