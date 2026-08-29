"""Python mirror of packages/core/src/banned-tokens.ts — the affect-inference
vocabulary Loopcraft must never emit as a response-schema field or user-facing string.

Spec §5.1: EU AI Act Article 5(1)(f) prohibits inferring emotions of a natural person
in workplace and educational contexts, and the Commission's guidelines read
"workplace" broadly enough to reach recruitment. Loopcraft therefore derives every
delivery signal from transcript text and audio timing, and never names a field after
an internal state. See the TS module's docstring for the full rationale.

This file is a hand-kept port, not a generated one. It MUST stay byte-for-byte
identical to the TypeScript vocabulary — apps/worker/tests/test_banned_tokens.py
parses packages/core/src/banned-tokens.ts directly and fails the build if
EMOTION_TOKENS or FIELD_NAME_EXEMPTIONS drift from it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

EMOTION_TOKENS: tuple[str, ...] = (
    "emotion",
    "emotional",
    "sentiment",
    "engagement",
    "engaged",
    "confidence",
    "confident",
    "enthusiasm",
    "enthusiastic",
    "mood",
    "personality",
    "affect",
    "arousal",
    "valence",
    "demeanor",
    "attitude",
    "facial expression",
    "micro expression",
    "microexpression",
    "tone of voice",
    "vocal tone",
    "eye contact",
)

# Exact identifiers permitted as field names. "Confidence" is overloaded: as an
# inference about a person it is prohibited, as a statistical interval it is required
# by spec §2.6 ("report inter-sample variance as a confidence signal") and acceptance
# criterion 8 ("every score shown to a user carries an uncertainty interval"). Only the
# statistical spellings are permitted, so a reviewer can tell the two apart by the
# identifier alone.
FIELD_NAME_EXEMPTIONS: frozenset[str] = frozenset(
    {
        "confidenceInterval",
        "confidence_interval",
        "confidenceIntervalLow",
        "confidenceIntervalHigh",
        "graderConfidenceInterval",
    }
)

# Phrases in which a banned token is unambiguously statistical rather than
# psychological. Applies to prose (docs, UI copy), never to field names — a field
# named `confidence` is ambiguous at the call site no matter what the surrounding
# sentence says.
STATISTICAL_PHRASE_EXEMPTIONS: tuple[str, ...] = (
    "confidence interval",
    "confidence intervals",
    "confidence level",
    "confidence band",
    "95% confidence",
)


def _escape_and_widen(token: str) -> str:
    """Escape regex metacharacters, then let any run of whitespace/underscore/hyphen
    stand in for the token's literal space — mirrors the TS WORD_BOUNDARY_SOURCE
    construction (`t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/ /g, '[\\s_-]*')`)
    exactly, including CPython's `re.escape` backslash-escaping a literal space."""
    escaped = re.escape(token)
    return escaped.replace("\\ ", "[\\s_-]*").replace(" ", "[\\s_-]*")


_WORD_BOUNDARY_SOURCE = "|".join(_escape_and_widen(t) for t in EMOTION_TOKENS)


def banned_token_pattern() -> re.Pattern[str]:
    """Matches a banned token as a whole word, tolerant of camelCase, snake_case and
    kebab-case (camelCase is pre-split to spaces by `_normalize` before matching)."""
    return re.compile(rf"\b({_WORD_BOUNDARY_SOURCE})\b", re.IGNORECASE)


@dataclass(frozen=True)
class BannedTokenHit:
    token: str
    index: int


def _normalize(text: str) -> str:
    """Splits camelCase/PascalCase into space-separated words, then folds snake_case
    and kebab-case separators to spaces too, so `voiceTone` / `voice_tone` /
    `voice-tone` are all inspectable the same way."""
    out = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    out = re.sub(r"[_-]+", " ", out)
    return out.lower()


def find_banned_tokens_in_text(text: str) -> list[BannedTokenHit]:
    """Scans free prose (UI copy, docs, prompts). Statistical phrases are masked out
    first so "3.4 +/- 0.6 (95% confidence interval)" does not trip the rule."""
    haystack = _normalize(text)
    for phrase in STATISTICAL_PHRASE_EXEMPTIONS:
        haystack = haystack.replace(phrase, " " * len(phrase))
    hits: list[BannedTokenHit] = []
    for match in banned_token_pattern().finditer(haystack):
        hits.append(BannedTokenHit(token=match.group(0), index=match.start()))
    return hits


def find_banned_tokens_in_field_name(field_name: str) -> list[BannedTokenHit]:
    """Scans a schema field name or other identifier. Stricter than
    `find_banned_tokens_in_text`: only the exact identifiers in FIELD_NAME_EXEMPTIONS
    are allowed through."""
    if field_name in FIELD_NAME_EXEMPTIONS:
        return []
    haystack = _normalize(field_name)
    hits: list[BannedTokenHit] = []
    for match in banned_token_pattern().finditer(haystack):
        hits.append(BannedTokenHit(token=match.group(0), index=match.start()))
    return hits


def is_field_name_allowed(field_name: str) -> bool:
    """True when the identifier is safe to use as a response-schema field name."""
    return len(find_banned_tokens_in_field_name(field_name)) == 0
