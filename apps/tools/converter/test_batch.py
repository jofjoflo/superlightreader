"""
Batch conversion tests. Run from this folder: python -m unittest test_batch -v
"""

import io
import pathlib
import shutil
import sys
import tempfile
import unittest
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from PIL import Image  # noqa: E402
import main  # noqa: E402


def _jpeg(color, size=(120, 180)) -> bytes:
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, format='JPEG')
    return buf.getvalue()


class HelperTests(unittest.TestCase):

    def test_is_page_skips_junk(self):
        for name in ['001.jpg', 'ch1/Page 2.PNG', 'x/y/z.webp']:
            self.assertTrue(main._is_page(name), name)
        for name in ['__MACOSX/ch1/._001.jpg', 'ch1/._001.jpg', '.DS_Store', 'Thumbs.db',
                     'ch1/', '../x.jpg', '/abs/x.jpg', 'ComicInfo.xml']:
            self.assertFalse(main._is_page(name), name)

    def test_pages_are_in_natural_order(self):
        self.assertEqual(main._ordered_pages(['p10.jpg', 'p2.jpg', 'p1.jpg']),
                         ['p1.jpg', 'p2.jpg', 'p10.jpg'])

    def test_comicinfo_is_shallowest_and_safe(self):
        self.assertEqual(main._find_comicinfo(['a/b/ComicInfo.xml', 'ComicInfo.xml']), 'ComicInfo.xml')
        self.assertIsNone(main._find_comicinfo(['__MACOSX/ComicInfo.xml', '../ComicInfo.xml']))


