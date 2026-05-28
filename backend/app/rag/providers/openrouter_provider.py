"""OpenRouter provider — hosted, OpenAI-compatible, no GPU ops. Selected with
AI_PROVIDER=local (or =openrouter).

Models default to OpenRouter-namespaced ids; override with ROUTER_MODEL_LOCAL /
LLM_MODEL. Not all OpenRouter models honour JSON response_format — pick a model
that does for classification (the defaults below do)."""
import os

from app.rag.providers.base import OpenAICompatibleProvider

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterProvider(OpenAICompatibleProvider):
    name = "openrouter"

    def __init__(self) -> None:
        super().__init__(
            api_key=os.getenv("OPENROUTER_API_KEY"),
            base_url=os.getenv("LLM_BASE_URL", OPENROUTER_BASE_URL),
            router_model=os.getenv("ROUTER_MODEL_LOCAL", "openai/gpt-4o-mini"),
            chat_model=os.getenv("LLM_MODEL", "google/gemini-2.5-pro"),
        )
