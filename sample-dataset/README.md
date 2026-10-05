# Local photo collection

The local web frontend saves uploaded photos here as JPEG copies up to 1024px, with EXIF removed. Each image has a JSON record containing its display filename and, after analysis, its Gemini image embedding. Filenames never affect search. Images and index records are ignored by Git.

Start from the repository root with `npm run dev:web`, then open http://127.0.0.1:8790. Upload multiple images, load your Gemini key, click Analyze photos, then search. The key is held only in server memory; add it again after a server restart. Images and completed embeddings persist across restarts. Pause stops after the current request.

Search calls gemini-embedding-2 directly for images and queries and ranks by cosine similarity. No captions, OCR, filename matching, or mock fallback. Search ranks all indexed images; it does not guarantee a relevant match exists. New image and query requests use the project's Gemini quota and billing. Repeated queries are cached for the running session.

Uploaded copies are resized, not archival originals. Up to 500 photos, 25 MB per upload; JPEG, PNG, WebP. Keep this folder in a permanent location if you want long-term storage. In the temporary test copy, macOS may eventually clear the folder.

Run `npm run test:web` for isolated tests using a stub provider (no Google requests).
