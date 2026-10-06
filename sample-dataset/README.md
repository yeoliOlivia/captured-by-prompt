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

## Providers and visual verification

The local frontend supports Google Gemini (gemini-embedding-2, 3072 dimensions) and Alibaba hosted Qwen (qwen3-vl-embedding, 2560 dimensions). Choose a provider when loading its API key. Qwen requires a Beijing-region Model Studio key; images and queries go to that region. The hosted model is not the open Qwen3-VL-Embedding-8B checkpoint. Each provider has its own saved image vectors. Switching providers requires indexing only photos not yet indexed by that provider; switching back reuses the previous vectors. Keys are held in memory and never written into image records.

The optional double-check sends the top 12 embedding candidates and the original query to gemini-3.8-flash or qwen3-vl-plus. It asks for a shared checklist preserving AND, OR, NOT, subjects, and relationships, then assesses every image against every requirement. The backend requires all checklist items to pass before showing an AI-assessed match. Any failure means mismatch; uncertainty remains uncertainty. Evidence is available on each result. These are fallible model judgments, not guarantees or proof of absence. Only the top 12 are checked; other matches may exist. Verification adds a vision request and is cached only for the server session. An invalid or incomplete assessment fails visibly rather than silently falling back to supposedly verified results.

For future Modal deployment, benchmark the open Qwen/Qwen3-VL-Embedding-8B and Qwen/Qwen3-VL-Reranker-8B separately. The dedicated reranker returns relevance scores rather than checklist explanations. The provider implementation lives in playground/providers.ts; a Modal adapter must use a distinct cache identity for its checkpoint, dimensions, and preprocessing, and must not reuse the hosted Qwen vectors.

## Sharing analyzed photos

After all 5,134 photos have Gemini 3072-dimensional embeddings, run `python3 scripts/bundle-dataset.py`. It creates `artifacts/local/captured-5134-gemini-3072.zip`, with resized photos, their saved embeddings, integrity checksums, and import instructions. It waits without creating an incomplete bundle if any analysis is missing. Use `--source /path/to/sample-dataset` for another running copy, `--check` for readiness only, or `--verify /path/to/bundle.zip` to validate a bundle. API keys, private source paths, feedback, and unrelated caches are excluded. The ZIP stays local and is ignored by Git. A friend can extract its sample-dataset files into a fresh clone and search with their own Gemini key without repeating image analysis.
