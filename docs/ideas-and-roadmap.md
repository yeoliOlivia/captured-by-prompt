# Captured by Prompt — Ideas and roadmap

Living planning notes, updated October 27, 2026. These are product ideas, hypotheses, and proposed experiments—not commitments or claims that everything below is implemented. See the [README](../README.md) for setup and documented current behavior.

## Product direction

**Current pivot:** group-trip photo curation. The newer [trip product and architecture plan](trip-product-plan.md) combines places, people, recaps, reviewed photo handoffs and aesthetic picks. The sections below preserve the earlier search and personalization research.

Find the photos a person means, including the personal context behind their words. Better visual retrieval matters, but the more interesting direction is understanding who “Mark” is to me, what I look like, and what “the Japan trip” means in my library.

The system should retrieve relevant saved context and ask for clarification only when needed. Over time, it should also learn which photos I consider good matches, including subjective distinctions that visual similarity alone misses.

## Where the prototype stands

As currently documented in the README, the browser app already has:

- Image-embedding search at 3,072 dimensions, plus a separate hosted-Qwen index option.
- An adjustable Broader / Stricter cosine-similarity cutoff.
- User-confirmed context records for people, places, trips/events, objects/pets, and preferences, including aliases and reference photos.
- Clarification for unknown or ambiguous personal references, relevant-memory retrieval, and visual checking of a candidate shortlist.

This is a starting point to evaluate, not evidence that recognition or personalization is solved. It is a single-owner local prototype; learned user preferences and per-user model adapters are future work. Revisit this section as implementation changes; keep detailed behavior in the README.

## 1. Evaluate existing models before training

Start by testing whether existing closed-source frontier vision models are sufficiently good for the intended searches. Compare against the current retrieval pipeline, and separate failures to retrieve a photo from failures to rank or assess it correctly.

Build a small, representative evaluation set with queries, expected matches, difficult negatives, and reasons for inclusion or exclusion. Include:

- Visual details: “tennis on grass.”
- Identity: “Mark,” “me,” and two different people called Mark.
- Personal events: “the Japan trip.”
- Subjective intent: romantic photos versus platonic photos with the same person.
- Queries with no matching photos and queries that genuinely need clarification.

Track retrieval coverage, ranking quality, incorrect inclusions, unnecessary clarification, latency, and cost. Define acceptable results before choosing a training path; exact targets remain open.

**Observation to preserve:** increasing embedding dimensions fixed “tennis on grass” in an earlier experiment. Record the configuration and add it as a regression example. This suggests testing representation and retrieval settings before assuming fine-tuning is needed; it does not establish that more dimensions solve every failure.

## 2. Fine-tune a shared model only if evaluation justifies it

If existing models fall short, investigate a suitable Qwen vision-language model as a shared ranking or relevance model. Choose the exact model and training objective based on the failure cases from step 1.

Proposed loop:

1. Categorize failures: visual understanding, candidate retrieval, missing context, or subjective preference.
2. Label examples that address the observed model failures, including hard negatives and textual explanations.
3. Train a shared model and compare it with the baseline on held-out examples.
4. Adopt it only if the quality improvement justifies the serving and training complexity.

Missing personal facts should first be addressed through context. A ranking model also cannot recover relevant photos that never reach its candidate set. Using personal feedback to improve a shared model would require an explicit data-use decision and user permission.

## 3. Learn each user's preferences from feedback

Hypothesis: a globally improved ranking model could be paired with a lightweight personal component for users who provide enough feedback. New users would begin with the shared baseline and explicit saved context.

Possible feedback ritual:

- Swipe or mark a photo as relevant / not relevant for the current query.
- Optionally explain a correction in text: “This image should not be included because it's a platonic photo between me and my ex, not a lovey-dovey one.”
- Retain the query and relevant context with the correction so a judgment about one search does not become a universal rule about that photo.

Typed corrections may be more useful than binary labels because they explain *why* a result is wrong. Explore whether each correction represents a one-query judgment, a lasting preference, or a factual context update; confirm lasting facts rather than silently treating every comment as one.

Candidate approaches to compare, from simpler to more involved:

- Retrieve explicit preferences alongside personal context.
- Train a small per-user linear ranking head on fixed representations.
- Train a per-user LoRA adapter if enough feedback supports it.

A linear head and a LoRA adapter are different designs, not interchangeable names for the same layer. Keep both as experiments until the evidence supports a choice. Define “enough feedback,” test on held-out user judgments, and support resetting learned preferences.

## 4. Make the personal context engine the main product exploration

Build on the existing explicit-memory flow: retrieve relevant personal facts and reference photos, use them to interpret a query, and clarify unknown or ambiguous references before proceeding.

Example experience:

1. I search for “photos of Mark.”
2. If Mark is unknown, the app asks “Who's Mark?” and lets me select reference photos.
3. I can add a distinguishing label such as “Mark from college,” “Mark from soccer,” or a last name.
4. If multiple Marks match later, the app asks which one I mean.
5. Once resolved, the original search resumes using the relevant context.

