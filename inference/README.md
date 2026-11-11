# Self-hosted embeddings on Modal

This folder runs the open [Qwen3-VL-Embedding-2B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B) model (Apache-2.0) on your own [Modal](https://modal.com) account. The app then uses it through the **Modal** provider in the Model connection sheet. Photos are sent only to your Modal account to be embedded.

This is phase 1 of the move to Modal. Only embeddings run on Modal. Embeddings are the vectors that search ranks photos by. Visual checking, personal context and trip people checks still use Gemini, and only if you also paste a Gemini key. Without one, plain search works and those features say they need a Gemini key.

## Files

| File | Purpose |
| --- | --- |
| `modal_app.py` | The Modal app. It runs one L4 GPU class that loads the model with vLLM and serves `POST /embed` and `GET /health`. |
| `embed_api.py` | The HTTP layer: bearer-token check, input validation and vector normalization. It has no Modal or GPU dependency. |
| `test_embed_api.py` | Offline tests for `embed_api.py`. Run them with `npm run test:inference`. |

## Cost and limits

- **GPU:** one NVIDIA L4 at $0.000222 per second, about $0.80 per hour ([Modal pricing](https://modal.com/pricing), checked 2026-11-09). When no L4 is free, Modal falls back to an A10G (about $1.10 per hour) and then an L40S (about $1.95 per hour). CPU and memory add roughly $0.20 per hour.
- **Billing:** you pay only while a container runs. It starts on the first request and stops after 5 idle minutes (`SCALEDOWN_SECONDS`).
- **Spending cap:** `max_containers=1` means at most one GPU runs at a time.
- **Cold start:** the first request after an idle period waits for the container to boot and the model to load. Expect roughly 30 to 90 seconds. This has not been measured. The app allows 10 minutes per Modal request, enough for the first-ever start, which also downloads the weights.
- **Weights:** they download from Hugging Face once into the `captured-hf-cache` Volume. A Volume is Modal's persistent disk, and the weights take about 4.5 GB. Modal includes 1 TiB of Volume storage per month free.

## Deploy

Deploying spends Modal credit when the endpoint is used. All commands use `uvx`, so nothing is installed globally.

1. Log in once. This opens a browser and saves a token to `~/.modal.toml`:
   ```sh
   uvx modal token new
   ```
2. Create the secret the endpoint checks, from the repository root. `npm run token` makes a random 64-character value. The `echo` prints it so you can save it in your password manager for step 4:
   ```sh
   INFERENCE_TOKEN=$(npm run --silent token); echo "$INFERENCE_TOKEN"
   uvx modal secret create captured-inference INFERENCE_TOKEN="$INFERENCE_TOKEN"
   ```
3. Deploy from the repository root:
   ```sh
   cd inference && uvx modal deploy modal_app.py
   ```
   The command prints a URL ending in `modal.run`. That is the endpoint.
4. In the app's Model connection sheet, choose **Modal**, paste the endpoint URL and the `INFERENCE_TOKEN`, and optionally a Gemini key. Then click **Analyze photos** to build the Modal index. Your Gemini and Qwen indexes stay saved. To skip pasting the URL every time, start the server with `MODAL_EMBED_URL=<url>` set.

To check the endpoint without the app:

```sh
curl -L -H "Authorization: Bearer $INFERENCE_TOKEN" <url>/health
```

On a first start this can take a few minutes. Add `-L` so curl follows the redirect Modal sends when a request takes over about 150 seconds; the app does the same.

## Save your settings so you don't paste them every time

1. Copy the example file: `cp .env.local.example .env.local` (from the repository root). Git ignores `.env.local`, so it is never committed.
2. Open `.env.local` and fill in `MODAL_EMBED_URL` (the `.modal.run` URL), `MODAL_INFERENCE_TOKEN`, and optionally `GEMINI_API_KEY`.
3. Start the app with `npm run dev:modal` instead of `npm run dev:web`. It starts already connected to Modal. `npm run dev:web` still works as before and ignores the file.

The keys stay in that file and in the server's memory; they are never sent to the browser.

## Stop or remove

- `uvx modal app stop captured-inference` stops the deployment. A stopped app cannot start a GPU.
- `uvx modal volume delete captured-hf-cache` and `uvx modal volume delete captured-vllm-cache` remove the cached weights.

## Compare against Gemini and hosted Qwen

`scripts/compare-providers.ts` indexes the same labelled photo set with each provider, in temporary collections. It reports these numbers:

- **Recall@10:** the share of correct photos in the top 10.
- **MRR:** how high the first correct photo ranks. 1.0 means always first.
- **nDCG@10:** a 0 to 1 ranking score that rewards correct photos placed higher.
- **Timing:** seconds per query, with the first query reported separately because it includes any cold start.
- **Cost:** an upper-bound Modal cost estimate.

To run it, copy `docs/provider-benchmark.example.json`, point it at 20 to 30 photos you own, and label each query's correct photos before running any model. Then run:

```sh
GEMINI_API_KEY=... MODAL_INFERENCE_TOKEN=... MODAL_EMBED_URL=https://... \
  npm run bench:providers -- --manifest=/absolute/path/benchmark.json --providers=gemini,modal --consent
```

- Add `qwen` to the providers list, with `QWEN_API_KEY` set, to include hosted Qwen.
- Add `--verify` to also score the visual checks. With Modal, these use Gemini.
- Results are saved to `artifacts/local/provider-comparison.json`.
- The script sends the manifest photos to every listed provider, so it requires `--consent`.

## Choices that may need tuning

- **Model size:** the 2B model returns 2,048 numbers per vector. The 8B model (`Qwen/Qwen3-VL-Embedding-8B`, 4,096 dimensions) may be more accurate. It fits an L4 but with little headroom, so an L40S is safer, at about $1.95 per hour. To switch, change `MODEL`, `MODEL_ID` and `DIMENSIONS` here and `CONFIG.modal` in `playground/providers.ts`. Switching means re-indexing.
- **Query instruction:** search queries use the instruction "Retrieve images or text relevant to the user's query." and photos use the model card's default. The model card says task-specific instructions change results by about 1 to 5%; compare alternatives with the benchmark.
- **vLLM version:** pinned to 0.21.0, the version Modal's current vLLM example uses. If deploy fails on the Qwen3-VL model, try a newer vLLM.

Not yet verified: no deploy has been run. The GPU code path, which loads vLLM and runs the model, has not been tested; only the HTTP layer has offline tests.
