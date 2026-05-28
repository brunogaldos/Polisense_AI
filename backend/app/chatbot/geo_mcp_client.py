"""GeoMCPClient — spawns backend/mcp-service/server.py over stdio.

connect() and disconnect() must run in the same asyncio task — the MCP SDK's
stdio transport uses anyio scopes that are task-bound.

Python resolution: prefer mcp-service/venv/bin/python, else $PYTHON_EXECUTABLE,
else python3. Override service dir with $MCP_SERVICE_DIR.
"""

import json
import logging
import os
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("polisense.chatbot")


def _resolve_service_dir() -> str:
    env_dir = os.getenv("MCP_SERVICE_DIR")
    if env_dir:
        return env_dir
    backend_py = Path(__file__).resolve().parents[2]
    return str(backend_py / "mcp-service")


class GeoMCPClient:
    def __init__(self) -> None:
        self.mcp_service_dir = _resolve_service_dir()
        self._stack: Optional[AsyncExitStack] = None
        self.session: Any = None

    def _resolve_python(self) -> str:
        venv_python = os.path.join(self.mcp_service_dir, "venv", "bin", "python")
        if os.path.exists(venv_python):
            logger.info("[MCP] Using venv Python: %s", venv_python)
            return venv_python
        fallback = os.getenv("PYTHON_EXECUTABLE") or "python3"
        logger.warning("[MCP] venv not found at %s, falling back to: %s", venv_python, fallback)
        return fallback

    async def connect(self) -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        server_script = os.path.join(self.mcp_service_dir, "server.py")
        if not os.path.exists(server_script):
            raise RuntimeError(f"MCP server script not found at {server_script}")

        params = StdioServerParameters(
            command=self._resolve_python(),
            args=[server_script],
            cwd=self.mcp_service_dir,
            env=dict(os.environ),
        )
        self._stack = AsyncExitStack()
        read, write = await self._stack.enter_async_context(stdio_client(params))
        self.session = await self._stack.enter_async_context(ClientSession(read, write))
        await self.session.initialize()

    async def list_tools_for_openai(self) -> list[dict[str, Any]]:
        """MCP `inputSchema` → OpenAI function-calling `function.parameters`."""
        if not self.session:
            raise RuntimeError("GeoMCPClient not connected")
        resp = await self.session.list_tools()
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description or "",
                    "parameters": t.inputSchema or {"type": "object", "properties": {}},
                },
            }
            for t in resp.tools
        ]

    async def call_tool(self, name: str, args: dict[str, Any]) -> Any:
        """Return the first text content block parsed as JSON (mirrors TS)."""
        if not self.session:
            raise RuntimeError("GeoMCPClient not connected")
        result = await self.session.call_tool(name, arguments=args)
        text: Optional[str] = None
        for c in result.content or []:
            if getattr(c, "type", None) == "text":
                text = getattr(c, "text", None)
                break
        if not text:
            return {"ok": False, "error": "Empty response from MCP tool"}
        try:
            return json.loads(text)
        except (ValueError, TypeError):
            return {"ok": True, "raw": text}

    async def disconnect(self) -> None:
        if self._stack:
            try:
                await self._stack.aclose()
            except Exception as e:  # noqa: BLE001 - teardown is best-effort
                logger.debug("MCP disconnect error: %s", e)
            finally:
                self._stack = None
                self.session = None
