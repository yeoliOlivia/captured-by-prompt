"""Self-hosted image and text embeddings on Modal (phase 1 of the Modal plan).

Serves Qwen/Qwen3-VL-Embedding-2B with vLLM on one L4 GPU behind a bearer token.
The container starts on the first request and stops after SCALEDOWN_SECONDS idle,
so it costs nothing while unused. See inference/README.md for deploy steps and costs.
"""

import os
import threading

import modal

MODEL = "Qwen/Qwen3-VL-Embedding-2B"
# Name the app reports to clients; playground/providers.ts CONFIG.modal.model must match.
MODEL_ID = "qwen3-vl-embedding-2b"
DIMENSIONS = 2048
# The model card's default instruction; used for photos (the "documents" being searched).
IMAGE_INSTRUCTION = "Represent the user's input."
# Task-specific instruction for search queries. The model card says task instructions
# help by roughly 1-5%; compare alternatives with scripts/compare-providers.ts.
QUERY_INSTRUCTION = "Retrieve images or text relevant to the user's query."
SCALEDOWN_SECONDS = 300

app = modal.App("captured-inference")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("vllm==0.21.0", "fastapi[standard]", "pillow")
    .add_local_python_source("embed_api")
)

# Weights download from Hugging Face once and are reused by later cold starts.
hf_cache = modal.Volume.from_name("captured-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("captured-vllm-cache", create_if_missing=True)


@app.cls(
    gpu="L4",
    image=image,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_name("captured-inference")],
    scaledown_window=SCALEDOWN_SECONDS,
    # Spending cap: never more than one GPU, however many requests arrive.
    max_containers=1,
    timeout=600,
)
class Embedder:
    @modal.enter()
    def load(self):
        from vllm import LLM

        self.llm = LLM(
            model=MODEL,
            runner="pooling",
            trust_remote_code=True,
            dtype="bfloat16",
            max_model_len=8192,
            gpu_memory_utilization=0.85,
        )
        self.tokenizer = self.llm.get_tokenizer()
        # vLLM's offline LLM object is not safe to call from several request threads at once.
        self.lock = threading.Lock()

    def embed(self, text, image):
        # Same conversation shape as the model card's vLLM example: a system message with the
        # instruction, then a user message holding the image or the text.
        content = [{"type": "image", "image": image}] if image is not None else [{"type": "text", "text": text}]
        instruction = IMAGE_INSTRUCTION if image is not None else QUERY_INSTRUCTION
        conversation = [
            {"role": "system", "content": [{"type": "text", "text": instruction}]},
            {"role": "user", "content": content},
        ]
        prompt = self.tokenizer.apply_chat_template(conversation, tokenize=False, add_generation_prompt=True)
        request = {"prompt": prompt}
        if image is not None:
            request["multi_modal_data"] = {"image": image}
        with self.lock:
            (output,) = self.llm.embed([request])
        return output.outputs.embedding

    @modal.asgi_app()
    def web(self):
        # Imported here, inside the container, so `modal deploy` does not need FastAPI installed locally.
        from embed_api import create_app

        return create_app(self.embed, os.environ["INFERENCE_TOKEN"], MODEL_ID, DIMENSIONS)