class BatchTests(unittest.TestCase):

    def setUp(self):
        if not main.validate_avif_support():
            self.skipTest("AVIF encoder not available")
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='batch_test_'))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def make_cbz(self, name, entries):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, 'w') as z:
            for entry, data in entries.items():
                z.writestr(entry, data)
        return path

    def convert(self):
        return main.convert_folder(self.root, jobs=2)

    def test_converts_root_comics_and_moves_originals(self):
        a = self.make_cbz('Serie A 001.cbz', {'ch1/001.jpg': _jpeg('red'), 'ch1/002.jpg': _jpeg('blue'),
                                              'ch1/003.jpg': _jpeg('green')})
        b = self.make_cbz('Serie B 001.cbz', {'001.jpg': _jpeg('red'), '002.jpg': _jpeg('blue'),
                                              'ComicInfo.xml': b'<ComicInfo><Series>B</Series></ComicInfo>'})
        self.make_cbz('sub/Nested.cbz', {'001.jpg': _jpeg('red')})
        (self.root / 'notes.txt').write_text('keep me')
        original_a = a.read_bytes()

        results = self.convert()

        self.assertEqual(sorted(r.status for r in results), ['ok', 'ok'])
        self.assertFalse(a.exists())
        self.assertFalse(b.exists())
        self.assertEqual((self.root / 'notavif' / 'Serie A 001.cbz').read_bytes(), original_a)
        self.assertTrue((self.root / 'notavif' / 'Serie B 001.cbz').exists())
        self.assertEqual((self.root / 'notes.txt').read_text(), 'keep me')
        self.assertTrue((self.root / 'sub' / 'Nested.cbz').exists())  # subfolders are not searched
        with zipfile.ZipFile(self.root / 'avif' / 'Serie A 001.cbz') as z:
            self.assertEqual(sorted(z.namelist()), ['001.avif', '002.avif', '003.avif'])
        with zipfile.ZipFile(self.root / 'avif' / 'Serie B 001.cbz') as z:
            self.assertEqual(sorted(z.namelist()), ['001.avif', '002.avif', 'ComicInfo.xml'])

    def test_pages_are_sorted_naturally(self):
        self.make_cbz('Order.cbz', {'page10.jpg': _jpeg('blue'), 'page2.jpg': _jpeg('red')})
        self.convert()
        with zipfile.ZipFile(self.root / 'avif' / 'Order.cbz') as z:
            first = Image.open(io.BytesIO(z.read('001.avif'))).convert('RGB')
        r, _, b = first.getpixel((first.width // 2, first.height // 2))
        self.assertGreater(r, 150)  # page2 (red) must be page 1
        self.assertLess(b, 100)

    def test_mac_resource_forks_are_not_pages(self):
        self.make_cbz('Junk.cbz', {'001.jpg': _jpeg('red'), '__MACOSX/._001.jpg': b'\x00junk'})
        self.convert()
        with zipfile.ZipFile(self.root / 'avif' / 'Junk.cbz') as z:
            self.assertEqual(sorted(z.namelist()), ['001.avif'])

    def test_broken_archive_is_left_alone(self):
        broken = self.root / 'Broken.cbz'
        broken.write_bytes(b'not a zip at all' * 100)
        results = self.convert()
        self.assertEqual([r.status for r in results], ['fail'])
        self.assertTrue(broken.exists())
        self.assertFalse((self.root / 'avif' / 'Broken.cbz').exists())
        self.assertEqual(list((self.root / 'avif').glob('.*')) if (self.root / 'avif').exists() else [], [])

    def test_one_bad_page_fails_the_whole_comic(self):
        self.make_cbz('Bad Page.cbz', {'001.jpg': _jpeg('red'), '002.jpg': b'not an image'})
        results = self.convert()
        self.assertEqual([r.status for r in results], ['fail'])
        self.assertIn('kunde inte konverteras', results[0].message)
        self.assertIn('sida 2', results[0].message)
        self.assertTrue((self.root / 'Bad Page.cbz').exists())

    def test_existing_output_is_not_overwritten(self):
        (self.root / 'avif').mkdir()
        (self.root / 'avif' / 'Dup.cbz').write_bytes(b'keep')
        src = self.make_cbz('Dup.cbz', {'001.jpg': _jpeg('red')})
        results = self.convert()
        self.assertEqual([r.status for r in results], ['skip'])
        self.assertTrue(src.exists())
        self.assertEqual((self.root / 'avif' / 'Dup.cbz').read_bytes(), b'keep')

    def test_same_output_name_is_not_written_twice(self):
        self.make_cbz('Same.cbz', {'001.jpg': _jpeg('red')})
        (self.root / 'Same.cbr').write_bytes(b'not a rar either')
        results = self.convert()
        self.assertEqual(sorted(r.status for r in results), ['fail', 'skip'])
        self.assertTrue((self.root / 'Same.cbz').exists())
        self.assertTrue((self.root / 'Same.cbr').exists())
        self.assertFalse((self.root / 'avif' / 'Same.cbz').exists())

    def test_second_run_finds_nothing(self):
        self.make_cbz('Once.cbz', {'001.jpg': _jpeg('red')})
        self.assertEqual([r.status for r in self.convert()], ['ok'])
        self.assertEqual(self.convert(), [])

    def test_single_file_keeps_comicinfo_and_counts_pages(self):
        src = self.make_cbz('One.cbz', {'001.jpg': _jpeg('red'), 'ComicInfo.xml': b'<ComicInfo/>'})
        pages = main.create_cbz(src, self.root / 'out' / 'One.cbz', quality=40)
        self.assertEqual(pages, 1)
        with zipfile.ZipFile(self.root / 'out' / 'One.cbz') as z:
            self.assertEqual(sorted(z.namelist()), ['001.avif', 'ComicInfo.xml'])

    @unittest.skipUnless(shutil.which('bsdtar'), 'bsdtar not available')
    def test_rar_is_listed_and_unpacked(self):
        # The fixture holds text files only, so the comic has no pages: the RAR path must still run cleanly
        shutil.copy(HERE / 'testdata' / 'folder-test.rar', self.root / 'Rar Test.cbr')
        results = self.convert()
        self.assertEqual([r.status for r in results], ['fail'])
        self.assertIn('No supported image files', results[0].message)
        self.assertTrue((self.root / 'Rar Test.cbr').exists())


if __name__ == '__main__':
    unittest.main()
