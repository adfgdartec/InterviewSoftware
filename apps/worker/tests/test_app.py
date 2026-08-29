"""Tests for the FastAPI app: /health, the /v1/delivery-metrics happy path, edge
cases in the request schema, and the global-error-handler contract from spec §3.4 /
docs/legacy-audit.md defect #5 — no file path, stack trace, or provider payload may
ever reach the response body."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import loopcraft_worker.app as worker_app
from loopcraft_worker.app import app
from loopcraft_worker.schemas import DeliveryMetricsRequest, WordTiming

client = TestClient(app)


def test_health_returns_ok() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def _words(pairs: list[tuple[str, int, int]]) -> list[dict]:
    return [{"word": w, "start_ms": s, "end_ms": e} for w, s, e in pairs]


def test_delivery_metrics_happy_path() -> None:
    # "the quick brown fox jumps" spoken over 2 seconds, one filler word, one number,
    # one hedge phrase, and enough STAR keywords to hit all four components.
    transcript = (
        "In that situation I was responsible for the launch. "
        "So I built a new pipeline and reduced errors by 40%. "
        "I think that was the best outcome we achieved as a result."
    )
    words = _words(
        [
            ("in", 0, 100),
            ("that", 100, 300),
            ("situation", 300, 600),
            ("um", 600, 800),
            ("i", 2_800, 2_900),
            ("was", 2_900, 3_100),
        ]
    )
    resp = client.post(
        "/v1/delivery-metrics",
        json={"transcript": transcript, "words": words, "prompt_end_ms": 0},
    )
    assert resp.status_code == 200
    body = resp.json()

    for field in (
        "words_per_minute",
        "filler_ratio",
        "pause_length_p50_ms",
        "pause_length_p95_ms",
        "longest_monologue_seconds",
        "response_latency_ms",
        "hedging_density",
        "quantification_density",
        "star_segment_coverage",
    ):
        assert field in body

    assert body["words_per_minute"] > 0
    assert body["pause_length_p95_ms"] >= body["pause_length_p50_ms"] >= 0
    assert body["quantification_density"] > 0  # "40%" was in the transcript
    assert body["hedging_density"] > 0  # "I think"
    assert 0.0 <= body["star_segment_coverage"] <= 1.0
    assert body["star_segment_coverage"] > 0  # situation/task/action/result keywords present


def test_delivery_metrics_empty_transcript_and_no_words() -> None:
    resp = client.post(
        "/v1/delivery-metrics", json={"transcript": "", "words": [], "prompt_end_ms": 0}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "words_per_minute": 0.0,
        "filler_ratio": 0.0,
        "pause_length_p50_ms": 0.0,
        "pause_length_p95_ms": 0.0,
        "longest_monologue_seconds": 0.0,
        "response_latency_ms": 0.0,
        "hedging_density": 0.0,
        "quantification_density": 0.0,
        "star_segment_coverage": 0.0,
    }


def test_delivery_metrics_single_word() -> None:
    resp = client.post(
        "/v1/delivery-metrics",
        json={"transcript": "hello", "words": _words([("hello", 100, 500)]), "prompt_end_ms": 50},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["longest_monologue_seconds"] == pytest.approx(0.4)
    assert body["response_latency_ms"] == pytest.approx(50.0)
    assert body["pause_length_p50_ms"] == 0.0
    assert body["pause_length_p95_ms"] == 0.0


def test_delivery_metrics_zero_length_audio_word() -> None:
    # start_ms == end_ms is a valid, if degenerate, word timing (e.g. a very short
    # transcribed token) and must not raise a division error.
    resp = client.post(
        "/v1/delivery-metrics",
        json={"transcript": "hi", "words": _words([("hi", 1_000, 1_000)]), "prompt_end_ms": 1_000},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["longest_monologue_seconds"] == 0.0
    assert body["response_latency_ms"] == 0.0


def test_delivery_metrics_very_long_transcript() -> None:
    # Stays under DeliveryMetricsRequest's 50,000-char cap (~45,900 chars) while still
    # exercising a transcript far larger than a normal interview turn.
    transcript = "we shipped it and reduced latency by 12 percent. " * 900
    words = _words([("word", i * 300, i * 300 + 250) for i in range(500)])
    resp = client.post(
        "/v1/delivery-metrics",
        json={"transcript": transcript, "words": words, "prompt_end_ms": 0},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["words_per_minute"] > 0
    assert body["quantification_density"] > 0


def test_delivery_metrics_rejects_malformed_word_timing() -> None:
    resp = client.post(
        "/v1/delivery-metrics",
        json={
            "transcript": "hello",
            "words": [{"word": "hello", "start_ms": 500, "end_ms": 100}],
            "prompt_end_ms": 0,
        },
    )
    assert resp.status_code == 422


def test_delivery_metrics_rejects_negative_start_ms() -> None:
    resp = client.post(
        "/v1/delivery-metrics",
        json={
            "transcript": "hello",
            "words": [{"word": "hello", "start_ms": -1, "end_ms": 100}],
            "prompt_end_ms": 0,
        },
    )
    assert resp.status_code == 422


def test_delivery_metrics_rejects_missing_transcript() -> None:
    resp = client.post("/v1/delivery-metrics", json={"words": [], "prompt_end_ms": 0})
    assert resp.status_code == 422


def test_delivery_metrics_rejects_unknown_fields() -> None:
    resp = client.post(
        "/v1/delivery-metrics",
        json={"transcript": "hi", "words": [], "prompt_end_ms": 0, "sentiment_hint": "happy"},
    )
    assert resp.status_code == 422


def test_word_timing_model_rejects_end_before_start_directly() -> None:
    with pytest.raises(ValidationError):
        WordTiming(word="x", start_ms=10, end_ms=5)


def test_delivery_metrics_request_rejects_extra_fields_directly() -> None:
    with pytest.raises(ValidationError):
        DeliveryMetricsRequest.model_validate(
            {"transcript": "hi", "words": [], "confidence": 0.9}
        )


def test_global_error_handler_hides_internal_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    """Simulates an internal failure the way a real bug would surface one — the
    computation function raises with sensitive-looking detail embedded, exactly the
    shape of the legacy worker's leaked temp path / provider payload (audit defect
    #5) — and asserts none of that detail reaches the client."""

    secret_path = "/var/tmp/loopcraft-worker-audio-abc123.wav"
    fake_provider_payload = '{"provider": "deepgram", "api_key": "sk-live-verysecretvalue"}'

    def _boom(payload: DeliveryMetricsRequest) -> None:
        raise RuntimeError(
            f"failed reading {secret_path}; upstream response: {fake_provider_payload}"
        )

    monkeypatch.setattr(worker_app, "_compute_delivery_metrics", _boom)

    # raise_server_exceptions=False: Starlette's ServerErrorMiddleware sends the
    # handler's response *and* re-raises the original exception so a real ASGI server
    # can log it; TestClient's default of re-raising that into the test would defeat
    # the point of this test, which is to inspect the response the client actually
    # receives.
    error_client = TestClient(app, raise_server_exceptions=False)
    resp = error_client.post(
        "/v1/delivery-metrics", json={"transcript": "hi", "words": [], "prompt_end_ms": 0}
    )

    assert resp.status_code == 500
    body = resp.json()
    raw = resp.text

    assert set(body.keys()) == {"error_id", "message"}
    assert isinstance(body["error_id"], str) and body["error_id"]
    assert body["message"] == "An internal error occurred."

    for leaked in (secret_path, fake_provider_payload, "sk-live", "Traceback", ".wav", "deepgram"):
        assert leaked not in raw
