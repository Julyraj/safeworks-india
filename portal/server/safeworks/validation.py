"""Input validation with pydantic. Errors become a 400 with a plain message, e.g. "description: Describe what was observed."."""
from __future__ import annotations

from typing import Annotated, Any, TypeVar

from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError
from pydantic.alias_generators import to_camel

from .errors import bad_request


class In(BaseModel):
    """Base for request bodies: camelCase keys, unknown keys ignored."""

    # validate_default: a missing field still runs its checks (e.g. a cancel with no reason is refused).
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore", str_strip_whitespace=True, validate_default=True)


def Str(max_len: int, min_len: int = 0) -> Any:
    return Annotated[str, StringConstraints(strip_whitespace=True, max_length=max_len, min_length=min_len)]


M = TypeVar("M", bound=BaseModel)


def parse(model: type[M], data: Any) -> M:
    try:
        return model.model_validate(data if data is not None else {})
    except ValidationError as e:
        issues = []
        for err in e.errors():
            path = ".".join(str(p) for p in err.get("loc", ())) or "input"
            msg = str(err.get("msg", "invalid"))
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, ") :]
            issues.append({"path": path, "message": msg})
        first = issues[0] if issues else {"path": "input", "message": "invalid"}
        raise bad_request(f"{first['path']}: {first['message']}", issues)