Apply the same pattern to “me,” trips, places, and other personal references. For “the Japan trip,” useful confirmed context might include dates, locations, companions, and example photos. Date-based filtering would also require reliable photo metadata; the current browser copy pipeline does not retain capture metadata.

Design questions to explore:

- When is the evidence sufficient to search, and when should the app ask a question?
- Which reference photos best establish a person, especially in group photos?
- How should changing relationships or repeated trips be represented over time?
- How can users inspect, correct, and delete context without a heavy setup process?
- Which feedback should update saved context versus influence ranking?

Keep personal context separate from model weights so users can review and edit confirmed facts directly. Whole-image similarity alone should not be treated as proof of identity.

## 5. Give users control over selection strictness

Keep the adjustable cosine-similarity threshold and evaluate how understandable it is in practice. The existing Broader / Stricter control is the first version of this idea.

- Allow users to broaden or narrow the selected set without rerunning analysis when cached scores suffice.
- Preserve genuinely empty results instead of always returning something.
- Calibrate defaults against labeled searches; cosine scores are not probabilities.
- Evaluate thresholds separately across embedding models and personal-reference searches, whose scores may behave differently.

## 6. Social direction: trip pooling, map, and recaps

After a trip, friends pool their photos on a shared map, the app finds who is in each photo, and it builds recaps that make curation easy. Personal search stays the everyday use; a public layer comes only after the private loop works. Priorities remain cost first, then efficiency, then quality. The editable plan lives in the [Social direction plan](https://claude.ai/code/artifact/f67c45a1-2b33-4ac9-a2a9-fad368654b58).

Where it stands: trip pooling is built and tested on the `map-version` branch (capture time, location rounded to about 1 km, contributor from folder name, trips with dates and members, a batched and cached vision check of who appears in each photo using anonymous labels, and per-person export). It was merged into `main` before the October 27 group-trip studio work. The iPhone app has no trip view, and phone imports do not record a contributor.

Phases, each gated on the one before:

1. **Land pooling on main.** Port `map-version` onto current `main`, resolve the two conflicts, and rerun all tests. Gate: `npm test`, `npm run test:web`, and a manual trip run on sample folders pass.
2. **Trip map.** Show a trip's pooled photos on a map using the stored coarse location, grouped by place and filtered by member. Gate: works in the browser and the iPhone app, and phone imports record a contributor.
3. **Recaps and collages.** Extract color palettes on the device, group photos by mood with existing embeddings, and fill collage templates; use a model call only for an optional caption. Gate: a sample-trip recap needs at most one paid call.
4. **Opt-in public landmark feed.** Pinterest-style "what others shot here," with posts snapped to named landmarks and empty spots seeded with openly licensed geotagged photos. Gate: the guardrails below are enforced, and hosting and moderation costs are estimated first.

Guardrails:

- Store and share only rounded locations or named landmarks, never exact GPS, which reveals homes and routines.
- A public post may show only people who opted in; otherwise it must contain no people or blur faces.
- Trip suggestions go only to trip members, never return a person's own photos, and send uncertain matches only when picked.
- Identification never sends names or relationships to the model.
- Run color and recap analysis on the device and cache every vision result.
- Apply "the more you share, the more you get" inside a trip (see friends' photos of you once you share yours), not publicly, where it rewards low-effort uploads.

## Proposed next steps

- [ ] Assemble a small evaluation collection and query set, preserving the “tennis on grass” example.
- [ ] Define quality, latency, and cost targets for the baseline comparison.
- [ ] Evaluate frontier models and the current pipeline; document where each fails.
- [ ] Walk through unknown Mark, duplicate Marks, “me,” and “the Japan trip” to assess the context experience.
- [ ] Prototype binary and textual feedback capture before choosing a personal training method.
- [ ] Compare explicit preference retrieval with a lightweight learned ranker.
- [ ] Decide whether shared Qwen fine-tuning or per-user LoRA is warranted by the results.
- [x] Port trip pooling from `map-version` onto `main` and rerun all tests.
- [ ] Add a trip map and record a contributor for iPhone imports.
- [ ] Prototype on-device color and mood recaps for a sample trip.

## Open decisions

- What level of search quality is good enough for the first useful product?
- Is the largest remaining problem retrieval, visual judgment, context, or personal taste?
- How much feedback will users realistically give, and how quickly should it help?
- What model-serving cost and latency are acceptable?
- Which personal data stays local, which reaches model providers, and what may be used for shared training?
- How do friends' photos reach one organizer without a server: AirDrop, a shared iCloud album, or a small relay?
- Which map provider: Apple MapKit on iPhone, and which tile source in the browser?
- Is a "vibe" a color palette only, or named mood clusters?
- Is a public feed a separate app or a tab in this one?
- Where do relationship labels and feedback learning fit relative to the social phases?

Add new ideas here as they arise. Record experiment outcomes and accepted decisions alongside them so tentative ideas do not silently become requirements.
