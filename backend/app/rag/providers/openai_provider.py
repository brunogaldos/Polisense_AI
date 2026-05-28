"""OpenAI provider — the default. Behaviour-identical to the previous direct
AsyncOpenAI usage in router.py (same key resolution, same model env vars)."""
import os

from app.rag.providers.base import OpenAICompatibleProvider


class OpenAIProvider(OpenAICompatibleProvider):
    name = "openai"

    def __init__(self) -> None:
        super().__init__(
            api_key=os.getenv("OPENAI_API_KEY") or os.getenv("AI_MODEL_API_KEY"),
            base_url=None,
            router_model=os.getenv("ROUTER_MODEL", "gpt-4o-mini"),
            chat_model=os.getenv("MULTIMODAL_MODEL", "gpt-4o"),
        )
