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
