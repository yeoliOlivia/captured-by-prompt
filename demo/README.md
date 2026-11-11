# Public demo (static site)

A shareable, read-only demo of Captured by Prompt. It runs entirely in the visitor's browser on public sample photos, with every example search computed ahead of time. It needs no server, no API key and no model calls while people use it, so it can be hosted for free (for example on Vercel's Hobby plan).

## What is in this folder

| Path | What it is | Made by |
| --- | --- | --- |
| `index.html`, `demo.js`, `demo.css` | The demo page and its search logic | Hand-written |
| `styles.css`, `theme.js`, `strictness.js` | Copies of `playground/styles.css`, `playground/theme.js`, `packages/core/src/strictness.js` | Copied; refresh them when the app changes |
| `landing.js` | Copy of `playground/landing.js`, reading `data/*.json` instead of the local server, with a demo example query | Copied with three edited lines |
| `photos/` | 134 resized, EXIF-free sample photos | `node scripts/build-demo.mjs` |
| `data/state.json`, `data/embeddings.bin` | Photo list and their Gemini image embeddings (int8) | `node scripts/build-demo.mjs` |
| `data/prompts.json` | Gemini embeddings of the example searches in `scripts/demo-prompts.json` | `node scripts/embed-demo-prompts.mjs` |
| `data/context.json` | A fictional person and trips ("Maya", "Jordan", "Sam", "Lisbon trip") for the intro's album captions | Hand-written |

Only public photos can be included: `build-demo.mjs` takes a photo only if its source is tracked by Git (COCO128 in `sample-dataset/coco128/` and the six scikit-image samples). Your own uploads and trip folders are never tracked, so they cannot end up here.

## Rebuild the data

From the repo root:

```bash
node scripts/build-demo.mjs          # photos + embeddings, offline
node scripts/embed-demo-prompts.mjs  # example searches; needs a Gemini key (GEMINI_API_KEY or apps/api/.env)
```

The second command makes one Gemini request per example search and prints the top three photos for each, so you can check the results make sense before publishing. To change the examples, edit `scripts/demo-prompts.json` and run it again.

## Preview locally

```bash
python3 -m http.server 8811 --directory demo
```

Then open http://127.0.0.1:8811.

## Deploy on Vercel (free Hobby plan)

1. Push this folder to GitHub.
2. On vercel.com, sign in with GitHub, choose **Add New > Project**, and import the repository.
3. Set **Root Directory** to `demo`. Framework preset: **Other**. Leave the build command empty.
4. Deploy. You get a `*.vercel.app` link, and every push to the deployed branch updates it.

Hobby is for non-commercial use. It includes 100 GB of transfer a month; one full visit to this page is roughly 10 MB.
