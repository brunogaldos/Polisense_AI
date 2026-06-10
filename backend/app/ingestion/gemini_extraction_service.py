"""Gemini Vision extraction service — replaces OpenAI-based image OCR.

All methods are synchronous (blocking) — call via asyncio.to_thread.
"""

import logging
import os

logger = logging.getLogger(__name__)

GEMINI_CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.0-flash-001").removeprefix("google/")


class GeminiExtractionService:
    @staticmethod
    def extract_from_image(image_buffer: bytes, file_name: str, mime_type: str) -> dict:
        """Extract text from an image using Gemini Vision via Vertex AI."""
        from app.services.vertex_rag_service import _init_vertexai
        from vertexai.generative_models import GenerativeModel, Part

        _init_vertexai()
        logger.info("Gemini Vision OCR: %s (%.1f KB)", file_name, len(image_buffer) / 1024)

        safe_mime = mime_type if (mime_type or "").startswith("image/") else "image/png"
        model = GenerativeModel(GEMINI_CHAT_MODEL)
        image_part = Part.from_data(data=image_buffer, mime_type=safe_mime)

        response = model.generate_content([
            image_part,
            "Extract ALL visible text and content from this image as clean Markdown. "
            "Preserve tables, lists, headings, and numeric data. "
            "Return ONLY the extracted Markdown — no commentary, no preamble.",
        ])

        markdown = getattr(response, "text", "") or ""
        logger.info("Gemini Vision extraction done: %d chars from %s", len(markdown), file_name)

        return {
            "text": markdown,
            "markdown": markdown,
            "pages": 1,
            "extractionMethod": "GEMINI_VISION",
        }
