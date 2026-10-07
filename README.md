# Captured by Prompt

Search selected photos using image embeddings, optional visual verification, and user-confirmed personal context. The browser and Expo iOS app now use the **same backend**. Neither active client uses generated captions, keyword matching, or Jev ranking.

## Run the workspace

Use Node 24 LTS and run `npm install` at the repo root.

- **Browser only:** `npm run dev:web`, then open http://127.0.0.1:8790.
- **Browser and phone:** `npm run dev:lan` instead. This serves the same workspace, with authenticated phone access on your trusted Wi-Fi. Don't start both commands on the same port.
- **Mobile UI:** in another terminal, run `npm run dev:mobile` and open the project in a matching Expo development client or Expo Go version. iOS native runtime support must match Expo SDK 57.

`npm run dev:api` is an alias for the current shared backend. Connect Gemini or Qwen and load its key in the browser's Model connection panel. Provider keys stay in server memory. The phone uses that connection; paid usage depends on the provider account, and no free-tier promise is made.

For phone setup, enter your Mac's LAN address (for example `http://192.168.1.20:8790`) in mobile Settings. Paste the workspace token from `sample-dataset/.mobile-token` into the token field. This private file is created automatically by `dev:lan`, has owner-only permissions, and is ignored by Git. It is **not** a model API key. The token grants access to this single-owner workspace, so don't share it or expose the development server publicly. Local HTTP is intended for trusted development networks; remote hosting needs HTTPS and proper account isolation.

`CAPTURED_DATASET_DIR` chooses another workspace folder and `PORT` overrides 8790. Each workspace has a persisted `.dataset-id` so phone photo links cannot silently attach to a different collection. Browser-only mode rejects LAN clients; browser writes still require the existing session/Origin checks.

## Mobile flow and current boundaries

Choose photos with the native Photos picker, review cloud analysis, then tap **Analyze selected photos**. Only resized previews upload to the workspace; analysis is limited to those selections, rather than every photo already on the Mac. Completed embeddings persist on the server and can be reused after reconnecting. Gemini uses 3,072 dimensions and hosted Qwen uses its separate 2,560-dimensional index, exactly as in the browser.

Mobile search uses the same context clarification, saved memories, optional visual checks, and Broader/Stricter filtering as the browser. You can create, edit, and delete context on either client. The slider implementation is shared code. Mobile searches remain scoped to that phone's imported collection, including when the server also contains a large sample dataset.

The phone keeps original selected copies and Photos asset IDs when the picker supplies them; its database links these to server photo IDs per workspace. Existing imports are preserved, but the legacy 768-dimensional/caption-based phone index is not reused by the new engine. Upload/analyze once to attach old selections to the shared workspace. The collection limit is now 10,000, matching the browser; start with a small batch for device testing.

Removing phone copies does **not** delete Apple Photos originals, Mac workspace copies, or saved context. Native batch sharing, favoriting, album creation, deletion of originals, full-library sync, and production accounts are not implemented. This update aligns the mobile search app; it does not claim a completed PhotoKit integration. Simulator/device execution must still be verified with a compatible development client.

The original API in `apps/api` and legacy core retrieval contracts remain for historical regression coverage, available only through the explicitly named `npm run dev:legacy-api`. They are not used by either current client. New work should extend `playground/server.ts`, shared contracts in `packages/core/src/current.ts`, and the shared strictness utility. Product plans are in [Ideas and roadmap](docs/ideas-and-roadmap.md).

## Local browser frontend

Run `npm run dev:web` and open http://127.0.0.1:8790. Upload photos, load a Gemini API key, analyze, and search with image embeddings. Collection copies and embeddings persist in [`sample-dataset`](sample-dataset/README.md); the key stays in memory. This frontend uses image similarity without captions or keyword matching.

### Shared search controls and personal context

The browser app uses Gemini Embedding 2 at **3,072 dimensions** (or a separate hosted-Qwen index), with no filename or caption matching. Both current clients use this pipeline.

- **Broader / Stricter** adapts to the actual scores for each search. The broadest position shows all eligible results with cosine similarity at least `0.001` (a provisional positive floor). The middle keeps approximately the closest quarter; the strictest keeps the highest-scoring result(s). Equal scores stay together. The curve uses the eligible score distribution, including the choice to show uncertain visual assessments; failed assessments remain hidden. The slider and photo cards show no numeric similarity scores. Its relative position persists in this browser under a new settings key, independent of the old absolute cutoff. Filtering makes no model calls, and pagination uses the full search distribution rather than recalculating on each page. Search/clarification/error/reload states never fall back to unfiltered photos; use Browse collection explicitly. Reload preserves the query and asks you to run it again without automatic model calls. This control selects relative matches; it does not calibrate relevance probabilities.
- **My context** stores user-confirmed people, places, trips/events, objects/pets, and preferences. Each record has a stable ID, aliases, a distinguishing label, freeform facts, optional dates, reference photo IDs, provenance, timestamps, and an edit revision. Mark one person as **me**. Clear solo reference photos are best; people require at least one photo.
- With **Use my saved context** enabled, the connected provider interprets the query into visual content and personal references. This costs one generation request per new query per server session. Ordinary visual queries continue without a personal-memory lookup or automatic visual verification.
- Exact aliases resolve known entities. Unknown or ambiguous references pause search before embedding or verification. Choose an existing memory (an unknown phrase becomes an alias) or create one with photos; the original query resumes. Ambiguous choices apply only to that search, so two people called Mark keep distinct identities. A user can explicitly search visually without personal context instead.
- After resolution, one additional cached generation request translates relevant confirmed facts into a visual search query (for example, “my old apartment” plus “red kitchen”). Personal searches retrieve candidates using that grounded visual query and the first two reference-image embeddings per entity, then check the top 12 against the **original** query and relevant confirmed facts. Up to two reference images per entity are sent to the vision model. Saved reference-photo associations are supplied as confirmed evidence. Unrelated memories are not sent. The model cannot create or edit memories automatically.
- Review, edit, and delete memories in **My context**. Stale edits are rejected rather than overwriting another tab's changes. Editing/deleting invalidates cached visual checks. The app is currently a **single-owner local prototype**, not a multi-account service.

Context persists in `sample-dataset/.context.sqlite` (SQLite, owner-only permissions), independently of embeddings. It is ignored by Git and excluded from portable photo/embedding bundles. Back up personal context separately with the server stopped (or use SQLite's backup facilities). API keys remain in memory and are never stored in this database. Requires Node 22.13+ with `node:sqlite` support.

**Current limits:** this is explicit memory retrieval plus model interpretation, not LoRA training or a dedicated face-recognition index. Whole-image similarity suggests candidates; it is not identity confidence. Personal-search scores are the maximum similarity to the visual query or a reference image, so calibrate thresholds separately from ordinary searches. Only the selected shortlist is visually checked; missing a candidate at retrieval cannot be fixed by verification. Dates are retained as facts, but this image-copy pipeline currently strips capture metadata, so it cannot enforce capture-date constraints. The verifier must report uncertainty when the available evidence cannot establish a personal or temporal match. Relationships can be recorded as facts/aliases; structured relationship history, face crops/clustering, capture metadata, preference learning, and native Photos integration remain future work.

Validation: `npm run typecheck`, `npm test`, `npm run test:web`, `npm run build:mobile`, and a browser walkthrough cover thresholds, empty results, personal-reference clarification, duplicate-name disambiguation, relevant-context isolation, edits, deletion, persistence, and existing provider/index behavior. Automated model responses are mocked; real-model recognition quality still needs evaluation on a consented personal collection.
