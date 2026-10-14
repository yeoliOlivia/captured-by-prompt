import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).with_name('bundle-dataset.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)

class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'photos'
        self.source.mkdir()
        self.image = b'test-image-bytes'
        self.id = hashlib.sha256(self.image).hexdigest()
        (self.source / (self.id + '.jpg')).write_bytes(self.image)
        self.record = {'id':self.id,'name':'sample.jpg','model':bundle.MODEL,
                       'embedding':[1.0]+[0.0]*3071,'apiKey':'must-not-export','source':{'path':'private-path'}}
        self.output = self.root / 'bundle.zip'
        self.save()
    def save(self):
        (self.source / (self.id + '.json')).write_text(json.dumps(self.record))
    def test_restore_missing_collection_and_repeat_without_changes(self):
        bundle.export(self.source, self.output, 1)
        destination = self.root / 'restored'
        self.assertEqual(bundle.restore(self.output, destination), 1)
        record = destination / (self.id + '.json')
        before = record.stat().st_mtime_ns
        self.assertEqual(bundle.restore(self.output, destination), 0)
        self.assertEqual(record.stat().st_mtime_ns, before)
        self.assertEqual((destination / (self.id + '.jpg')).read_bytes(), self.image)

    def test_restore_preserves_metadata_other_models_and_newer_vectors(self):
        bundle.export(self.source, self.output, 1)
        self.record.pop('embedding')
        self.record['embeddings'] = {'qwen:test': [3, 4]}
        self.save()
        self.assertEqual(bundle.restore(self.output, self.source), 1)
        record_path = self.source / (self.id + '.json')
        restored = json.loads(record_path.read_text())
        self.assertEqual(restored['source'], self.record['source'])
        self.assertEqual(restored['embeddings']['qwen:test'], [3, 4])
        key = f'{bundle.MODEL}:3072'
        restored['embeddings'][key] = [2.0] * 3072
        record_path.write_text(json.dumps(restored))
        self.assertEqual(bundle.restore(self.output, self.source), 0)
        self.assertEqual(json.loads(record_path.read_text())['embeddings'][key], [2.0] * 3072)

    def test_restore_rejects_conflicting_local_image(self):
        bundle.export(self.source, self.output, 1)
        (self.source / (self.id + '.jpg')).write_bytes(b'wrong photo')
        before = (self.source / (self.id + '.json')).read_bytes()
        with self.assertRaises(ValueError):
            bundle.restore(self.output, self.source)
        self.assertEqual((self.source / (self.id + '.json')).read_bytes(), before)

    def test_waits_for_analysis_and_rejects_wrong_count(self):
        self.record['embedding'] = [1.0]*768
        self.save()
        self.assertFalse(bundle.export(self.source,self.output,1))
        self.assertFalse(self.output.exists())
        with self.assertRaises(ValueError):bundle.export(self.source,self.output,2)
    def test_export_is_portable_and_excludes_other_data(self):
        self.assertTrue(bundle.export(self.source,self.output,1))
        with zipfile.ZipFile(self.output) as archive:
            record = json.loads(archive.read(f'sample-dataset/{self.id}.json'))
            self.assertNotIn('apiKey',record)
            self.assertNotIn('source',record)
            self.assertEqual(len(record['embeddings'][f'{bundle.MODEL}:3072']),3072)
            self.assertEqual(archive.read(f'sample-dataset/{self.id}.jpg'),self.image)
        bundle.verify(self.output)
        with self.assertRaises(ValueError):bundle.export(self.source,self.output,1)
    def test_detects_corruption_and_supports_new_cache_format(self):
        self.record['embeddings']={f'{bundle.MODEL}:3072':self.record.pop('embedding')}
        self.save()
        bundle.export(self.source,self.output,1)
        broken=self.root/'broken.zip'
        with zipfile.ZipFile(self.output) as source, zipfile.ZipFile(broken,'w') as target:
            for entry in source.namelist():
                target.writestr(entry,b'changed' if entry.endswith('.jpg') else source.read(entry))
        with self.assertRaises(ValueError):bundle.verify(broken)
    def test_rejects_semantically_invalid_records_even_with_matching_checksums(self):
        bundle.export(self.source,self.output,1)
        for kind in ['vector', 'model', 'id', 'unpaired', 'private-field']:
            with self.subTest(kind=kind):
                with zipfile.ZipFile(self.output) as source:
                    contents={name:source.read(name) for name in source.namelist()}
                name=f'sample-dataset/{self.id}.json'
                record=json.loads(contents[name])
                manifest=json.loads(contents['BUNDLE.json'])
                if kind=='vector':record['embeddings'][f'{bundle.MODEL}:3072']=[0.0]*3072
                if kind=='id':record['id']='f'*64
                if kind=='private-field':record['apiKey']='must-not-import'
                contents[name]=json.dumps(record).encode()
                if kind=='model':manifest['model']='wrong-model'
                if kind=='unpaired':
                    contents[f'sample-dataset/{"f"*64}.json']=contents.pop(name)
                manifest['files']={name:hashlib.sha256(data).hexdigest() for name,data in contents.items() if name.startswith('sample-dataset/')}
                contents['BUNDLE.json']=json.dumps(manifest).encode()
                broken=self.root/(kind+'.zip')
                with zipfile.ZipFile(broken,'w') as target:
                    for name,data in contents.items():target.writestr(name,data)
                with self.assertRaises(ValueError):bundle.verify(broken)

if __name__=='__main__':unittest.main()
