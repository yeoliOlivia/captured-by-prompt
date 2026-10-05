# captured-by-prompt

# Captured by Prompt — Free 30-photo prototype

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
