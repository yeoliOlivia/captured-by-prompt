# Trip pooling face test

A repeatable check of how well **Trip photo pooling** recognises people. It builds a fake trip from public research photos, runs the app's normal "Find people in trip photos" step, and scores the results against an answer key.

The photos come from [LFW (Labeled Faces in the Wild)](https://vis-www.cs.umass.edu/lfw/), a standard face-verification research dataset of public figures. Nothing personal is used, and all generated files are ignored by Git.

## What the test contains

- **4 trip members:** Serena Williams, Tony Blair, Junichiro Koizumi and Hugo Chávez. Their folder names are `serena`, `tony`, `junichiro` and `hugo`.
- **40 trip photos**, 10 on each member's "phone" (`sample-dataset/lfwtrip/<member>/`). Each LFW photo shows one face, so 1 to 4 faces are tiled side by side to stand in for group shots.
- **Harder cases:** stranger decoys (Colin Powell, Vladimir Putin and others), faces shrunk to look farther away, mirrored faces, owners appearing on their own phone (selfies), and 4 photos with no members at all.
- **Dates:** every trip photo carries an EXIF capture time between 2026-09-05 and 2026-09-07.
- **References:** 2 photos per member in `sample-dataset/lfwtrip-refs/`. They have no dates and are never reused in the trip photos.
- **Answer key:** `artifacts/local/face-test/answer-key.json` records which members are in each photo, 65 appearances in total.

The builder uses a fixed random seed, so everyone who runs it gets the same set.

## 1. Build the test set (once)

Download LFW, about 170 MB, to `artifacts/local/` and unpack it:

```bash
mkdir -p artifacts/local/lfw-download
curl -L -o artifacts/local/lfw-download/lfw.tgz https://ndownloader.figshare.com/files/5976018
tar xzf artifacts/local/lfw-download/lfw.tgz -C artifacts/local/lfw-download
```

Build the trip. This needs Pillow, which `uv` supplies without a separate install:

```bash
npm run test:faces:build
```

Re-running it deletes and recreates `sample-dataset/lfwtrip` and `sample-dataset/lfwtrip-refs`.

## 2. Run it in the app

1. Start `npm run dev:web`, open http://127.0.0.1:8790 and load a Gemini key in **Model connection**.
2. Click **Reload photo folders**.
3. In **My context**, add four people named exactly **Serena**, **Tony**, **Junichiro** and **Hugo**. Give each person their two reference photos from `lfwtrip-refs` (for example `serena-ref1.jpg` and `serena-ref2.jpg`).
4. Add a **Trip or event** called "lfwtrip", dated 2026-09-05 to 2026-09-07, with all four people ticked.
5. Open **Trip photo pooling**, choose the trip and click **Find people in trip photos**. This makes 4 vision requests.

## 3. Score the results

```bash
npm run test:faces:score
```

The scorer reads `sample-dataset/.context.sqlite` read-only, so the server can stay running. It prints:

- **Precision:** of the times the model said "present", how often the person was really there.
- **Recall:** of the person's real appearances, how often the model said "present". Uncertain answers count as misses here.
- Counts of correct "absent" answers, uncertain answers, and photo/person pairs that haven't been checked yet.
- Every miss and false match, with the model's own evidence.

It scores the raw answers, including photos from a member's own phone. The app hides those from that member's suggestions, but they still show how well recognition works.

If more than one vision model has results, the scorer uses the first one and names it. To pick a model, pass its name: `npm run test:faces:score -- <model>`.

## Re-running

Results are cached per photo, person revision and model, so clicking **Find people** again costs nothing. Editing a person's reference photos makes the app check that person again. To compare a change fairly, keep the same references, or delete and recreate the four people.

## Limits

LFW faces are cropped, centred and mostly front-on, and the tiled "group shots" are much simpler than real photos. A good score here is a floor check, not a promise. Real-world quality still needs a test on consented personal trip photos with a hand-made answer key.
