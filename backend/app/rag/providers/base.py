"""Provider interface + shared OpenAI-compatible implementation.

OpenAI and OpenRouter differ only in client construction (api key + base_url)
and the default model names, so they share one base class. Anything speaking the
OpenAI chat-completions API (Ollama, vLLM, OpenRouter, OpenAI) fits here.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncIterator, Optional, Protocol, runtime_checkable

logger = logging.getLogger("polisense.chatbot")


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    @property
    def available(self) -> bool: ...

    async def classify_json(self, system: str, user: str) -> dict[str, Any]: ...

    def stream_chat(
        self, messages: list[dict[str, Any]], *, temperature: float, max_tokens: int
    ) -> AsyncIterator[str]: ...


class OpenAICompatibleProvider:
    """Base for any OpenAI chat-completions-compatible backend."""

    name = "openai-compatible"

    def __init__(
        self,
        *,
        api_key: Optional[str],
        base_url: Optional[str],
        router_model: str,
        chat_model: str,
    ) -> None:
        self._router_model = router_model
        self._chat_model = chat_model
        self._client = None
        if api_key:
            from openai import AsyncOpenAI

            kwargs: dict[str, Any] = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self._client = AsyncOpenAI(**kwargs)

    @property
    def available(self) -> bool:
        return self._client is not None

    async def classify_json(self, system: str, user: str) -> dict[str, Any]:
        """JSON-mode intent classification. Mirrors the original router call."""
        if not self._client:
            raise RuntimeError(f"{self.name} provider has no API key")
        logger.info("ROUTER [%s] — model=%s", self.name, self._router_model)
        resp = await self._client.chat.completions.create(
            model=self._router_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return json.loads(resp.choices[0].message.content or "{}")

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 4000,
    ) -> AsyncIterator[str]:
        """Stream plain text deltas. Used by the local generation path (later
        milestone); no hosted tools — context is injected into `messages`."""
        if not self._client:
            raise RuntimeError(f"{self.name} provider has no API key")
        stream = await self._client.chat.completions.create(
            model=self._chat_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
