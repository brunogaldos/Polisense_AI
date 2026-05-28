"""LLM provider abstraction — lets local (OpenRouter) and OpenAI generation
coexist behind one interface, selected by the AI_PROVIDER env var.

Milestone B wires the *router* (intent classification) through this seam; the
default (AI_PROVIDER=openai) is behaviour-identical to the previous direct
client call. Generation (run_multimodal_conversation) is flipped in a later
milestone once the streaming Delta normaliser lands.
"""
from app.rag.providers.factory import (
    generation_is_local,
    get_generation_provider,
    get_provider,
)

__all__ = ["get_provider", "get_generation_provider", "generation_is_local"]
