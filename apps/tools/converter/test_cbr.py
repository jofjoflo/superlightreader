#!/usr/bin/env python3
"""
Test CBR support - creates a sample CBR file for testing
Note: Requires unrar.exe to be available on the system
"""

import pathlib
import tempfile
import subprocess
import sys
from PIL import Image

def create_test_cbr():
    """Create a test CBR file for testing"""
    
    # Check if unrar/rar is available
    try:
        result = subprocess.run(['rar'], capture_output=True, text=True)
        has_rar = True
    except FileNotFoundError:
        print("⚠️  WinRAR not found. CBR creation skipped.")
        print("📝 To test CBR support:")
        print("   1. Install WinRAR")
        print("   2. Add WinRAR to your PATH")
        print("   3. Run this script again")
        return None
    
    print("📦 Creating test CBR file...")
    
    # Create temporary directory for images
    with tempfile.TemporaryDirectory(prefix="test_cbr_") as tmp_dir:
        tmp_path = pathlib.Path(tmp_dir)
        
        # Create test images
        colors = [
            ("red", (255, 0, 0)),
            ("green", (0, 255, 0)),
            ("blue", (0, 0, 255))
        ]
        
        image_files = []
        for i, (color_name, color) in enumerate(colors):
            img = Image.new('RGB', (400, 600), color=color)
            img_file = tmp_path / f"{i+1:03d}_{color_name}.jpg"
            img.save(img_file, format='JPEG', quality=85)
            image_files.append(img_file)
        
        # Create CBR using WinRAR
        output_cbr = pathlib.Path("test_comic.cbr")
        
        try:
            # Use rar command to create CBR
            cmd = ['rar', 'a', '-ep1', str(output_cbr)] + [str(f) for f in image_files]
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=tmp_path)
            
            if result.returncode == 0:
                print(f"✅ Created test CBR: {output_cbr.absolute()}")
                print(f"📊 File size: {output_cbr.stat().st_size / 1024:.1f} KB")
                return output_cbr
            else:
                print(f"❌ Failed to create CBR: {result.stderr}")
                return None
                
        except Exception as e:
            print(f"❌ Error creating CBR: {e}")
            return None

def test_cbr_conversion():
    """Test converting CBR to AVIF CBZ"""
    cbr_file = create_test_cbr()
    
    if cbr_file and cbr_file.exists():
        print("\n🔄 Testing CBR to AVIF conversion...")
        
        try:
            # Test the conversion
            import subprocess
            cmd = [
                'avif-converter',
                '--src', str(cbr_file),
                '--dst', 'test_cbr_converted.cbz',
                '--quality', '50'
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                output_file = pathlib.Path('test_cbr_converted.cbz')
                print(f"✅ CBR conversion successful!")
                print(f"📁 Output: {output_file.absolute()}")
                print(f"📊 Size: {output_file.stat().st_size / 1024:.1f} KB")
            else:
                print(f"❌ Conversion failed: {result.stderr}")
                
        except Exception as e:
            print(f"❌ Error during conversion: {e}")

if __name__ == "__main__":
    test_cbr_conversion()
