"""Offline tests for embed_api.py. No GPU, Modal account or model download needed.

Run: uv run --with fastapi --with httpx --with pillow --with pytest pytest inference/test_embed_api.py
"""

import base64
import io
import math

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from embed_api import create_app, normalize

TOKEN = "t" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def jpeg_b64(color="red"):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, "JPEG")
    return base64.b64encode(buffer.getvalue()).decode()


@pytest.fixture
def calls():
    return []


@pytest.fixture
def client(calls):
    def fake_embed(text, image):
        calls.append((text, image))
        return [3.0, 4.0] + [0.0] * 6

    return TestClient(create_app(fake_embed, TOKEN, "test-model", 4))


def test_rejects_missing_and_wrong_token(client, calls):
    assert client.post("/embed", json={"text": "dog"}).status_code == 401
    assert client.post("/embed", json={"text": "dog"}, headers={"Authorization": "Bearer " + "x" * 40}).status_code == 401
    assert client.get("/health").status_code == 401
    assert calls == []


def test_text_embedding_is_truncated_and_normalized(client, calls):
    response = client.post("/embed", json={"text": "a dog on a sofa"}, headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["dimensions"] == 4 and body["model"] == "test-model"
    assert body["embedding"] == pytest.approx([0.6, 0.8, 0.0, 0.0])
    assert calls[0][0] == "a dog on a sofa" and calls[0][1] is None


def test_image_is_decoded_to_rgb(client, calls):
    response = client.post("/embed", json={"image": jpeg_b64()}, headers=AUTH)
    assert response.status_code == 200
    text, image = calls[0]
    assert text is None and image.mode == "RGB" and image.size == (8, 8)


def test_requires_exactly_one_input(client):
    assert client.post("/embed", json={}, headers=AUTH).status_code == 422
    assert client.post("/embed", json={"text": "x", "image": jpeg_b64()}, headers=AUTH).status_code == 422


def test_rejects_bad_image_data(client, calls):
    assert client.post("/embed", json={"image": "not base64!"}, headers=AUTH).status_code == 400
    assert client.post("/embed", json={"image": base64.b64encode(b"plain text").decode()}, headers=AUTH).status_code == 400
    assert calls == []


def test_bad_model_output_is_a_502():
    app = create_app(lambda text, image: [0.0] * 4, TOKEN, "m", 4)
    assert TestClient(app).post("/embed", json={"text": "x"}, headers=AUTH).status_code == 502
    short = create_app(lambda text, image: [1.0], TOKEN, "m", 4)
    assert TestClient(short).post("/embed", json={"text": "x"}, headers=AUTH).status_code == 502


def test_health_reports_model(client):
    assert client.get("/health", headers=AUTH).json() == {"ok": True, "model": "test-model", "dimensions": 4}


def test_weak_token_refused():
    with pytest.raises(RuntimeError):
        create_app(lambda t, i: [1.0], "short", "m", 4)


def test_normalize_rejects_non_finite():
    with pytest.raises(ValueError):
        normalize([math.inf, 1.0], 2)
