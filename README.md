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

- **Broader / Stricter** filters cached search results instantly. The initial cosine cutoff is `0.50`, a provisional setting, not a calibrated probability. Only scores strictly above the cutoff are shown, including subsequent pages. Empty results stay empty until the user broadens the search. Search, clarification, error, and page-reload states never fall back to the unfiltered collection; use Browse collection explicitly to see everything. Reloading the page preserves the query and asks you to run it again without making automatic model calls. The setting persists in this browser; no model calls or reanalysis are needed to adjust it. Visual failures stay hidden; uncertain assessments can be shown explicitly.
- **My context** stores user-confirmed people, places, trips/events, objects/pets, and preferences. Each record has a stable ID, aliases, a distinguishing label, freeform facts, optional dates, reference photo IDs, provenance, timestamps, and an edit revision. Mark one person as **me**. Clear solo reference photos are best; people require at least one photo.
- With **Use my saved context** enabled, the connected provider interprets the query into visual content and personal references. This costs one generation request per new query per server session. Ordinary visual queries continue without a personal-memory lookup or automatic visual verification.
- Exact aliases resolve known entities. Unknown or ambiguous references pause search before embedding or verification. Choose an existing memory (an unknown phrase becomes an alias) or create one with photos; the original query resumes. Ambiguous choices apply only to that search, so two people called Mark keep distinct identities. A user can explicitly search visually without personal context instead.
- After resolution, one additional cached generation request translates relevant confirmed facts into a visual search query (for example, “my old apartment” plus “red kitchen”). Personal searches retrieve candidates using that grounded visual query and the first two reference-image embeddings per entity, then check the top 12 against the **original** query and relevant confirmed facts. Up to two reference images per entity are sent to the vision model. Saved reference-photo associations are supplied as confirmed evidence. Unrelated memories are not sent. The model cannot create or edit memories automatically.
- Review, edit, and delete memories in **My context**. Stale edits are rejected rather than overwriting another tab's changes. Editing/deleting invalidates cached visual checks. The app is currently a **single-owner local prototype**, not a multi-account service.

### Trip photo pooling (browser app)

After a trip, find the photos on each friend's phone that include the other friends, and prepare a folder of them per person. This supports a manual trip test run by one organizer on one machine; nothing is sent to anyone.

1. Put each person's trip photos in `sample-dataset/<trip>/<person>/` (for example `sample-dataset/tahoe/alex/`), then click **Reload photo folders**. The `<person>` folder name records whose phone a photo came from.
2. Under **My context**, add each friend as a person with clear reference photos. The folder name should match the person's name or an alias.
3. Add the trip as a **Trip or event** with start and end dates, and tick its members.
4. Open **Trip photo pooling**, choose the trip, and click **Find people in trip photos**.
5. Review each person's suggestions and click **Export for <name>**.

How it works:

- On import, capture time (EXIF `DateTimeOriginal`, with its time-zone offset when recorded) and a coarse location are read from the original file before it is re-encoded. Exact GPS is never stored. Existing folder imports are filled in on the next scan; earlier browser uploads cannot be, because their originals were not kept.
- Trip photos are those captured between the trip's dates (local camera time, inclusive) plus any photos chosen on the trip memory. Photos without a capture date are counted but not included automatically; choose them on the trip memory to include them.
- One vision request checks up to 12 trip photos for all members at once, using up to two reference photos per member. People are labelled P1, P2 and so on, so names and relationships are not sent for this step. Each answer is present, absent, or uncertain with visible evidence. Results are saved in `.context.sqlite` per photo, person revision, and vision model, so rerunning costs nothing, and editing one person's reference photos re-checks only what is missing for them.
- A person is not suggested photos taken on their own phone. Uncertain matches are listed separately and exported only when chosen.
- Export writes `sample-dataset/.exports/<trip>/<person>/`. It uses the full-size original when the source file is unchanged, otherwise the stored 1,024-pixel copy. All metadata is removed except the capture time. Review the folder before sending it.
- A person who is a trip member cannot be deleted until they are removed from the trip.

Limits: identity comes from fallible vision-model judgments on whole images, not a face index; small, turned, or similar-looking people are often uncertain. Messaging apps often strip capture dates, so received copies may need to be added to the trip by hand.

Context persists in `sample-dataset/.context.sqlite` (SQLite, owner-only permissions), independently of embeddings. It is ignored by Git and excluded from portable photo/embedding bundles. Back up personal context separately with the server stopped (or use SQLite's backup facilities). API keys remain in memory and are never stored in this database. Requires Node 22.13+ with `node:sqlite` support.

**Current limits:** this is explicit memory retrieval plus model interpretation, not LoRA training or a dedicated face-recognition index. Whole-image similarity suggests candidates; it is not identity confidence. Personal-search scores are the maximum similarity to the visual query or a reference image, so calibrate thresholds separately from ordinary searches. Only the selected shortlist is visually checked; missing a candidate at retrieval cannot be fixed by verification. Import now keeps each photo's capture time and a coarse location (rounded to about 1 km) in its record, but personal search does not yet filter by capture date; trip pooling (below) does. The verifier must report uncertainty when the available evidence cannot establish a personal or temporal match. Relationships can be recorded as facts/aliases; structured relationship history, face crops/clustering, capture metadata, preference learning, and native Photos integration remain future work.

Validation: `npm test`, `npm run test:web`, and a browser walkthrough cover thresholds, empty results, personal-reference clarification, duplicate-name disambiguation, relevant-context isolation, edits, deletion, persistence, and existing provider/index behavior. Automated model responses are mocked; real-model recognition quality still needs evaluation on a consented personal collection.
