from __future__ import annotations

from pathlib import Path

# Single source of truth: <project_root>/VERSION
__version__: str = (
    Path(__file__).resolve().parent.parent / "VERSION"
).read_text(encoding="utf-8").strip()
