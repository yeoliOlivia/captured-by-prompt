"""HTTP layer for the self-hosted embedding service.

Kept free of Modal and vLLM imports so it can be tested on any machine
(see test_embed_api.py). inference.py plugs the real model in.
"""

import base64
import binascii
import hmac
import io
import math
from typing import Callable, Optional

from fastapi import FastAPI, Header, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, model_validator

# The app server resizes photos to at most 1024 px JPEGs (playground/server.ts), so 20 MB is generous.
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 4000

# embed(text, image) -> raw vector. Exactly one of text or image is set.
EmbedFn = Callable[[Optional[str], Optional[Image.Image]], list]


class EmbedRequest(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TEXT_CHARS)
    # Base64-encoded JPEG or PNG bytes, without a data: prefix.
    image: Optional[str] = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def exactly_one(self):
        if (self.text is None) == (self.image is None):
            raise ValueError("Send exactly one of text or image.")
        return self


def _decode_image(data: str) -> Image.Image:
    if len(data) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise HTTPException(413, "Image too large.")
    try:
        raw = base64.b64decode(data, validate=True)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (binascii.Error, ValueError, UnidentifiedImageError, OSError):
        raise HTTPException(400, "Image is not valid base64 JPEG or PNG data.")
    return image.convert("RGB")


def normalize(values, dimensions: int) -> list:
    vector = [float(v) for v in values]
    if len(vector) < dimensions:
        raise ValueError(f"Model returned {len(vector)} dimensions, expected {dimensions}.")
    # Matryoshka (MRL) models allow keeping only the leading dimensions; renormalize afterwards.
    vector = vector[:dimensions]
    if not all(math.isfinite(v) for v in vector):
        raise ValueError("Model returned a non-finite value.")
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        raise ValueError("Model returned a zero vector.")
    return [v / norm for v in vector]


def create_app(embed: EmbedFn, token: str, model: str, dimensions: int) -> FastAPI:
    if len(token) < 32 or any(c.isspace() for c in token):
        raise RuntimeError("INFERENCE_TOKEN must be at least 32 characters with no whitespace.")
    expected = f"Bearer {token}".encode()
    # No interactive docs: the endpoint is reachable from the internet.
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    def authorize(authorization: Optional[str]) -> None:
        if not authorization or not hmac.compare_digest(authorization.encode(), expected):
            raise HTTPException(401, "Missing or wrong bearer token.")

    @app.get("/health")
    def health(authorization: Optional[str] = Header(default=None)):
        authorize(authorization)
        return {"ok": True, "model": model, "dimensions": dimensions}

    @app.post("/embed")
    def embed_one(request: EmbedRequest, authorization: Optional[str] = Header(default=None)):
        authorize(authorization)
        image = _decode_image(request.image) if request.image is not None else None
        try:
            vector = normalize(embed(request.text, image), dimensions)
        except ValueError as e:
            raise HTTPException(502, str(e))
        return {"embedding": vector, "dimensions": dimensions, "model": model}

    return app
