"""Builds a labelled trip-pooling test from LFW (Labeled Faces in the Wild).

Usage: npm run test:faces:build (or python3 scripts/build-face-test.py [path/to/lfw] with Pillow installed)
Writes sample-dataset/lfwtrip/<phone>/*.jpg (dated trip photos), sample-dataset/lfwtrip-refs/*.jpg
(undated reference photos) and artifacts/local/face-test/answer-key.json. Score with scripts/score-face-test.ts.
"""
import json
import random
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
LFW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'artifacts/local/lfw-download/lfw'
TRIP = 'lfwtrip'
MEMBERS = {'serena': 'Serena_Williams', 'tony': 'Tony_Blair', 'junichiro': 'Junichiro_Koizumi', 'hugo': 'Hugo_Chavez'}
DECOYS = ['Colin_Powell', 'George_W_Bush', 'Gerhard_Schroeder', 'Vladimir_Putin',
          'Jacques_Chirac', 'Ariel_Sharon', 'Jean_Chretien', 'John_Ashcroft']
DAYS = ['2026:09:05', '2026:09:06', '2026:09:07']
PER_PHONE = 10
TILE, GAP = 250, 12

rng = random.Random(2026)
trip_dir, ref_dir = ROOT / 'sample-dataset' / TRIP, ROOT / 'sample-dataset' / f'{TRIP}-refs'
key_path = ROOT / 'artifacts/local/face-test/answer-key.json'
for d in (trip_dir, ref_dir):
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
key_path.parent.mkdir(parents=True, exist_ok=True)

pools = {}
for who, name in {**MEMBERS, **{d: d for d in DECOYS}}.items():
    files = sorted((LFW / name).glob('*.jpg'))
    rng.shuffle(files)
    pools[who] = files

references = {}
for who in MEMBERS:
    references[who] = []
    for i in range(2):
        out = ref_dir / f'{who}-ref{i + 1}.jpg'
        shutil.copyfile(pools[who].pop(), out)
        references[who].append(str(out.relative_to(ROOT / 'sample-dataset')))

def tile(path):
    face = Image.open(path).convert('RGB')
    if rng.random() < 0.5:
        face = ImageOps.mirror(face)
    if rng.random() < 0.2:  # a smaller, farther-away person
        small = face.resize((TILE // 2, TILE // 2))
        face = Image.new('RGB', (TILE, TILE), (214, 206, 190))
        face.paste(small, (rng.randint(0, TILE // 2), rng.randint(0, TILE // 2)))
    return face

answers = {}
counter = 0
phones = list(MEMBERS)
for phone in phones:
    for n in range(PER_PHONE):
        # Mostly others, sometimes the phone's owner (selfies), and some photos with no members.
        if n < 1:
            present = []
        else:
            others = [m for m in phones if m != phone]
            present = rng.sample(others, rng.choice([1, 1, 2, 2, 3]))
            if rng.random() < 0.25:
                present.append(phone)
        strangers = rng.sample(DECOYS, rng.choice([0, 1, 1, 2]) if present else rng.choice([1, 2]))
        people = present + strangers
        rng.shuffle(people)
        canvas = Image.new('RGB', (len(people) * TILE + (len(people) + 1) * GAP, TILE + 2 * GAP), (214, 206, 190))
        for i, who in enumerate(people):
            canvas.paste(tile(pools[who].pop()), (GAP + i * (TILE + GAP), GAP))
        exif = Image.Exif()
        stamp = f'{DAYS[n % 3]} {10 + n:02d}:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}'
        exif[0x0132] = stamp
        exif.get_ifd(0x8769)[0x9003] = stamp
        out = trip_dir / phone / f'IMG_{2000 + counter}.jpg'
        out.parent.mkdir(exist_ok=True)
        canvas.save(out, quality=92, exif=exif)
        answers[str(out.relative_to(ROOT / 'sample-dataset'))] = {'members': sorted(present), 'strangers': len(strangers)}
        counter += 1

key_path.write_text(json.dumps({'trip': TRIP, 'dates': ['2026-09-05', '2026-09-07'], 'members': MEMBERS,
                                'references': references, 'photos': answers}, indent=2))
pairs = sum(len(a['members']) for a in answers.values())
print(f'{len(answers)} trip photos, {pairs} member appearances, references in {ref_dir.relative_to(ROOT)}, key at {key_path.relative_to(ROOT)}')
