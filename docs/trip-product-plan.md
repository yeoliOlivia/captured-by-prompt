# Captured: the shared trip, edited together

Product and implementation plan, October 27, 2026. The roadmap below is a design, not a claim that a hosted social service has shipped.

## The pivot

Make the shared album useful after everyone gets home: **everyone's photos, your favorites, one good story**.
The central object becomes a private trip with contributors, places, people, and a jointly curated collection.
Search and context remain core infrastructure; the front door becomes a beautiful trip rather than a search box.
The Beli analogy is personal taste, comparisons, shared discovery, and a record of experiences—not a leaderboard of people's looks.

The first repeatable loop is: create trip → friends contribute → find my photos → save a few favorites → make a shared edit → invite the next contributor.
Prioritize getting someone the great photo of them on a friend's phone. A generated statistic should help the group revisit the trip, not become the whole product.

## One experience combining the ideas

| Surface | What it does | Evidence and control |
| --- | --- | --- |
| Trip album | Pools contributions; separates people, scenery, favorites, and the final edit | Preserve contributor credit and source links; do not fabricate counts |
| Places | Groups albums and photos by a coarse location or named place | Use retained EXIF or a user-confirmed place; expose missing locations |
| Search | Finds people, activities, places, visual details, and requested moods | Keep real image embeddings, context clarification, and optional visual verification |
| People | Lets a member identify themselves, review suggestions, and collect their photos | Identity suggestions require review; ambiguous people remain unknown |
| The edit | Suggests strong shots, reduces duplicates, and helps choose a coherent carousel | Explain blur, framing, lighting, scene variety, and visible face quality |
| Trip receipts | Shows frequent activities, photographed places, appearances, and contributor counts | Every statistic states its coverage and lets someone inspect the photos |
| Social layer | Lets friends save, compare, vote, and build a shared shortlist | Begin within a private trip; public profiles and feeds are later experiments |

Useful small delights: a printable trip contact sheet, a place-by-place photo trail, a group-selected cover, and “the shots you almost missed.”
“Send Mark his photos” should prepare a reviewed selection for the native share sheet or a scoped album link; it must not silently contact anyone.
“Happy photos” can suggest visibly smiling/laughing moments and let the user refine the result. It cannot establish anyone's internal emotional state.
“Everyone looks good” means an explicitly selected group has sufficiently visible, sharp, unoccluded faces; uncertain cases stay reviewable.
Never turn aesthetic photo ranking into beauty scores, personality judgments, or an inference about who is most liked.

## What this iteration establishes

- `/studio` is the new product demo: a clearly labelled illustrative Lisbon trip with editorial photography, places, an edit, and playful trip statistics.
- Demo photos, names, annotations, locations, and rankings are examples. They are not evidence that our models recognized that trip or those people.
- Local trip-scoped annotations and their analysis coverage persist in SQLite; this is an organizer's workspace, not a production identity or membership service.
- Explicit analysis requests accept at most 12 selected trip photos. Jobs persist request IDs, model/version, state, and saved/cached/protected/skipped counts; SQLite reservations prevent another local server from starting overlapping analysis work in that workspace.
- Studio preparation now uses the existing Gemini/Qwen connection: it checkpoints missing image embeddings before running scene observations. The live UI exposes connection status, separate embedding/observation coverage, and saved job recovery. Provider changes retain separate indexes and clear stale search results.
- Confirmed trip people become scoped context memories for search, with clarification for ambiguous names or missing reference photos. Search cannot widen beyond the current trip. Only the top 12 retrieved candidates are verified, so this is not an exhaustive “all matching photos” result yet.
- Results are validated before saving as `schemaVersion: 1` annotations with a model/version, evidence summary, nullable visual judgments, and an edit revision. Concurrent user edits are preserved while unaffected results can still save.
- Restart recovery marks jobs whose owning process has stopped as interrupted and never automatically repeats a paid request. Reusing a request ID returns its saved job; any new paid attempt must be explicit.
- The existing workspace supplies real uploads, Gemini/Qwen image-embedding search, saved context, and cached trip-person checks through the current backend.
- Existing trip pooling can prepare per-person exports after review. It does not send them to friends or automatically share an iCloud album.
- Existing iPhone actions cover accessible original assets, but a signed build and actual-device validation remain necessary.
- Production accounts, invites, object storage, background cloud sync, calibrated aesthetic ranking, and personal model adapters are subsequent work.

