"""Download COCO val2017 images; no labels, API keys, or Gemini calls."""
from pathlib import Path
import tempfile
import urllib.request
import zipfile
import shutil
import argparse

root = Path(__file__).resolve().parents[1]
destination = root / 'sample-dataset' / 'coco-val2017'
# COCO's published download URL; its HTTPS hostname has a certificate mismatch.
url = 'http://images.cocodataset.org/zips/val2017.zip'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path, default=Path(tempfile.gettempdir()) / 'coco-val2017.zip')
archive = parser.parse_args().archive
if not zipfile.is_zipfile(archive):
    partial = archive.with_suffix('.zip.part')
    print('Downloading COCO validation 2017 (~800 MB)...', flush=True)
    urllib.request.urlretrieve(url, partial)
    partial.replace(archive)
with zipfile.ZipFile(archive) as dataset:
    images = [info for info in dataset.infolist() if info.filename.startswith('val2017/') and info.filename.endswith('.jpg')]
    if len(images) != 5000:
        raise RuntimeError(f'Expected 5000 images; found {len(images)}')
    destination.mkdir(parents=True, exist_ok=True)
    for info in images:
        target = destination / Path(info.filename).name
        if target.exists() and target.stat().st_size == info.file_size:
            continue
        partial = target.with_suffix('.jpg.part')
        with dataset.open(info) as source, partial.open('wb') as output:
            shutil.copyfileobj(source, output)
        partial.replace(target)
(destination / 'README.md').write_text('# COCO validation 2017\n\n5,000 original photos from '+url+'\n\nSource and image terms: https://cocodataset.org/#termsofuse\n\nLabels and captions are not loaded or used for search. Original numeric filenames are preserved.\n')
print(f'Ready: 5,000 photos in {destination}')
