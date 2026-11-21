"""
Unit tests for the AVIF-CBZ converter
"""

import unittest
import tempfile
import pathlib
import zipfile
import shutil
from PIL import Image

# Import our converter module
import sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from main import create_cbz, get_image_files, to_avif, validate_avif_support


class TestAVIFConverter(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures."""
        self.test_dir = tempfile.mkdtemp()
        self.test_path = pathlib.Path(self.test_dir)
        
        # Create test images
        self.create_test_images()
    
    def tearDown(self):
        """Clean up test fixtures."""
        shutil.rmtree(self.test_dir)
    
    def create_test_images(self):
        """Create sample test images."""
        # Create a few test images with different formats
        formats = [
            ("001_image.jpg", "JPEG"),
            ("002_image.png", "PNG"), 
            ("010_image.jpg", "JPEG"),  # Test sorting
            ("003_image.webp", "WebP")
        ]
        
        for filename, format_name in formats:
            img = Image.new('RGB', (100, 100), color='red')
            img.save(self.test_path / filename, format=format_name)
    
    def test_avif_support(self):
        """Test AVIF support detection."""
        # This might fail if AVIF support is not properly installed
        # but should not raise an exception
        result = validate_avif_support()
        self.assertIsInstance(result, bool)
    
    def test_get_image_files(self):
        """Test image file discovery and sorting."""
        image_files = get_image_files(self.test_path)
        
        # Should find all test images (function searches both upper and lower case)
        # Our test creates 4 files, but the function will find each file twice (upper/lower case search)
        # However, since we only created lowercase files, it should still find 4
        self.assertEqual(len(image_files), 4)
        
        # Check sorting - should be natural sort
        names = [f.name for f in image_files]
        expected_order = ["001_image.jpg", "002_image.png", "003_image.webp", "010_image.jpg"]
        self.assertEqual(names, expected_order)
    
    def test_to_avif_conversion(self):
        """Test individual image conversion to AVIF."""
        if not validate_avif_support():
            self.skipTest("AVIF support not available")
        
        # Get first test image
        source_img = self.test_path / "001_image.jpg"
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            
            # Convert to AVIF
            avif_path = to_avif(source_img, tmp_path, quality=50, max_width=None, max_height=None)
            
            # Check that AVIF file was created
            self.assertTrue(avif_path.exists())
            self.assertEqual(avif_path.suffix, ".avif")
            
            # Verify it's a valid image
            with Image.open(avif_path) as img:
                self.assertEqual(img.format, "AVIF")
                self.assertEqual(img.size, (100, 100))
    
    def test_cbz_creation(self):
        """Test full CBZ creation process."""
        if not validate_avif_support():
            self.skipTest("AVIF support not available")
        
        output_cbz = self.test_path / "test_output.cbz"
        
        # Create CBZ
        create_cbz(
            src=self.test_path,
            dst_path=output_cbz,
            quality=50
        )
        
        # Verify CBZ was created
        self.assertTrue(output_cbz.exists())
        
        # Verify CBZ contents
        with zipfile.ZipFile(output_cbz, 'r') as cbz:
            files = cbz.namelist()
            
            # Should have 4 AVIF files with proper naming
            self.assertEqual(len(files), 4)
            
            # Check naming pattern
            expected_names = ["001.avif", "002.avif", "003.avif", "004.avif"]
            self.assertEqual(sorted(files), expected_names)
            
            # Verify each file can be read as AVIF
            for filename in files:
                with cbz.open(filename) as avif_file:
                    avif_data = avif_file.read()
                    self.assertGreater(len(avif_data), 0)
                    
                    # Try to open with PIL to verify it's valid
                    with tempfile.NamedTemporaryFile(suffix='.avif') as tmp:
                        tmp.write(avif_data)
                        tmp.flush()
                        
                        with Image.open(tmp.name) as img:
                            self.assertEqual(img.format, "AVIF")
    
    def test_resize_functionality(self):
        """Test image resizing during conversion."""
        if not validate_avif_support():
            self.skipTest("AVIF support not available")
        
        output_cbz = self.test_path / "test_resized.cbz"
        
        # Create CBZ with size constraints
        create_cbz(
            src=self.test_path,
            dst_path=output_cbz,
            quality=50,
            max_width=50,
            max_height=50
        )
        
        # Verify resizing worked
        with zipfile.ZipFile(output_cbz, 'r') as cbz:
            with cbz.open("001.avif") as avif_file:
                avif_data = avif_file.read()
                
                with tempfile.NamedTemporaryFile(suffix='.avif') as tmp:
                    tmp.write(avif_data)
                    tmp.flush()
                    
                    with Image.open(tmp.name) as img:
                        # Should be resized to 50x50 or smaller
                        self.assertLessEqual(img.width, 50)
                        self.assertLessEqual(img.height, 50)
    
    def test_empty_directory(self):
        """Test handling of empty directory."""
        empty_dir = self.test_path / "empty"
        empty_dir.mkdir()
        
        output_cbz = self.test_path / "empty.cbz"
        
        # Should raise ValueError for empty directory
        with self.assertRaises(ValueError):
            create_cbz(
                src=empty_dir,
                dst_path=output_cbz,
                quality=50
            )
    
    def test_nonexistent_directory(self):
        """Test handling of non-existent directory."""
        fake_dir = self.test_path / "does_not_exist"
        output_cbz = self.test_path / "fake.cbz"
        
        # Should raise ValueError for non-existent directory
        with self.assertRaises(ValueError):
            create_cbz(
                src=fake_dir,
                dst_path=output_cbz,
                quality=50
            )


if __name__ == "__main__":
    unittest.main()
