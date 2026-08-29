"""Pydantic v2 models for the Loopcraft worker.

Spec §2.7 permits exactly nine delivery-analytics measurements, all derived from
transcript text and audio word timing — never from video, face landmarks, or an
LLM's read of tone: words per minute, filler ratio, pause length distribution
(p50/p95), longest unbroken monologue, response latency, hedging density,
quantification density, and STAR segment coverage.

Spec §5.1 / legacy-audit.md defect #1: no field here may infer an internal state
(emotion, sentiment, engagement, confidence, enthusiasm, mood, personality, ...).
apps/worker/tests/test_schemas_have_no_banned_fields.py walks every model defined in
this module and fails the build if any field name trips
`loopcraft_worker.banned_tokens.is_field_name_allowed`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class WordTiming(BaseModel):
    """One recognized word and its position on the audio timeline, in milliseconds
    from the start of the recording. This is the only per-word signal the worker
    accepts — no audio bytes, no video frames."""

    model_config = ConfigDict(extra="forbid")

    word: str = Field(..., min_length=1, max_length=200)
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., ge=0)

    @model_validator(mode="after")
    def _end_not_before_start(self) -> WordTiming:
        if self.end_ms < self.start_ms:
            raise ValueError("end_ms must be greater than or equal to start_ms")
        return self


class DeliveryMetricsRequest(BaseModel):
    """Input to POST /v1/delivery-metrics: a transcript plus the audio timing array
    it was derived from (spec §2.7 — "compute from the transcript and audio timing
    only"). `prompt_end_ms` is the timestamp, on the same clock as `words`, at which
    the interviewer's question audio finished; it anchors response_latency_ms."""

    model_config = ConfigDict(extra="forbid")

    transcript: str = Field(..., max_length=50_000)
    words: list[WordTiming] = Field(default_factory=list, max_length=20_000)
    prompt_end_ms: int = Field(0, ge=0)


class DeliveryMetrics(BaseModel):
    """Output of POST /v1/delivery-metrics — the complete, spec §2.7-permitted set of
    delivery measurements. Every field is a mechanical measurement of the transcript
    or its timing; none infers an internal state of the candidate."""

    model_config = ConfigDict(extra="forbid")

    words_per_minute: float = Field(..., ge=0)
    filler_ratio: float = Field(..., ge=0, le=1)
    pause_length_p50_ms: float = Field(..., ge=0)
    pause_length_p95_ms: float = Field(..., ge=0)
    longest_monologue_seconds: float = Field(..., ge=0)
    response_latency_ms: float = Field(..., ge=0)
    hedging_density: float = Field(..., ge=0)
    quantification_density: float = Field(..., ge=0)
    star_segment_coverage: float = Field(..., ge=0, le=1)


class HealthResponse(BaseModel):
    """GET /health response."""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(default="ok")


class ErrorResponse(BaseModel):
    """Body returned for any uncaught server error. Deliberately minimal: an opaque,
    correlatable id and a generic message. Never a file path, a stack trace, a raw
    upstream provider payload, or any fragment of a credential — see
    docs/legacy-audit.md defect #5 and spec §3.4."""

    model_config = ConfigDict(extra="forbid")

    error_id: str
    message: str = Field(default="An internal error occurred.")
