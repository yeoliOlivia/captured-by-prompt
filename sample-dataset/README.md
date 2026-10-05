# Local photo collection

The local web frontend saves uploaded photos here as JPEG copies up to 1024px, with EXIF removed. Each image has a JSON record containing its display filename and, after analysis, its Gemini image embedding. Filenames never affect search. New uploads and index records are ignored by Git. The six bundled public samples are explicitly tracked; their image embeddings are generated locally when you analyze them.

Start from the repository root with `npm run dev:web`, then open http://127.0.0.1:8790. Upload multiple images, load your Gemini key, click Analyze photos, then search. The key is held only in server memory; add it again after a server restart. Images and completed embeddings persist across restarts. Pause stops after the current request.

Search calls gemini-embedding-2 directly for images and queries and ranks by cosine similarity. No captions, OCR, filename matching, or mock fallback. Search ranks all indexed images; it does not guarantee a relevant match exists. New image and query requests use the project's Gemini quota and billing. Repeated queries are cached for the running session.

Uploaded copies are resized, not archival originals. Up to 10,000 photos, 25 MB per upload; JPEG, PNG, WebP. Keep this folder in a permanent location if you want long-term storage. In the temporary test copy, macOS may eventually clear the folder.

Run `npm run test:web` for isolated tests using a stub provider (no Google requests).

## Bundled sample credits

These resized copies come from the [scikit-image v0.24.0 sample collection](https://github.com/scikit-image/scikit-image/tree/v0.24.0/skimage/data). Original filenames are retained as display names only.

- chelsea.png: Stefan van der Walt, CC0.
- coffee.png: Rachel Michetti, CC0.
- astronaut.png: NASA, public domain.
- rocket.jpg: SpaceX, public domain.
- camera.png: Lav Varshney, CC0.
- coins.png: Greek coins from Pompeii, scikit-image sample collection.

Only these bundled samples are checked in. Additional uploads stay local unless explicitly added to Git.

## Loading plain photo folders

Put JPEG, PNG, or WebP images in a subfolder such as `sample-dataset/my-photos/`. Start the frontend, or click **Reload photo folders** while it is running. It imports images recursively, skips duplicate image content, and leaves source files untouched. Imported copies and embeddings are cached in the dataset root; removing source files does not remove previously imported photos. COCO128 is included in `coco128/`. Other folders remain ignored by Git unless explicitly added.

## Larger collection: COCO validation 2017

Run `python3 scripts/download-coco-val.py` to download and unpack 5,000 photos to `sample-dataset/coco-val2017/` (about 800 MB download). Then start the frontend or click Reload photo folders. Images stay ignored by Git. Only pixels are used for search; no annotation files are imported. The gallery shows 60 photos at a time.
