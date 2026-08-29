"""Python half of guardrail 1 (spec §5.1, acceptance criterion 4): "Add a lint rule
that fails the build if a banned field name appears in a response schema."

Walks every Pydantic model defined in loopcraft_worker.schemas via `model_fields` and
asserts no field name trips `is_field_name_allowed`. This runs on both request and
response models — a banned name in a request schema would just as surely make an
internal-state inference part of the worker's public contract.
"""

from __future__ import annotations

import inspect

from pydantic import BaseModel

from loopcraft_worker import schemas
from loopcraft_worker.banned_tokens import find_banned_tokens_in_field_name


def _pydantic_models_in(module: object) -> list[type[BaseModel]]:
    models = [
        obj
        for _, obj in inspect.getmembers(module, inspect.isclass)
        if issubclass(obj, BaseModel) and obj is not BaseModel and obj.__module__ == module.__name__
    ]
    assert models, f"expected at least one Pydantic model defined in {module.__name__}"
    return models


def test_schemas_module_has_models_to_check() -> None:
    assert len(_pydantic_models_in(schemas)) >= 5


def test_no_schema_field_name_is_banned() -> None:
    violations: list[str] = []
    for model in _pydantic_models_in(schemas):
        for field_name in model.model_fields:
            hits = find_banned_tokens_in_field_name(field_name)
            if hits:
                tokens = ", ".join(h.token for h in hits)
                violations.append(f"{model.__name__}.{field_name} (matched: {tokens})")
    assert violations == [], (
        "banned field name(s) found in loopcraft_worker.schemas — spec §5.1 / "
        "acceptance criterion 4: " + "; ".join(violations)
    )


def test_delivery_metrics_covers_exactly_the_spec_section_2_7_measurements() -> None:
    expected = {
        "words_per_minute",
        "filler_ratio",
        "pause_length_p50_ms",
        "pause_length_p95_ms",
        "longest_monologue_seconds",
        "response_latency_ms",
        "hedging_density",
        "quantification_density",
        "star_segment_coverage",
    }
    assert set(schemas.DeliveryMetrics.model_fields) == expected
