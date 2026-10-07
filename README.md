# captured-by-prompt

# Captured by Prompt — Free 30-photo prototype

Product ideas, experiments, and future direction live in [Ideas and roadmap](docs/ideas-and-roadmap.md).

## Summary

For now: it starts with 20 photos, support up to 30s. 

## Implementation

**AI pipeline**

- Convertz selected images into orientation-correct JPEG previews with a maximum 1,024-pixel long edge.
- Usez `gemini-embedding-2` through its free tier for image and query embeddings, with 768 dimensions.
- Usez `gemini-3.5-flash-lite` through its free tier for concise photo descriptions, visible-text extraction, and resolving follow-up prompts.
- Retrievez matches locally using cosine similarity combined with text matching. Support explicit date filters when capture dates are available.
- Integrates Jev through the TypeSafe SDK as an optional ranking step, enabled only after verifying promotional credits and disabling paid refills. If unavailable, retain the real embedding-based search results.
- Keeps the ranking adapter separate so enabling Jev later does not require changing the app or index.
- Never labels baseline results as Jev-ranked or substitute fake AI responses when credentials are missing.

**Backend interfaces**

- Photo analysis: preview → description, extracted text, embedding, model versions, usage.
- Query preparation: prompt and conversation context → resolved search text, date constraints, query embedding.
- Optional ranking: query and candidate descriptions → ordered candidate IDs and scores.
- Health: provider readiness, free-access configuration, and quota errors.

API keys on the backend. 

## Local browser frontend

Run `npm run dev:web` and open http://127.0.0.1:8790. Upload photos, load a Gemini API key, analyze, and search with image embeddings. Collection copies and embeddings persist in [`sample-dataset`](sample-dataset/README.md); the key stays in memory. This frontend uses image similarity without captions or keyword matching.

### Search controls and personal context (browser app)

The browser app uses Gemini Embedding 2 at **3,072 dimensions** (or a separate hosted-Qwen index), with no filename or caption matching. The earlier prototype description above describes the original mobile/API implementation.

- **Broader / Stricter** adapts to the actual scores for each search. The broadest position shows all eligible results with cosine similarity at least `0.001` (a provisional positive floor). The middle keeps approximately the closest quarter; the strictest keeps the highest-scoring result(s). Equal scores stay together. The curve uses the eligible score distribution, including the choice to show uncertain visual assessments; failed assessments remain hidden. The slider and photo cards show no numeric similarity scores. Its relative position persists in this browser under a new settings key, independent of the old absolute cutoff. Filtering makes no model calls, and pagination uses the full search distribution rather than recalculating on each page. Search/clarification/error/reload states never fall back to unfiltered photos; use Browse collection explicitly. Reload preserves the query and asks you to run it again without automatic model calls. This control selects relative matches; it does not calibrate relevance probabilities.
- **My context** stores user-confirmed people, places, trips/events, objects/pets, and preferences. Each record has a stable ID, aliases, a distinguishing label, freeform facts, optional dates, reference photo IDs, provenance, timestamps, and an edit revision. Mark one person as **me**. Clear solo reference photos are best; people require at least one photo.
- With **Use my saved context** enabled, the connected provider interprets the query into visual content and personal references. This costs one generation request per new query per server session. Ordinary visual queries continue without a personal-memory lookup or automatic visual verification.
- Exact aliases resolve known entities. Unknown or ambiguous references pause search before embedding or verification. Choose an existing memory (an unknown phrase becomes an alias) or create one with photos; the original query resumes. Ambiguous choices apply only to that search, so two people called Mark keep distinct identities. A user can explicitly search visually without personal context instead.
- After resolution, one additional cached generation request translates relevant confirmed facts into a visual search query (for example, “my old apartment” plus “red kitchen”). Personal searches retrieve candidates using that grounded visual query and the first two reference-image embeddings per entity, then check the top 12 against the **original** query and relevant confirmed facts. Up to two reference images per entity are sent to the vision model. Saved reference-photo associations are supplied as confirmed evidence. Unrelated memories are not sent. The model cannot create or edit memories automatically.
- Review, edit, and delete memories in **My context**. Stale edits are rejected rather than overwriting another tab's changes. Editing/deleting invalidates cached visual checks. The app is currently a **single-owner local prototype**, not a multi-account service.

Context persists in `sample-dataset/.context.sqlite` (SQLite, owner-only permissions), independently of embeddings. It is ignored by Git and excluded from portable photo/embedding bundles. Back up personal context separately with the server stopped (or use SQLite's backup facilities). API keys remain in memory and are never stored in this database. Requires Node 22.13+ with `node:sqlite` support.

**Current limits:** this is explicit memory retrieval plus model interpretation, not LoRA training or a dedicated face-recognition index. Whole-image similarity suggests candidates; it is not identity confidence. Personal-search scores are the maximum similarity to the visual query or a reference image, so calibrate thresholds separately from ordinary searches. Only the selected shortlist is visually checked; missing a candidate at retrieval cannot be fixed by verification. Dates are retained as facts, but this image-copy pipeline currently strips capture metadata, so it cannot enforce capture-date constraints. The verifier must report uncertainty when the available evidence cannot establish a personal or temporal match. Relationships can be recorded as facts/aliases; structured relationship history, face crops/clustering, capture metadata, preference learning, and native Photos integration remain future work.

Validation: `npm test`, `npm run test:web`, and a browser walkthrough cover thresholds, empty results, personal-reference clarification, duplicate-name disambiguation, relevant-context isolation, edits, deletion, persistence, and existing provider/index behavior. Automated model responses are mocked; real-model recognition quality still needs evaluation on a consented personal collection.