Keep the demo isolated from the user's saved image embeddings and personal context. Switching to the local collection must say which data and capabilities are live.
Missing analysis should read “not analyzed,” never zero occurrences. No API key should be necessary to explore the illustrative experience.

## Data model and deployment path

Keep the current Fastify service and shared TypeScript contracts. Split new concerns into modules instead of adding every route to one server file.
SQLite is sufficient for the local proof; use PostgreSQL plus a durable queue and object storage when adding actual accounts and concurrent contributors.
Do not expose the existing single-owner LAN token service to the public internet as a substitute for account isolation.

| Entity | Essential fields / responsibility |
| --- | --- |
| Account and trip membership | Stable user/trip IDs; owner, contributor, viewer roles; invitation expiry; revoked membership |
| Trip | Name, dates, timezone, cover, visibility, explicit photo membership, revision |
| Asset and contribution | Content hash, upload owner, trip membership, original/derivative references, capture metadata, source provenance |
| Source link | Device/library identity, local Photos identifier, optional cloud mapping, access/revocation state; never assume IDs match across devices |
| Person and presence | Trip-scoped person identity, optional linked account, approved references, face/region evidence, suggestion versus confirmation |
| Observation | Photo, schema version, model version, evidence, confidence/uncertainty, prompt version, status, timestamp |
| Vote and edit | Actor, photo, trip, action or comparison, intent, ordered shortlist, revision, optional explanation |
| Job and event | Idempotency key, state, attempt count, lease, budget, result/error, next retry; durable event outbox |

Store originals privately and separately from resized model inputs and thumbnails. Use short-lived authorized URLs, not public buckets.
Keep a contributor's source link even when content deduplication finds the same image; upload ownership and appearance in a photo are different facts.
Retain capture time and its known offset; unknown timezone is unknown. The existing EXIF importer keeps coordinates rounded to two decimals.
Offer place correction and missing-location states. A model's visual guess of a landmark is a suggestion, not GPS evidence.
Apply membership checks to images, search, exports, jobs, and events. Removing a trip member revokes future access; copied exports cannot be recalled.
Deletion must distinguish removing a contribution, deleting our stored copies, and deleting an original in iOS Photos.

## Analysis that survives restarts

Pipeline: ingest → content hash/deduplicate → capture metadata → derivatives → embedding → optional structured observations → reviewed curation.
Image embeddings stay **image → vector**. Structured visual observations are a separate reusable feature, not captions substituted for those vectors.
Keep Gemini `gemini-embedding-2:3072` and hosted Qwen `qwen3-vl-embedding:2560` in separate indexes; never compare across spaces.
Key every cached artifact by input hash, provider/model version, output dimensions where applicable, schema/prompt version, and relevant reference revision.
Changing a person's reference photos should invalidate affected presence suggestions, not unrelated scene analysis or every embedding.
Preserve existing bundle recovery and never require a full collection to be reanalyzed merely because the UI or product name changes.

Structured observations can cover visible activity, people/scenery composition, lighting, sharpness, face visibility, and duplicate groups.
Require schema validation and per-field evidence; unsupported or ambiguous attributes remain unknown. Keep model suggestions separate from human corrections.
The first local version protects the entire annotation once a user edits it, including an identity-only confirmation; later scene analysis skips that photo and reports it as protected, not cached. A missing image embedding is still prepared so the photo remains searchable. Separate per-field model observations and human overrides are future work.
Counts use confirmed labels or explicitly identified model estimates. Show “reviewed 80 of 200 photos,” not an unexplained “Mark: 42.”
For appearances, count a person once per photo and expose burst duplicates; photo frequency does not measure time spent or attendance.
For activity frequency, state whether the unit is photos or deduplicated moments, and do not infer “what we did most” from camera frequency alone.

The implemented local job states are running, complete, failed, and interrupted; there is no queued worker fleet, automatic retry, cancellation, or spend-budget engine yet.
For future cloud workers, persist queued/running/succeeded/failed/cancelled jobs before work starts. Recover expired leases on restart; checkpoint results per image or batch.
Use a unique job key and transactional result writes so retries do not duplicate records. External model calls can still be charged twice after a timeout; track this possibility.
Bound batch size and concurrency; retry only transient failures with backoff, cap attempts, expose retry/cancel, and keep terminal errors actionable.
Show an estimate before bulk analysis, enforce per-trip/provider budgets, and stop creating new calls when the budget is exhausted.
An event outbox can later deliver “your edit is ready” notifications after opt-in. A queued event is not proof a message was sent.

