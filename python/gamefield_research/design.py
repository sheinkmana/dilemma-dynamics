"""Current plan validation plus the byte-preserved temperature-one design."""

from copy import deepcopy

from . import design_v1
from .design_v1 import (
    ARMS,
    CONDITIONS,
    JSON_INSTRUCTION,
    MODELS,
    VERSION,
    action,
    canonical,
    continues,
    derive_local_plan,
    digest,
    make_plan,
    observation,
    token,
    write_json,
)

__all__ = [
    "ARMS",
    "CONDITIONS",
    "JSON_INSTRUCTION",
    "MODELS",
    "VERSION",
    "action",
    "canonical",
    "continues",
    "derive_local_plan",
    "digest",
    "make_plan",
    "observation",
    "token",
    "write_json",
    "make_temperature_plan",
    "validate_temperature",
    "validate_plan",
]


def validate_temperature(temperature):
    if type(temperature) is not int or temperature not in (0, 1):
        raise ValueError("Temperature must be integer 0 or 1")
    return temperature


def make_temperature_plan(reference, temperature=0):
    """Match an original schedule without changing or claiming its run."""
    design_v1.validate_plan(reference)
    validate_temperature(temperature)
    if "derivation" in reference or temperature != 0:
        raise ValueError("Require an original temperature-one reference and temperature zero")
    body = deepcopy({k: v for k, v in reference.items() if k != "sha256"})
    body["schemaVersion"] = 3
    body["version"] = "gamefield-bounded/2"
    body["procedure"]["temperature"] = temperature
    body["samplingAmendment"] = {
        "kind": "matched-temperature/1",
        "referencePlanSha256": reference["sha256"],
        "referenceTemperature": 1,
        "temperature": temperature,
        "poolReferenceObservations": False,
        "interpretation": "Temperature sensitivity after reviewing temperature-one results; descriptive",
    }
    return {**body, "sha256": digest(body)}


def validate_plan(plan):
    if "samplingAmendment" not in plan:
        return design_v1.validate_plan(plan)
    reference = make_plan(plan["seed"], plan["blocks"], plan["purpose"])
    expected = make_temperature_plan(reference, plan["procedure"]["temperature"])
    if plan != expected:
        raise ValueError("Temperature plan differs from its matched specification")
    return plan
