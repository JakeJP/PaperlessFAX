from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "gemini_flash_latest"


def _read_optional_text_env(var_name: str) -> str | None:
    raw = os.getenv(var_name)
    if raw is None:
        return None

    text = raw.strip()
    if not text:
        return None

    return text


def _read_optional_float_env(var_name: str) -> float | None:
    raw = os.getenv(var_name)
    if raw is None:
        return None

    text = raw.strip()
    if not text:
        return None

    try:
        return float(text)
    except ValueError as exc:
        raise ValueError(f"{var_name} must be a float") from exc


def _read_optional_int_env(var_name: str) -> int | None:
    raw = os.getenv(var_name)
    if raw is None:
        return None

    text = raw.strip()
    if not text:
        return None

    try:
        return int(text)
    except ValueError as exc:
        raise ValueError(f"{var_name} must be an int") from exc


def _resolve_media_resolution_value(types_module: Any, raw_value: str) -> Any:
    normalized = raw_value.strip().replace("-", "_").replace(" ", "_").upper()
    value_map = {
        "LOW": "MEDIA_RESOLUTION_LOW",
        "MEDIUM": "MEDIA_RESOLUTION_MEDIUM",
        "HIGH": "MEDIA_RESOLUTION_HIGH",
        "MEDIA_RESOLUTION_LOW": "MEDIA_RESOLUTION_LOW",
        "MEDIA_RESOLUTION_MEDIUM": "MEDIA_RESOLUTION_MEDIUM",
        "MEDIA_RESOLUTION_HIGH": "MEDIA_RESOLUTION_HIGH",
    }
    enum_name = value_map.get(normalized)
    if enum_name is None:
        allowed = "low, medium, high"
        raise ValueError(f"media resolution must be one of: {allowed}")

    media_resolution_enum = getattr(types_module, "MediaResolution", None)
    if media_resolution_enum is None:
        return enum_name

    return getattr(media_resolution_enum, enum_name, enum_name)


def _read_optional_media_resolution(provider: str, types_module: Any) -> Any | None:
    provider_var_names = {
        "vertexai": "VERTEXAI_MEDIA_RESOLUTION",
        "gemini": "GEMINI_API_MEDIA_RESOLUTION",
    }
    candidate_var_names = [
        provider_var_names.get(provider, ""),
        "GEMINI_GENNERATION_MEDIA_RESOLUTION",
    ]

    for var_name in candidate_var_names:
        if not var_name:
            continue

        raw_value = _read_optional_text_env(var_name)
        if raw_value is None:
            continue

        try:
            return _resolve_media_resolution_value(types_module, raw_value)
        except ValueError as exc:
            raise ValueError(f"{var_name} {exc}") from exc

    return None


def _read_optional_generation_config(provider: str, types_module: Any) -> dict[str, Any]:
    config: dict[str, Any] = {}

    temperature = _read_optional_float_env("GEMINI_GENNERATION_TEMPERATURE")
    if temperature is not None:
        config["temperature"] = temperature

    top_k = _read_optional_int_env("GEMINI_GENNERATION_TOPK")
    if top_k is not None:
        config["top_k"] = top_k

    top_p = _read_optional_float_env("GEMINI_GENNERATION_TOPP")
    if top_p is not None:
        config["top_p"] = top_p

    media_resolution = _read_optional_media_resolution(provider, types_module)
    if media_resolution is not None:
        config["media_resolution"] = media_resolution

    return config


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("empty Gemini response")

    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            text = "\n".join(lines[1:-1]).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]

    return json.loads(text)


def _normalize_payload(payload: dict[str, Any], source_name: str) -> dict[str, Any]:
    normalized = dict(payload)

    content_properties = normalized.get("content_properties")
    if not isinstance(content_properties, dict):
        content_properties = {}

    typed_properties = normalized.get("typed_properties")
    if not isinstance(typed_properties, dict):
        typed_properties = {}

    legacy_title = normalized.get("title")
    content_title = content_properties.get("title")
    if (not isinstance(content_title, str) or not content_title.strip()) and isinstance(legacy_title, str) and legacy_title.strip():
        content_properties["title"] = legacy_title.strip()

    normalized["content_properties"] = content_properties
    normalized["typed_properties"] = typed_properties

    if "sourceFile" not in normalized:
        normalized["sourceFile"] = source_name
    if "confidence" not in normalized:
        normalized["confidence"] = 0.0

    return normalized


def _build_genai_client() -> tuple[Any, str]:
    """GOOGLE_GENAI_USE_VERTEXAI に応じた google-genai クライアントとプロバイダー名を返す。"""
    try:
        from google import genai  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("google-genai package is required") from exc

    use_vertexai = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("true", "1", "yes", "on")

    if use_vertexai:
        project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
        if not project:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT is not set")
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "global").strip() or "global"
        client = genai.Client(vertexai=True, project=project, location=location)
        provider = "vertexai"
    else:
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        client = genai.Client(api_key=api_key)
        provider = "gemini"

    return client, provider


def _resolve_model(provider: str) -> str:
    """プロバイダーに応じたモデル名を返す。"""
    if provider == "vertexai":
        default = "gemini-2.0-flash-001"
        return os.getenv("VERTEXAI_MODEL", default).strip() or default
    default = DEFAULT_MODEL
    return os.getenv("GEMINI_API_MODEL", default).strip() or default


def classify_file(file_path: str | Path, prompt_input: str | Path) -> dict[str, Any]:
    path = Path(file_path)

    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"target file not found: {path}")

    prompt_text: str
    if isinstance(prompt_input, Path):
        prompt_file = prompt_input
        if not prompt_file.exists() or not prompt_file.is_file():
            raise FileNotFoundError(f"prompt file not found: {prompt_file}")
        prompt_text = prompt_file.read_text(encoding="utf-8")
    else:
        prompt_input_text = str(prompt_input)
        should_treat_as_text = "\n" in prompt_input_text or "\r" in prompt_input_text

        if should_treat_as_text:
            prompt_text = prompt_input_text
        else:
            candidate = Path(prompt_input_text)
            try:
                if candidate.exists() and candidate.is_file():
                    prompt_text = candidate.read_text(encoding="utf-8")
                else:
                    prompt_text = prompt_input_text
            except OSError:
                prompt_text = prompt_input_text

    try:
        from google.genai import types  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("google-genai package is required") from exc

    client, provider = _build_genai_client()
    model = _resolve_model(provider)

    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    file_bytes = path.read_bytes()

    file_part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    generation_config = _read_optional_generation_config(provider, types)
    request_kwargs: dict[str, Any] = {
        "model": model,
        "contents": [prompt_text, file_part],
    }
    if generation_config:
        request_kwargs["config"] = types.GenerateContentConfig(**generation_config)

    response = client.models.generate_content(**request_kwargs)
    text = getattr(response, "text", "") or ""
    payload = _extract_json(text)
    payload = _normalize_payload(payload, path.name)

    if "documentClassId" not in payload:
        payload["documentClassId"] = str(payload.get("type") or "Unclassified")
    return payload