## Ranking, feedback, and taste

First filter to the authorized trip, then retrieve candidates with embeddings/context, then optionally rerank against the user's actual intent.
Keep distinct scores for relevance, technical image quality, subjective aesthetics, group face coverage, and editorial variety.
“Scenery,” “everyone together,” “candid,” and “sunset palette” need different ranking objectives; give users simple modes instead of one universal beauty score.
Build the final edit with near-duplicate suppression, place/time variety, and a configurable cap—not simply the ten highest individual scores.
Collect pairwise choices (“which would you post?”), keep/reject decisions, and typed reasons with the query, candidate set, user, trip, and model version.
Treat a factual correction, a one-query preference, and a lasting taste preference as different records. Confirm identity/context changes explicitly.
Begin personalization with saved preferences and a small ranking layer; compare it against a fixed baseline on held-out trips.
Only consider shared fine-tuning or per-user LoRA after enough distinct feedback improves held-out results. Global training needs separate opt-in; private trip participation is not consent to it.

## iPhone and iCloud: the supported path

Use the native Photos picker first: it shares selected content without requiring access to the whole library. [Apple Photos picker privacy](https://developer.apple.com/videos/play/wwdc2025/246/)
Selected content may need to download from iCloud; show progress, cancellation, and offline errors. [Apple PhotosPicker sample](https://developer.apple.com/documentation/photokit/bringing-photos-picker-to-your-swiftui-app)
For PhotoKit-managed assets, `PHImageRequestOptions.isNetworkAccessAllowed` enables an iCloud image download; the current native sharing code already sets it. [Apple request option](https://developer.apple.com/documentation/photos/phimagerequestoptions/isnetworkaccessallowed)
Ask for broader PhotoKit access only when the workflow needs library management, and continue to respect limited access and later permission changes.
PhotoKit distinguishes iCloud Shared Album assets, which Apple documents as non-editable. Treat those sources as read-only and export an allowed copy when needed. [Apple shared asset type](https://developer.apple.com/documentation/photos/phassetsourcetype/typecloudshared)
Device-local Photos identifiers differ across libraries; Apple's cloud identifiers map assets between devices associated with the account. They do not grant a friend permission to another person's library. [Apple identifier mapping](https://developer.apple.com/videos/play/wwdc2021/10046/)
CloudKit stores data in app containers. It is not an API granting this server arbitrary access to someone's iCloud Photos library. [Apple CloudKit containers](https://developer.apple.com/documentation/cloudkit/ckcontainer)
Therefore scope “iCloud pull” to user-selected, authorized device imports. A general server-side iCloud Photos connector is unsupported in this plan; do not collect Apple passwords or promise automatic album mirroring.
Next device test: select local and cloud-only photos; retry offline; reconnect; share/favorite/add to album; revoke access; confirm source IDs and saved analysis survive.

## First real test and release gates

Recruit one consenting group of about 20 adults, ideally from a completed trip with 500–2,000 mixed-quality photos from several phones.
Give each contributor an import preview and attribution; ask members to label their own reference photos and review any identity suggestions.
Start with one organizer and explicitly transferred files until accounts/storage exist. That setup tests usefulness without pretending the demo is cloud collaboration.
Prepare 40–60 searches with known answers: named people, same-name ambiguity, places, activities, conjunctions, exclusions, vague moods, and no-match queries.
Include night photos, sunglasses, occlusion, similar-looking friends, bursts, mixed timezones, missing EXIF, and cloud-only iPhone assets.
Record recall@50 before reranking and precision@10 after it; separately score wrong-person inclusions and unknown cases. Do not hide failures behind aesthetic scores.
Measure pairwise preference agreement, group-face coverage, duplicate rate, correction burden, time to a shareable edit, latency, and provider cost per trip.
For statistics, audit against reviewed ground truth and require correct denominators/coverage. For sharing, require a reviewed recipient set and zero unintended sends.
Before cloud deployment, add cross-account authorization tests, membership-revocation tests, resumable uploads, job crash/retry tests, and deletion/export tests.
Before calling rankings personalized, hold out an entire later trip; compare the personal ranker with the global baseline and allow reset.
Product success is that friends retrieve missed photos and actually use the shared edit. Decide public feeds, recaps, and training investments from that evidence.
