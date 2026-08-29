"""Loopcraft delivery-analysis worker: FastAPI app with exactly two routes.

Per spec §3.1 this process is the "FastAPI media + analysis worker". Per spec §3.4
and docs/legacy-audit.md defects #3/#4, it hosts nothing else: no duplicate upload
routes, no unrelated (e.g. education) APIs, no second transcription path. Per spec
§5.1 and defect #1, it never runs video or face processing and never infers an
internal state — see loopcraft_worker/schemas.py for the exact metric set.

Config is read from environment variables only (spec §3.4); nothing here logs a
secret because this process never holds one — it takes transcript text and audio
timing as input and returns numbers, with no third-party provider calls.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from collections.abc import Sequence

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from loopcraft_worker.schemas import (
    DeliveryMetrics,
    DeliveryMetricsRequest,
    ErrorResponse,
    HealthResponse,
    WordTiming,
)

_LOG_LEVEL = os.environ.get("LOOPCRAFT_WORKER_LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, _LOG_LEVEL, logging.INFO))
logger = logging.getLogger("loopcraft_worker")

app = FastAPI(
    title="Loopcraft Worker",
    description="Non-biometric delivery-analysis worker. No video/face processing.",
    version="0.1.0",
)

_FILLER_WORDS = frozenset(
    {"um", "umm", "uh", "uhh", "erm", "hmm", "like", "actually", "basically", "literally"}
)

_HEDGE_PHRASES = (
    "i think",
    "i guess",
    "i suppose",
    "i believe",
    "kind of",
    "sort of",
    "maybe",
    "probably",
    "possibly",
    "not sure",
    "might be",
    "seems like",
)

_STAR_KEYWORDS: dict[str, tuple[str, ...]] = {
    "situation": ("situation", "context", "background", "at the time", "we were"),
    "task": ("task", "goal", "objective", "needed to", "responsible for", "my job was"),
    "action": ("i did", "i implemented", "i built", "i led", "i decided", "i created", "so i"),
    "result": (
        "result",
        "outcome",
        "impact",
        "as a result",
        "we achieved",
        "led to",
        "which reduced",
        "which increased",
    ),
}

_NUMBER_PATTERN = re.compile(r"\b\d+(?:\.\d+)?%?\b")

# Gap between consecutive words, in ms, above which a new monologue segment starts.
_MONOLOGUE_BREAK_MS = 2_000


def _percentile(values: Sequence[float], pct: float) -> float:
    """Linear-interpolation percentile (matches numpy's default 'linear' method).
    Returns 0.0 for an empty input."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    frac = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * frac


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _compute_delivery_metrics(payload: DeliveryMetricsRequest) -> DeliveryMetrics:
    """Pure computation over transcript text and audio word timing only. No network
    calls, no provider SDKs, no file I/O — this is why it is safe to call in-process
    on every submitted turn."""
    words: list[WordTiming] = payload.words
    transcript = payload.transcript
    transcript_lower = transcript.lower()
    total_words = _word_count(transcript)

    # --- timing-derived metrics ---
    if len(words) >= 2:
        ordered = sorted(words, key=lambda w: w.start_ms)
        total_duration_ms = ordered[-1].end_ms - ordered[0].start_ms
        gaps = [
            max(0, nxt.start_ms - cur.end_ms) for cur, nxt in zip(ordered, ordered[1:])
        ]
        words_per_minute = (
            (len(ordered) / (total_duration_ms / 60_000)) if total_duration_ms > 0 else 0.0
        )
        pause_p50 = _percentile(gaps, 50)
        pause_p95 = _percentile(gaps, 95)

        longest_monologue_ms = 0
        segment_start = ordered[0].start_ms
        segment_end = ordered[0].end_ms
        for cur, nxt in zip(ordered, ordered[1:]):
            gap = nxt.start_ms - cur.end_ms
            if gap > _MONOLOGUE_BREAK_MS:
                longest_monologue_ms = max(longest_monologue_ms, segment_end - segment_start)
                segment_start = nxt.start_ms
            segment_end = nxt.end_ms
        longest_monologue_ms = max(longest_monologue_ms, segment_end - segment_start)
        longest_monologue_seconds = longest_monologue_ms / 1000

        response_latency_ms = float(max(0, ordered[0].start_ms - payload.prompt_end_ms))
    elif len(words) == 1:
        words_per_minute = 0.0
        pause_p50 = 0.0
        pause_p95 = 0.0
        longest_monologue_seconds = max(0, words[0].end_ms - words[0].start_ms) / 1000
        response_latency_ms = float(max(0, words[0].start_ms - payload.prompt_end_ms))
    else:
        words_per_minute = 0.0
        pause_p50 = 0.0
        pause_p95 = 0.0
        longest_monologue_seconds = 0.0
        response_latency_ms = 0.0

    # --- text-derived metrics ---
    if total_words > 0:
        tokens = re.findall(r"[a-zA-Z']+", transcript_lower)
        filler_count = sum(1 for tok in tokens if tok in _FILLER_WORDS)
        filler_ratio = min(1.0, filler_count / total_words)
        hedge_count = sum(transcript_lower.count(phrase) for phrase in _HEDGE_PHRASES)
        hedging_density = (hedge_count / total_words) * 100
        number_count = len(_NUMBER_PATTERN.findall(transcript))
        quantification_density = (number_count / total_words) * 100
    else:
        filler_ratio = 0.0
        hedging_density = 0.0
        quantification_density = 0.0

    if transcript.strip():
        components_present = sum(
            1
            for keywords in _STAR_KEYWORDS.values()
            if any(kw in transcript_lower for kw in keywords)
        )
        star_segment_coverage = components_present / len(_STAR_KEYWORDS)
    else:
        star_segment_coverage = 0.0

    return DeliveryMetrics(
        words_per_minute=words_per_minute,
        filler_ratio=filler_ratio,
        pause_length_p50_ms=pause_p50,
        pause_length_p95_ms=pause_p95,
        longest_monologue_seconds=longest_monologue_seconds,
        response_latency_ms=response_latency_ms,
        hedging_density=hedging_density,
        quantification_density=quantification_density,
        star_segment_coverage=star_segment_coverage,
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/v1/delivery-metrics", response_model=DeliveryMetrics)
async def delivery_metrics(payload: DeliveryMetricsRequest) -> DeliveryMetrics:
    return _compute_delivery_metrics(payload)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never let an internal error reach the client as anything but an opaque id.
    docs/legacy-audit.md defect #5: the legacy worker leaked temp file paths, raw
    provider payloads, and a masked API-key suffix in error bodies. This handler is
    the structural fix — detail goes to the server log only, keyed by error_id."""
    error_id = uuid.uuid4().hex
    logger.exception(
        "unhandled error [error_id=%s] on %s %s", error_id, request.method, request.url.path
    )
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(error_id=error_id).model_dump(),
    )
