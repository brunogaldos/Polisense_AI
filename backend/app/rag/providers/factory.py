"""Provider — always Gemini via Vertex AI. Cached per process."""
import logging

from app.rag.providers.base import LLMProvider
from app.rag.providers.gemini_provider import GeminiProvider

logger = logging.getLogger("polisense.chatbot")

_cache: dict[str, LLMProvider] = {}


def get_provider() -> LLMProvider:
    if "gemini" not in _cache:
        provider = GeminiProvider()
        logger.info("LLM provider: %s (available=%s)", provider.name, provider.available)
        _cache["gemini"] = provider
    return _cache["gemini"]


def get_generation_provider() -> LLMProvider:
    return get_provider()


def generation_is_local() -> bool:
    return False


def reset_provider_cache() -> None:
    """Test helper — clear cached providers."""
    _cache.clear()
