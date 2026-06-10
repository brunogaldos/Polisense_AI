"""Gemini provider via Vertex AI's OpenAI-compatible chat-completions endpoint.

Authentication uses a Google Cloud service account JSON. Set GEMINI_SERVICE_ACCOUNT_KEY
to its path; if unset, falls back to GOOGLE_APPLICATION_CREDENTIALS.
Keep these separate so Firebase (GOOGLE_APPLICATION_CREDENTIALS) and Gemini use
different service accounts.

Required env vars:
  GEMINI_SERVICE_ACCOUNT_KEY  — path to Gemini/Vertex AI service account JSON
                                (falls back to GOOGLE_APPLICATION_CREDENTIALS)
  GOOGLE_CLOUD_LOCATION       — Vertex AI region (default: us-central1)

Optional:
  GOOGLE_CLOUD_PROJECT  — GCP project ID (falls back to project_id in the JSON)
  ROUTER_MODEL          — model for routing/classification
                          (default: google/gemini-2.0-flash-001)
  GEMINI_CHAT_MODEL     — model for answer generation
                          (default: google/gemini-2.0-flash-001)
"""
import json
import logging
import os
from typing import Optional

from app.rag.providers.base import OpenAICompatibleProvider

logger = logging.getLogger("polisense.chatbot")


def _resolve_vertex_credentials() -> tuple[Optional[str], Optional[str]]:
    """Return (access_token, base_url) for Vertex AI, or (None, None) on failure."""
    sa_file = os.getenv("GEMINI_SERVICE_ACCOUNT_KEY") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not sa_file:
        logger.warning("GEMINI_SERVICE_ACCOUNT_KEY not set — Gemini provider unavailable")
        return None, None
    try:
        from google.oauth2 import service_account
        import google.auth.transport.requests

        creds = service_account.Credentials.from_service_account_file(
            sa_file, scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        creds.refresh(google.auth.transport.requests.Request())

        project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project_id:
            with open(sa_file) as f:
                project_id = json.load(f).get("project_id")
        if not project_id:
            logger.error("Cannot determine GCP project ID — set GOOGLE_CLOUD_PROJECT")
            return None, None

        location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
        base_url = (
            f"https://{location}-aiplatform.googleapis.com/v1beta1"
            f"/projects/{project_id}/locations/{location}/endpoints/openapi"
        )
        logger.info("Gemini/Vertex AI endpoint: %s", base_url)
        return creds.token, base_url
    except Exception as exc:
        logger.error("Gemini credential resolution failed: %s", exc)
        return None, None


def build_async_openai_client_for_gemini():
    """Build an AsyncOpenAI client pointed at Vertex AI. Returns None on failure."""
    token, base_url = _resolve_vertex_credentials()
    if not token or not base_url:
        return None
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=token, base_url=base_url)


class GeminiProvider(OpenAICompatibleProvider):
    name = "gemini"

    def __init__(self) -> None:
        token, base_url = _resolve_vertex_credentials()
        super().__init__(
            api_key=token,
            base_url=base_url,
            router_model=os.getenv("ROUTER_MODEL", "google/gemini-2.0-flash-001"),
            chat_model=os.getenv("GEMINI_CHAT_MODEL", "google/gemini-2.0-flash-001"),
        )
