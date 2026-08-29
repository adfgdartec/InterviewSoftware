"""Tests for loopcraft_worker.banned_tokens.

The first test in this file is guardrail 2 of spec §5.1: it parses
packages/core/src/banned-tokens.ts directly and asserts the Python EMOTION_TOKENS /
FIELD_NAME_EXEMPTIONS are byte-for-byte identical to the TypeScript source, so the
two copies of the vocabulary cannot silently drift apart. The rest mirror
packages/core/test/banned-tokens.test.ts case by case.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from loopcraft_worker.banned_tokens import (
    EMOTION_TOKENS,
    FIELD_NAME_EXEMPTIONS,
    find_banned_tokens_in_field_name,
    find_banned_tokens_in_text,
    is_field_name_allowed,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TS_SOURCE_PATH = REPO_ROOT / "packages" / "core" / "src" / "banned-tokens.ts"

_STRING_LITERAL = r"'((?:[^'\\]|\\.)*)'"


def _extract_string_array(source: str, const_name: str) -> list[str]:
    """Pulls the quoted string literals out of a TS `export const NAME = [...]`
    array literal, in source order. Deliberately dumb (regex, not a TS parser) —
    exactly enough to keep this file honest against banned-tokens.ts."""
    match = re.search(rf"export const {const_name} = \[(.*?)\] as const;", source, re.DOTALL)
    if match is None:
        raise AssertionError(
            f"could not find `export const {const_name} = [...] as const;` in {TS_SOURCE_PATH}"
        )
    return re.findall(_STRING_LITERAL, match.group(1))


def _extract_string_set(source: str, const_name: str) -> set[str]:
    match = re.search(
        rf"export const {const_name} = new Set<string>\(\[(.*?)\]\);", source, re.DOTALL
    )
    if match is None:
        raise AssertionError(
            f"could not find `export const {const_name} = new Set<string>([...]);` "
            f"in {TS_SOURCE_PATH}"
        )
    return set(re.findall(_STRING_LITERAL, match.group(1)))


@pytest.fixture(scope="module")
def ts_source() -> str:
    assert TS_SOURCE_PATH.is_file(), f"expected TypeScript source at {TS_SOURCE_PATH}"
    return TS_SOURCE_PATH.read_text(encoding="utf-8")


def test_emotion_tokens_match_typescript_source(ts_source: str) -> None:
    ts_tokens = _extract_string_array(ts_source, "EMOTION_TOKENS")
    assert list(EMOTION_TOKENS) == ts_tokens, (
        "Python EMOTION_TOKENS has drifted from packages/core/src/banned-tokens.ts — "
        "update loopcraft_worker/banned_tokens.py to match exactly."
    )


def test_field_name_exemptions_match_typescript_source(ts_source: str) -> None:
    ts_exemptions = _extract_string_set(ts_source, "FIELD_NAME_EXEMPTIONS")
    assert FIELD_NAME_EXEMPTIONS == ts_exemptions, (
        "Python FIELD_NAME_EXEMPTIONS has drifted from packages/core/src/banned-tokens.ts — "
        "update loopcraft_worker/banned_tokens.py to match exactly."
    )


REJECTED_FIELD_NAMES = [
    "engagementScore",
    "engagement_score",
    "engagement-score",
    "candidateSentiment",
    "voiceConfidence",
    "moodDelta",
    "personalityProfile",
    "facialExpression",
    "eyeContactRatio",
    "toneOfVoice",
]


@pytest.mark.parametrize("field", REJECTED_FIELD_NAMES)
def test_rejects_banned_field_names(field: str) -> None:
    assert is_field_name_allowed(field) is False


ACCEPTED_SPEC_FIELD_NAMES = [
    "wordsPerMinute",
    "fillerRatio",
    "pauseLengthP95",
    "longestMonologueSeconds",
    "responseLatencyMs",
    "hedgingDensity",
    "quantificationDensity",
    "starSegmentCoverage",
    "hintDependence",
]


@pytest.mark.parametrize("field", ACCEPTED_SPEC_FIELD_NAMES)
def test_accepts_spec_measurement_field_names(field: str) -> None:
    assert is_field_name_allowed(field) is True


def test_allows_only_statistical_spellings_of_confidence() -> None:
    assert is_field_name_allowed("confidenceInterval") is True
    assert is_field_name_allowed("confidence_interval") is True
    assert is_field_name_allowed("graderConfidenceInterval") is True
    # Bare `confidence` is ambiguous at the call site, so it stays banned.
    assert is_field_name_allowed("confidence") is False
    assert is_field_name_allowed("confidenceLevel") is False


def test_reports_the_offending_token_not_just_a_boolean() -> None:
    hits = find_banned_tokens_in_field_name("speakerEnthusiasmIndex")
    assert len(hits) == 1
    assert hits[0].token == "enthusiasm"


def test_flags_every_token_in_the_vocabulary_when_used_as_a_bare_field_name() -> None:
    unflagged = [t for t in EMOTION_TOKENS if is_field_name_allowed(t.replace(" ", ""))]
    assert unflagged == []


def test_handles_empty_and_whitespace_input_without_throwing() -> None:
    assert find_banned_tokens_in_field_name("") == []
    assert find_banned_tokens_in_field_name("   ") == []


def test_does_not_flag_substrings_inside_unrelated_words() -> None:
    # "confide" contains no whole banned token; "moody" is not "mood".
    assert is_field_name_allowed("confidentialityNotice") is True
    assert is_field_name_allowed("moodyBluesPlaylist") is True


def test_permits_a_statistical_confidence_interval_in_ui_copy() -> None:
    assert find_banned_tokens_in_text("Structure: 3.4 +/- 0.6 (95% confidence interval)") == []
    assert find_banned_tokens_in_text("Reported with a confidence band.") == []


def test_rejects_affect_claims_in_ui_copy() -> None:
    assert len(find_banned_tokens_in_text("You sounded nervous and low in confidence.")) > 0
    assert len(find_banned_tokens_in_text("Your engagement was high this round.")) > 0


def test_scans_long_input_without_pathological_slowdown() -> None:
    import time

    long_text = "words per minute steady. " * 4_000 + "your mood dipped"
    started = time.perf_counter()
    hits = find_banned_tokens_in_text(long_text)
    elapsed_s = time.perf_counter() - started
    assert "mood" in [h.token for h in hits]
    assert elapsed_s < 1.0


def test_is_case_insensitive_and_tolerant_of_separators() -> None:
    assert len(find_banned_tokens_in_text("SENTIMENT")) == 1
    assert len(find_banned_tokens_in_text("micro_expression")) == 1
    assert len(find_banned_tokens_in_text("facial-expression")) == 1
