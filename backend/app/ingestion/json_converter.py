"""Port of backend/src/ingestion/jsonConverter.ts.

Converts an arbitrary JSON value into structured Markdown (for vector-store
ingestion) and compact one-line summaries (for Firestore storage, mirroring the
GeoJSON compact-summary approach).
"""

import json
import re
from typing import Any


def _indent(level: int) -> str:
    return "  " * level


def _strip_ext(file_name: str) -> str:
    return re.sub(r"\.[^/.]+$", "", file_name)


def _inline_value(v: Any, max_len: int = 120) -> str:
    """Render any JSON value as inline text (truncated for large values)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        # JS renders booleans lowercase; check before str/number.
        return "true" if v else "false"
    if isinstance(v, str):
        return v[: max_len - 3] + "..." if len(v) > max_len else v
    if isinstance(v, (int, float)):
        return str(v)
    s = json.dumps(v, ensure_ascii=False)
    return s[: max_len - 3] + "..." if len(s) > max_len else s


def _render_object(obj: dict, level: int = 0) -> list[str]:
    """Render a plain object as a markdown definition list."""
    lines: list[str] = []
    for key, value in obj.items():
        if value is None or value == "":
            continue
        if isinstance(value, list):
            if len(value) == 0:
                continue
            if all(not isinstance(v, (dict, list)) for v in value):
                lines.append(
                    f"{_indent(level)}- **{key}**: " + ", ".join(_inline_value(v) for v in value)
                )
            else:
                lines.append(f"{_indent(level)}- **{key}**:")
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        lines.append(f"{_indent(level + 1)}- Item {i + 1}:")
                        lines.extend(_render_object(item, level + 2))
                    else:
                        lines.append(f"{_indent(level + 1)}- {_inline_value(item)}")
        elif isinstance(value, dict):
            lines.append(f"{_indent(level)}- **{key}**:")
            lines.extend(_render_object(value, level + 1))
        else:
            lines.append(f"{_indent(level)}- **{key}**: {_inline_value(value)}")
    return lines


def json_to_markdown(data: Any, file_name: str) -> str:
    """Convert a parsed JSON value to a Markdown string."""
    base_name = _strip_ext(file_name)
    header = [f"# JSON Data: {base_name}", "", f"**Source file**: {file_name}"]

    # Array of objects
    if isinstance(data, list):
        header.append(f"**Records**: {len(data)}")
        header += ["", "---", ""]
        sections: list[str] = []
        for i, item in enumerate(data):
            sections += [f"## Record {i + 1}", ""]
            if isinstance(item, dict):
                sections.extend(_render_object(item))
            else:
                sections.append(_inline_value(item))
            sections += ["", "---", ""]
        return "\n".join(header + sections)

    # Plain object
    if isinstance(data, dict):
        header.append(f"**Keys**: {len(data)}")
        header += ["", "---", ""]
        body = _render_object(data)
        return "\n".join(header + body + ["", "---", ""])

    # Primitive / other
    header += ["", "---", "", "```json", json.dumps(data, indent=2, ensure_ascii=False), "```", ""]
    return "\n".join(header)


def json_to_summary_lines(data: Any, file_name: str, max_items: int = 5000) -> list[str]:
    """Generate compact one-line summaries for Firestore storage."""
    base_name = _strip_ext(file_name)

    if isinstance(data, list):
        out: list[str] = []
        for i, item in enumerate(data[:max_items]):
            if isinstance(item, dict):
                parts = [f"Record {i + 1}"]
                for k, v in item.items():
                    if v is None or v == "":
                        continue
                    if isinstance(v, (dict, list)):
                        continue  # skip nested
                    val = str(v)
                    val = val[:77] + "..." if len(val) > 80 else val
                    parts.append(f"{k}: {val}")
                out.append(" | ".join(parts))
            else:
                out.append(f"Record {i + 1} | {_inline_value(item, 200)}")
        return out

    if isinstance(data, dict):
        lines: list[str] = []
        for k, v in data.items():
            if v is None or v == "":
                continue
            if isinstance(v, dict):
                lines.append(f"{base_name} | {k}: {{{', '.join(v.keys())}}}")
            elif isinstance(v, list):
                lines.append(f"{base_name} | {k}: [{len(v)} items]")
            else:
                val = str(v)
                val = val[:117] + "..." if len(val) > 120 else val
                lines.append(f"{base_name} | {k}: {val}")
            if len(lines) >= max_items:
                break
        return lines

    return [f"{base_name} | value: {_inline_value(data, 200)}"]
