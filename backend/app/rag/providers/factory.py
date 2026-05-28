"""Provider selection from AI_PROVIDER. Cached per process.

  AI_PROVIDER=openai      → OpenAIProvider     (default)
  AI_PROVIDER=local       → OpenRouterProvider
  AI_PROVIDER=openrouter  → OpenRouterProvider
"""
import logging
import os

from app.rag.providers.base import LLMProvider
from app.rag.providers.openai_provider import OpenAIProvider
from app.rag.providers.openrouter_provider import OpenRouterProvider

logger = logging.getLogger("polisense.chatbot")

_cache: dict[str, LLMProvider] = {}


def get_provider() -> LLMProvider:
    key = (os.getenv("AI_PROVIDER") or "openai").strip().lower()
    if key not in _cache:
        if key in ("local", "openrouter"):
            provider: LLMProvider = OpenRouterProvider()
        else:
            if key != "openai":
                logger.warning("Unknown AI_PROVIDER=%r — falling back to openai", key)
            provider = OpenAIProvider()
        logger.info("LLM provider selected: %s (available=%s)", provider.name, provider.available)
        _cache[key] = provider
    return _cache[key]


def get_generation_provider() -> LLMProvider:
    """Provider used for answer generation, selected by RAG_GENERATION (default
    openai). This axis is independent of AI_PROVIDER (which drives the router) so
    retrieval and generation can be flipped to local separately.

      RAG_GENERATION=local|openrouter → OpenRouterProvider
      RAG_GENERATION=openai (default) → OpenAIProvider
    """
    key = "gen:" + (os.getenv("RAG_GENERATION") or "openai").strip().lower()
    if key not in _cache:
        if key in ("gen:local", "gen:openrouter"):
            provider: LLMProvider = OpenRouterProvider()
        else:
            provider = OpenAIProvider()
        logger.info("Generation provider: %s (available=%s)", provider.name, provider.available)
        _cache[key] = provider
    return _cache[key]


def generation_is_local() -> bool:
    return (os.getenv("RAG_GENERATION") or "openai").strip().lower() in ("local", "openrouter")


def reset_provider_cache() -> None:
    """Test helper — clear cached providers (e.g. after changing env)."""
    _cache.clear()
