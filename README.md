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

### Actions on iPhone Photos

In the iOS app, tap **Select photos**, select individual photos or **Select all matches**, then **Review selected**. This creates a fixed selection independent of the search slider. The review screen supports:

- **Share / save to Files:** opens the native iOS share sheet with up to 100 full-resolution current still images. iCloud originals may need downloading; Live Photo motion is not included. Temporary export files are removed after completion or cancellation.
- **Favorite / unfavorite:** updates the original Photos assets in one PhotoKit change request.
- **Save to album:** adds originals to a uniquely named existing album, or creates a new album. Images are not duplicated. This implementation requires Full Photos Access for name-based album lookup, so an album hidden by limited access is not mistaken for a nonexistent destination.
- **Delete originals from Photos:** displays the exact selection count and an app confirmation, then delegates to Apple's confirmation. Phone app copies and their local mappings are removed only after PhotoKit confirms the complete deletion. Mac workspace copies and saved context remain. iCloud Photos can propagate deletion to other devices.

These actions run locally and do not require a model key or send images to Gemini/Qwen. They use Photos asset identifiers supplied by the picker, never guessed matches from previews or filenames. If any original is missing or inaccessible, the entire action fails before changes; no partial set is silently processed. Photos access is requested when an action needs it. Mobile Settings provides permission and limited-library management controls. If an old import has no asset ID, enable Photos access, remove its **app copy**, and reselect the original.

**Native build required:** the local Expo module in `apps/mobile/modules/captured-photos` uses Apple's PhotoKit and UIKit. Standard Expo Go does not include it; unsupported clients display an explanation and disable native actions while retaining search. Run `npm run ios` to generate/build the iOS project using Xcode and CocoaPods. For a physical device, run `npm run ios --workspace @captured/mobile -- --device` and complete development signing when requested. No native project files or signing credentials are committed. Rebuild after changing Swift code.

**Validation boundary:** JS tests cover selection snapshots, missing/duplicate IDs, cancellation, action dispatch, and cleanup of all corresponding phone copies. TypeScript and the iOS JavaScript bundle are checked. The PhotoKit operations file is typechecked against Apple's simulator SDK, and Expo autolinking detects the module. A signed build, native permission dialogs, iCloud downloads, real-library mutations, and share-sheet behavior still require simulator/device testing. Full-library sync and production accounts remain future work.

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

**Current limits:** this is explicit memory retrieval plus model interpretation, not LoRA training or a dedicated face-recognition index. Whole-image similarity suggests candidates; it is not identity confidence. Personal-search scores are the maximum similarity to the visual query or a reference image, so calibrate thresholds separately from ordinary searches. Only the selected shortlist is visually checked; missing a candidate at retrieval cannot be fixed by verification. Dates are retained as facts, but this image-copy pipeline currently strips capture metadata, so it cannot enforce capture-date constraints. The verifier must report uncertainty when the available evidence cannot establish a personal or temporal match. Relationships can be recorded as facts/aliases; structured relationship history, face crops/clustering, capture metadata, preference learning, and full-library synchronization remain future work.

Validation: `npm run typecheck`, `npm test`, `npm run test:web`, `npm run build:mobile`, and a browser walkthrough cover thresholds, empty results, personal-reference clarification, duplicate-name disambiguation, relevant-context isolation, edits, deletion, persistence, and existing provider/index behavior. Automated model responses are mocked; real-model recognition quality still needs evaluation on a consented personal collection.

The repeatable browser suite is `npm run test:browser` (install its browser with `npx playwright install chromium`); portable bundle tests are `npm run test:bundles`. Use Node 24 (`.nvmrc`). See the [October 2026 audit](docs/audit-2026-10-12.md) for fixes, verification results, remaining dependency advisories, and the distinction between tested application logic and untested live-model/iPhone behavior.

The web and LAN servers automatically load `artifacts/local/captured-5134-gemini-3072.zip` on startup when using the default sample collection. Python 3 verifies the bundle and restores missing photos and Gemini analysis, preserving existing valid embeddings, names, other providers, and personal context. No model calls are made. Keep this bundle on disk for recovery; it is not included in Git. Custom `CAPTURED_DATASET_DIR` collections are left alone unless you explicitly set `CAPTURED_DATASET_BUNDLE` to a bundle path. An invalid bundle stops startup with an error instead of silently starting an empty index.
