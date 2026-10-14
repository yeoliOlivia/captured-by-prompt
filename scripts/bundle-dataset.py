"""Export/import a portable photo + embedding bundle, without credentials."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import zipfile
from datetime import datetime, timezone

MODEL = 'gemini-embedding-2'
DIMENSIONS = 3072
ID = re.compile(r'^[a-f0-9]{64}$')


def records(source, expected):
    if type(expected) is not int or not 1 <= expected <= 10000:
        raise ValueError('Expected count must be between 1 and 10,000 photos.')
    result, pending = [], 0
    for path in sorted(source.glob('*.json')):
        if not ID.fullmatch(path.stem):
            continue
        raw = json.loads(path.read_text())
        if raw.get('id') != path.stem:
            raise ValueError(f'Invalid photo ID in {path.name}')
        embedding = raw.get('embeddings', {}).get(f'{MODEL}:{DIMENSIONS}')
        if embedding is None and raw.get('model') == MODEL:
            embedding = raw.get('embedding')
        if not isinstance(embedding, list) or len(embedding) != DIMENSIONS or not all(type(v) in (int, float) and math.isfinite(v) for v in embedding) or not any(embedding):
            pending += 1
            continue
        image = source / (path.stem + '.jpg')
        if not image.is_file():
            raise ValueError(f'Missing image {image.name}')
        # Explicit whitelist: do not copy paths, credentials, feedback, or unrelated caches.
        clean = {'id': path.stem, 'name': str(raw.get('name', 'Photo')),
                 'embeddings': {f'{MODEL}:{DIMENSIONS}': embedding}}
        result.append((image, clean))
    total = len(result) + pending
    if total != expected:
        raise ValueError(f'Expected {expected} photos; found {total}. No bundle created.')
    return result, pending


def export(source, output, expected, check=False):
    photos, pending = records(source, expected)
    if pending:
        print(f'Waiting: {len(photos)}/{expected} analyzed; {pending} still pending. No bundle created.')
        return False
    if check:
        print(f'Ready: all {expected} photos have {DIMENSIONS}-dimensional {MODEL} embeddings.')
        return True
    if output.exists():
        raise ValueError('Output already exists; choose another filename to avoid overwriting it.')
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + '.partial')
    manifest = {'format': 'captured-dataset-v1', 'createdAt': datetime.now(timezone.utc).isoformat(),
                'photos': expected, 'model': MODEL, 'dimensions': DIMENSIONS, 'files': {}}
    with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
        for image, record in photos:
            image_bytes = image.read_bytes()
            if hashlib.sha256(image_bytes).hexdigest() != record['id']:
                raise ValueError(f'Image checksum mismatch: {image.name}')
            items = {f'sample-dataset/{image.name}': image_bytes,
                     f"sample-dataset/{record['id']}.json": (json.dumps(record, separators=(',', ':')) + '\n').encode()}
            for name, data in items.items():
                archive.writestr(name, data)
                manifest['files'][name] = hashlib.sha256(data).hexdigest()
        archive.writestr('BUNDLE.json', json.dumps(manifest, indent=2))
        archive.writestr('BUNDLE-README.txt', f'''Captured photo-search dataset bundle
{expected} resized JPEG photos with saved {MODEL} embeddings ({DIMENSIONS} dimensions).
No API key is included. This bundle is for Gemini search; Qwen requires a separate index.

In a current clone of captured-by-prompt, run:
  python3 scripts/bundle-dataset.py --verify /path/to/this-bundle.zip
Then extract the ZIP into an empty directory and copy its sample-dataset contents into
that clone's sample-dataset folder. Do not replace an existing collection blindly.
Start: npm run dev:web
Select Gemini and enter your own key to search. Image analysis is already done.

COCO source and image terms: https://cocodataset.org/#termsofuse
Six original examples: https://scikit-image.org/docs/stable/api/skimage.data.html
Original image rights remain with their respective owners. Only resized copies are included.
''')
    verify(partial)
    partial.replace(output)
    print(f'Bundle saved: {output} ({output.stat().st_size:,} bytes)')
    return True


def verify(path):
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('BUNDLE.json'))
        if manifest.get('format') != 'captured-dataset-v1' or manifest.get('model') != MODEL or manifest.get('dimensions') != DIMENSIONS:
            raise ValueError('Unsupported bundle format')
        if type(manifest.get('photos')) is not int or not 1 <= manifest['photos'] <= 10000 or not isinstance(manifest.get('files'), dict):
            raise ValueError('Invalid bundle manifest')
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(manifest['files']) | {'BUNDLE.json', 'BUNDLE-README.txt'}:
            raise ValueError('Unexpected or duplicate archive entries')
        if len(manifest['files']) != manifest['photos'] * 2:
            raise ValueError('Incomplete photo collection')
        for name, checksum in manifest['files'].items():
            if not re.fullmatch(r'sample-dataset/[a-f0-9]{64}\.(jpg|json)', name):
                raise ValueError('Invalid archive path')
            if hashlib.sha256(archive.read(name)).hexdigest() != checksum:
                raise ValueError(f'Checksum mismatch: {name}')
        images = {name[:-4] for name in manifest['files'] if name.endswith('.jpg')}
        records = {name[:-5] for name in manifest['files'] if name.endswith('.json')}
        if images != records or len(images) != manifest['photos']:
            raise ValueError('Every photo needs its matching embedding record')
        for stem in sorted(images):
            photo_id = stem.rsplit('/', 1)[1]
            if hashlib.sha256(archive.read(stem + '.jpg')).hexdigest() != photo_id:
                raise ValueError('Image ID does not match its content')
            record = json.loads(archive.read(stem + '.json'))
            if not isinstance(record, dict) or set(record) != {'id', 'name', 'embeddings'} or record.get('id') != photo_id or not isinstance(record.get('name'), str):
                raise ValueError('Invalid photo record')
            embeddings = record.get('embeddings')
            key = f'{MODEL}:{DIMENSIONS}'
            if not isinstance(embeddings, dict) or set(embeddings) != {key}:
                raise ValueError('Invalid embedding model')
            values = embeddings[key]
            if not isinstance(values, list) or len(values) != DIMENSIONS or not all(type(v) in (int, float) and math.isfinite(v) for v in values) or not any(values):
                raise ValueError('Invalid embedding vector')
    print(f'Verified: {manifest["photos"]} photos and embeddings, all checksums intact.')



def restore(bundle_path, destination):
    # Validate the entire archive before writing anything into the collection.
    verify(bundle_path)
    destination.mkdir(parents=True, exist_ok=True)
    key = f'{MODEL}:{DIMENSIONS}'
    restored = 0
    def valid(values):
        return (isinstance(values, list) and len(values) == DIMENSIONS
                and all(type(v) in (int, float) and math.isfinite(v) for v in values)
                and any(values))
    with zipfile.ZipFile(bundle_path) as archive:
        for name in archive.namelist():
            if not name.startswith('sample-dataset/') or not name.endswith('.json'):
                continue
            saved = json.loads(archive.read(name))
            photo_id = saved['id']
            record_path = destination / (photo_id + '.json')
            image_path = destination / (photo_id + '.jpg')
            current = json.loads(record_path.read_text()) if record_path.exists() else saved
            if not isinstance(current, dict) or current.get('id') != photo_id:
                raise ValueError(f'Conflicting local record: {record_path.name}')
            if image_path.exists():
                if hashlib.sha256(image_path.read_bytes()).hexdigest() != photo_id:
                    raise ValueError(f'Conflicting local image: {image_path.name}')
            else:
                temporary = image_path.with_suffix('.jpg.restore-tmp')
                temporary.write_bytes(archive.read(f'sample-dataset/{photo_id}.jpg'))
                temporary.replace(image_path)
            embeddings = current.setdefault('embeddings', {})
            if not isinstance(embeddings, dict):
                raise ValueError(f'Invalid local embeddings: {record_path.name}')
            if record_path.exists() and (valid(embeddings.get(key)) or
                    (current.get('model') == MODEL and valid(current.get('embedding')))):
                continue
            # Preserve names, source metadata, other providers and newer valid analysis.
            embeddings[key] = saved['embeddings'][key]
            temporary = record_path.with_suffix('.json.restore-tmp')
            temporary.write_text(json.dumps(current, separators=(',', ':')) + '\n')
            temporary.replace(record_path)
            restored += 1
    print(f'Saved bundle ready: restored {restored} analysis records; existing analysis preserved.')
    return restored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1] / 'sample-dataset')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'artifacts/local/captured-5134-gemini-3072.zip')
    parser.add_argument('--expected-count', type=int, default=5134)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--restore', type=Path, help='Restore missing photos and analysis into --source')
    args = parser.parse_args()
    if args.restore:
        restore(args.restore, args.source)
    elif args.verify:
        verify(args.verify)
    else:
        export(args.source, args.output, args.expected_count, args.check)


if __name__ == '__main__':
    main()
