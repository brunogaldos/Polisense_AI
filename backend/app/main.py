"""Polisense API — FastAPI backend."""

import asyncio
import json
import logging
import os
import random
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.chatbot.skills_first_chat_bot import SkillsFirstChatBot
from app.ingestion.json_converter import json_to_markdown, json_to_summary_lines
from app.ingestion.openai_extraction_service import OpenAIExtractionService
from app.services.firestore_memory_service import FirestoreMemoryService
from app.services.vertex_rag_service import VertexRagService
from app.services.s3_storage_service import S3StorageService

logging.basicConfig(
    level=logging.WARNING,  # silence library noise
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logging.getLogger("polisense").setLevel(logging.INFO)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)  # suppress HTTP access lines
logger = logging.getLogger("polisense")

# Same default base path as chatController.ts (API_BASE_PATH || "/api/policy_research").
BASE_PATH = os.getenv("API_BASE_PATH", "/api/policy_research")


def _load_data_layout() -> dict:
    candidates = []
    env_path = os.getenv("DATA_LAYOUT_PATH")
    if env_path:
        candidates.append(Path(env_path))
    backend_py = Path(__file__).resolve().parents[1]
    candidates.append(backend_py / "data" / "dataLayout.json")
    for path in candidates:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            logger.info("Loaded dataLayout for RAG chatbot from %s", path)
            return data
        except Exception:  # noqa: BLE001
            continue
    logger.error("Failed to load dataLayout — using minimal fallback")
    return {
        "categories": [],
        "aboutProject": "RAG chatbot for policy research",
        "documentUrls": [],
        "jsonUrls": [],
    }


DATA_LAYOUT = _load_data_layout()

app = FastAPI(title="Polisense API (Python)")

# Permissive CORS reflecting the request origin with credentials — matches the
# Node app's behavior (allow all origins, allow credentials). allow_origin_regex
# echoes the origin back, which is required when allow_credentials=True.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length"],
)

# WebSocket client registry — mirrors customApp.ts `wsClients` (clientId -> socket).
# Stored on app.state so route handlers / future services can broadcast to a
# specific wsClientId during a chat turn.
ws_clients: dict[str, WebSocket] = {}
app.state.ws_clients = ws_clients


@app.get("/health")
async def health() -> dict:
    # Must answer instantly (Cloud Run liveness probe) — no async work here.
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    client_id = str(uuid.uuid4())
    ws_clients[client_id] = websocket
    # First frame is the client id — the frontend resolves its connect promise on this.
    await websocket.send_json({"clientId": client_id})
    logger.info("WS connected: %s (%d clients)", client_id, len(ws_clients))
    try:
        while True:
            # Inbound frames are ignored — a chat turn is started via the PUT /
            # HTTP call carrying wsClientId (same split as the Node server). We
            # receive only to detect disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.pop(client_id, None)
        logger.info("WS disconnected: %s (%d clients)", client_id, len(ws_clients))


# ---------------------------------------------------------------------------
# WebSocket broadcast — mirrors chatController.ts sendWsEvent: pushes
# { sender: 'bot', type, data } to every connected client. The ingestion
# pipeline uses it to report progress/completion to all open UIs.
# ---------------------------------------------------------------------------


async def broadcast_ws_event(event_type: str, data: dict) -> None:
    message = {"sender": "bot", "type": event_type, "data": data}
    sent = 0
    for client_id, ws in list(ws_clients.items()):
        try:
            await ws.send_json(message)
            sent += 1
        except Exception as e:  # noqa: BLE001
            logger.error("WS send error to %s: %s", client_id, e)
    logger.info("WS '%s' -> %d/%d clients", event_type, sent, len(ws_clients))


async def _safe_delete_artifacts(corpus_name: Any, rag_file_id: Any) -> None:
    """Fire-and-forget Vertex AI RAG file cleanup for one document."""
    try:
        await asyncio.to_thread(
            VertexRagService.delete_file_artifacts, corpus_name, rag_file_id
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Vertex AI RAG file cleanup failed: %s", e)


async def _cleanup_conversation_artifacts(memory: dict, memory_id: str) -> None:
    """Fire-and-forget cleanup when a whole conversation is deleted: delete every
    per-document RAG file, then delete the corpus itself as a backstop."""
    corpus_name = memory.get("ragCorpusName")
    for doc in memory.get("uploadedDocuments") or []:
        await _safe_delete_artifacts(corpus_name, doc.get("ragFileId"))
    if corpus_name:
        try:
            await asyncio.to_thread(VertexRagService.delete_corpus, corpus_name)
            logger.info("Deleted RAG corpus %s (conversation %s)", corpus_name, memory_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not delete RAG corpus %s: %s", corpus_name, e)

    # Best-effort: drop the conversation's chunks from the local Weaviate store
    # too. Gated by RAG_DUAL_WRITE so it's a no-op (no heavy import) when the
    # local stack isn't in use.
    if _dual_write_on():
        try:
            from app.rag.store.ingest import delete_by_memory

            await asyncio.to_thread(delete_by_memory, memory_id)
            logger.info("Deleted Weaviate chunks for conversation %s", memory_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("Weaviate cleanup failed for %s (non-fatal): %s", memory_id, e)


# ---------------------------------------------------------------------------
# Dual-write side-channel (Milestone B). When RAG_DUAL_WRITE is on, document
# ingestion ALSO parses/chunks/embeds into the local Weaviate store, in parallel
# with the authoritative OpenAI vector-store path. Fire-and-forget so it never
# delays the user-facing completion event; lazy imports keep torch/Docling out
# of the startup path when the flag is off.
# ---------------------------------------------------------------------------


def _dual_write_on() -> bool:
    return (os.getenv("RAG_DUAL_WRITE") or "").strip().lower() in ("1", "true", "yes", "on")


def _schedule_dual_write_pdf(
    file_buffer: bytes, original_name: str, mime_type: str, memory_id: str, file_id: str
) -> None:
    is_pdf = mime_type == "application/pdf" or bool(re.search(r"\.pdf$", original_name or "", re.IGNORECASE))
    if not (_dual_write_on() and memory_id and is_pdf):
        return

    async def _run() -> None:
        from app.rag.ingest_document import safe_dual_write_pdf

        await asyncio.to_thread(
            safe_dual_write_pdf, file_buffer, original_name, memory_id, file_id
        )

    asyncio.create_task(_run())


def _schedule_dual_write_markdown(
    markdown: str, file_name: str, memory_id: str, file_id: str
) -> None:
    if not (_dual_write_on() and memory_id and (markdown or "").strip()):
        return

    async def _run() -> None:
        from app.rag.ingest_document import safe_dual_write_markdown

        await asyncio.to_thread(
            safe_dual_write_markdown, markdown, file_name, memory_id, file_id
        )

    asyncio.create_task(_run())


# ---------------------------------------------------------------------------
# Ingestion (GeoJSON + JSON) — ports the fire-and-forget pipeline from
# chatController.ts. The HTTP handler validates, returns 202 with a fileId, and
# schedules the heavy work as an asyncio task that streams progress over WS.
# Blocking SDK calls (S3, OpenAI) run in threads so the event loop stays free.
# ---------------------------------------------------------------------------

_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def _base36(n: int) -> str:
    if n == 0:
        return "0"
    out = ""
    while n > 0:
        n, r = divmod(n, 36)
        out = _B36[r] + out
    return out


def _make_file_id(file_name: str) -> tuple[str, int, str]:
    """Return (fileId, timestamp_ms, sanitized_name) like the Node handlers:
    `${Date.now()}_${rand.toString(36)}_${sanitized}`."""
    timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
    random_suffix = _base36(round(random.random() * 1e9))
    sanitized = re.sub(r"[^a-zA-Z0-9.-]", "_", file_name)
    return f"{timestamp}_{random_suffix}_{sanitized}", timestamp, sanitized


def _flatten_coords(coords: Any) -> list:
    if not isinstance(coords, list):
        return []
    if coords and isinstance(coords[0], (int, float)):
        return [[coords[0], coords[1]]]
    out: list = []
    for c in coords:
        out.extend(_flatten_coords(c))
    return out


def _compute_centroid(coords: Any):
    pts = _flatten_coords(coords)
    if not pts:
        return None
    lng = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return [lng, lat]


async def _process_geojson_ingestion(
    geojson: dict, file_name: str, memory_id: str | None, file_id: str, timestamp: int, sanitized: str
) -> None:
    feature_count = len(geojson.get("features") or [])
    await broadcast_ws_event(
        "extractionProgress", {"fileId": file_id, "phase": "extracting", "fileName": file_name}
    )
    try:
        short_lines: list[str] = []
        rich_blocks: list[str] = []
        for idx, feature in enumerate(geojson.get("features") or []):
            geometry = feature.get("geometry") or {}
            geom_type = geometry.get("type") or "Unknown"
            coords = geometry.get("coordinates")
            centroid = _compute_centroid(coords) if coords is not None else None
            location_str = ""
            if centroid:
                lng, lat = centroid
                location_str = (
                    f"{abs(lat):.5f}°{'N' if lat >= 0 else 'S'}, "
                    f"{abs(lng):.5f}°{'E' if lng >= 0 else 'W'}"
                )

            props: list[str] = []
            for k, v in (feature.get("properties") or {}).items():
                if v is None or v == "":
                    continue
                sval = str(v)
                props.append(f"{k}: {sval[:117] + '...' if len(sval) > 120 else sval}")

            parts = [f"Feature {idx + 1}", f"type: {geom_type}"]
            if location_str:
                parts.append(f"location: {location_str}")
            parts.extend(props)
            short_lines.append(" | ".join(parts))

            lines = [f"--- Feature {idx + 1} ({file_name}) ---", f"Geometry: {geom_type}"]
            if location_str:
                lines.append(f"Location (centroid): {location_str}")
            if props:
                lines.append("Properties:")
                lines.extend(f"  {p}" for p in props)
            rich_blocks.append("\n".join(lines))

        # Upload original GeoJSON to S3 (for download) — non-fatal.
        s3_result = None
        geojson_bytes = json.dumps(geojson, ensure_ascii=False).encode("utf-8")
        try:
            s3_result = await asyncio.to_thread(
                S3StorageService.upload_file,
                geojson_bytes,
                f"uploads/{timestamp}/{sanitized}",
                "application/geo+json",
            )
            logger.info("GeoJSON S3 upload: s3://%s/%s", s3_result["bucket"], s3_result["key"])
        except Exception as e:  # noqa: BLE001
            logger.error("GeoJSON S3 upload failed (non-fatal): %s", e)

        if not memory_id:
            logger.warning("No memoryId — skipping indexing")
            return

        await broadcast_ws_event("extractionProgress", {"fileId": file_id, "phase": "indexing"})

        # Firestore: capped feature summaries for the geospatial handler (<200, ~30KB).
        max_geo_context = 200
        context_lines = short_lines[:max_geo_context]
        if feature_count > max_geo_context:
            logger.warning(
                "Storing %d/%d feature summaries in Firestore for geo context",
                max_geo_context,
                feature_count,
            )
        await asyncio.to_thread(
            FirestoreMemoryService.save_geojson_summaries, memory_id, file_id, file_name, context_lines
        )

        # Vertex AI RAG: full rich-text representation for semantic search.
        corpus_name = await asyncio.to_thread(
            VertexRagService.get_or_create_corpus, memory_id
        )
        full_text = "\n".join(
            [f"File: {file_name}", f"Total features: {feature_count}", "", "\n\n".join(rich_blocks)]
        )
        text_file_name = f"{re.sub(r'[.][^/.]+$', '', file_name)}_features.txt"
        rag_result = await asyncio.to_thread(
            VertexRagService.upload_file_to_corpus,
            full_text.encode("utf-8"),
            text_file_name,
            corpus_name,
            "text/plain",
        )

        # Dual-write the rich feature text into the local store (best-effort, gated).
        _schedule_dual_write_markdown(full_text, file_name, memory_id, file_id)

        # Register doc for download tracking — non-fatal.
        doc: dict[str, Any] = {
            "id": file_id,
            "name": file_name,
            "size": len(geojson_bytes),
            "type": "application/geo+json",
            "uploadTime": datetime.now(timezone.utc),
            "extractionStatus": "rag_ready",
            "extractionMethod": "GEOJSON_VERTEX_RAG",
            "ragCorpusName": corpus_name,
            "ragFileId": rag_result.get("ragFileId"),
        }
        if s3_result:
            doc["s3Bucket"] = s3_result["bucket"]
            doc["s3Key"] = s3_result["key"]
        try:
            await asyncio.to_thread(FirestoreMemoryService.add_or_update_document, memory_id, doc)
        except Exception as e:  # noqa: BLE001
            logger.error("Firestore doc save failed: %s", e)

        await broadcast_ws_event(
            "ragIngestionCompleted",
            {
                "fileId": file_id,
                "documentName": file_name,
                "s3Key": s3_result["key"] if s3_result else None,
                "s3Bucket": s3_result["bucket"] if s3_result else None,
                "message": f'✅ GeoJSON layer "{file_name}" indexed ({feature_count} features ready for queries)',
                "featureCount": feature_count,
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("GeoJSON ingestion failed for %s", file_name)
        await broadcast_ws_event(
            "extractionFailed", {"fileId": file_id, "documentName": file_name, "error": str(e)}
        )


async def _process_json_ingestion(
    data: Any, file_name: str, memory_id: str | None, file_id: str, timestamp: int, sanitized: str
) -> None:
    await broadcast_ws_event(
        "extractionProgress", {"fileId": file_id, "phase": "extracting", "fileName": file_name}
    )
    try:
        markdown = json_to_markdown(data, file_name)
        await broadcast_ws_event("extractionCompleted", {"fileId": file_id, "phase": "extracted"})

        s3_result = None
        json_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            s3_result = await asyncio.to_thread(
                S3StorageService.upload_file,
                json_bytes,
                f"uploads/{timestamp}/{sanitized}",
                "application/json",
            )
            logger.info("JSON S3 upload: s3://%s/%s", s3_result["bucket"], s3_result["key"])
        except Exception as e:  # noqa: BLE001
            logger.error("JSON S3 upload failed (non-fatal): %s", e)

        if not memory_id:
            logger.warning("No memoryId — skipping summary storage")
            return

        await broadcast_ws_event("extractionProgress", {"fileId": file_id, "phase": "indexing"})

        summaries = json_to_summary_lines(data, file_name)
        await asyncio.to_thread(
            FirestoreMemoryService.save_geojson_summaries, memory_id, file_id, file_name, summaries
        )

        doc: dict[str, Any] = {
            "id": file_id,
            "name": file_name,
            "size": len(json_bytes),
            "type": "application/json",
            "uploadTime": datetime.now(timezone.utc),
            "extractionStatus": "rag_ready",
            "extractionMethod": "JSON_SUMMARIES",
        }
        if s3_result:
            doc["s3Bucket"] = s3_result["bucket"]
            doc["s3Key"] = s3_result["key"]
        try:
            await asyncio.to_thread(FirestoreMemoryService.add_or_update_document, memory_id, doc)
        except Exception as e:  # noqa: BLE001
            logger.error("Firestore doc save failed: %s", e)

        # Upload to Vertex AI RAG corpus (best-effort, fire-and-forget).
        async def _upload_md() -> None:
            try:
                _corpus_name = await asyncio.to_thread(
                    VertexRagService.get_or_create_corpus, memory_id
                )
                result = await asyncio.to_thread(
                    VertexRagService.upload_file_to_corpus,
                    markdown.encode("utf-8"),
                    f"{file_id}.md",
                    _corpus_name,
                )
                logger.info("JSON indexed in Vertex AI RAG corpus %s (file=%s)", _corpus_name, result["ragFileId"])
            except Exception as e:  # noqa: BLE001
                logger.warning("Vertex AI RAG upload failed (non-fatal): %s", e)

        asyncio.create_task(_upload_md())

        # Dual-write the converted Markdown into the local store (best-effort, gated).
        _schedule_dual_write_markdown(markdown, file_name, memory_id, file_id)

        await broadcast_ws_event(
            "ragIngestionCompleted",
            {
                "fileId": file_id,
                "documentName": file_name,
                "s3Key": s3_result["key"] if s3_result else None,
                "s3Bucket": s3_result["bucket"] if s3_result else None,
                "message": f'✅ "{file_name}" indexed ({len(summaries)} records ready for queries)',
                "summaryCount": len(summaries),
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("JSON ingestion failed for %s", file_name)
        await broadcast_ws_event(
            "extractionFailed", {"fileId": file_id, "documentName": file_name, "error": str(e)}
        )


_IMAGE_EXT_RE = re.compile(r"\.(png|jpe?g|gif|webp)$", re.IGNORECASE)
_XLSX_EXT_RE = re.compile(r"\.(xlsx|xlsm|xltm|xltx)$", re.IGNORECASE)
_LEGACY_XLS_RE = re.compile(r"\.(xls|xlsb)$", re.IGNORECASE)


def _strip_ext_md(name: str) -> str:
    """`foo.pdf` -> `foo.md` (mirrors the Node `.replace(/\\.[^/.]+$/, '') + '.md'`)."""
    return re.sub(r"\.[^/.]+$", "", name) + ".md"


def _process_pdf_ingestion_sync(
    file_buffer: bytes, original_name: str, mime_type: str, corpus_name: str
) -> dict:
    """Blocking core of PDF/image/spreadsheet ingestion (Vertex AI RAG).
    Returns {ragFileId, ingestionMethod}. Runs in a thread."""
    is_image = bool(re.match(r"^image/", mime_type or "", re.IGNORECASE)) or bool(
        _IMAGE_EXT_RE.search(original_name)
    )

    if is_image:
        # Extract text via Gemini Vision, then index the markdown in the RAG corpus.
        logger.info("%r is an image — extracting text via Gemini Vision", original_name)
        try:
            from app.ingestion.gemini_extraction_service import GeminiExtractionService
            extracted = GeminiExtractionService.extract_from_image(file_buffer, original_name, mime_type)
            md = (extracted.get("markdown") or "").encode("utf-8")
            if md.strip():
                result = VertexRagService.upload_file_to_corpus(
                    md, _strip_ext_md(original_name), corpus_name, "text/markdown"
                )
                return {"ragFileId": result["ragFileId"], "ingestionMethod": "gemini_vision"}
        except Exception as _img_err:  # noqa: BLE001
            logger.warning("Gemini Vision extraction failed for %r: %s — S3 only", original_name, _img_err)
        return {"ragFileId": None, "ingestionMethod": "image_s3_only"}

    if _XLSX_EXT_RE.search(original_name):
        # OOXML spreadsheets — extract locally to row-bounded Markdown, then
        # index in the RAG corpus.
        logger.info("Extracting spreadsheet %r locally via openpyxl", original_name)
        extracted = OpenAIExtractionService.extract_from_spreadsheet(file_buffer, original_name)
        md = (extracted.get("markdown") or extracted.get("text") or "").encode("utf-8")
        result = VertexRagService.upload_file_to_corpus(
            md, _strip_ext_md(original_name), corpus_name, "text/markdown"
        )
        return {"ragFileId": result["ragFileId"], "ingestionMethod": "spreadsheet"}

    if _LEGACY_XLS_RE.search(original_name):
        ext = _LEGACY_XLS_RE.search(original_name).group(0)
        raise ValueError(
            f"{ext} files are not supported. Please save the workbook as .xlsx "
            f"(or .xlsm) and re-upload."
        )

    # Default: upload original bytes directly to Vertex AI RAG (supports PDF, text, etc.).
    logger.info("Uploading %r (%d bytes) to Vertex AI RAG corpus %s", original_name, len(file_buffer), corpus_name)
    result = VertexRagService.upload_file_to_corpus(file_buffer, original_name, corpus_name, mime_type)
    return {"ragFileId": result["ragFileId"], "ingestionMethod": "direct"}


async def _process_pdf_ingestion(
    file_buffer: bytes,
    original_name: str,
    mime_type: str,
    memory_id: str | None,
    file_id: str,
    timestamp: int,
    sanitized: str,
) -> None:
    """Background PDF/image/spreadsheet ingestion — S3 upload, vector-store
    indexing (with OCR / spreadsheet fallbacks), Firestore status, WS events."""
    try:
        # 1. Register doc so it's findable for download.
        if memory_id:
            try:
                await asyncio.to_thread(
                    FirestoreMemoryService.add_or_update_document,
                    memory_id,
                    {
                        "id": file_id,
                        "name": original_name,
                        "size": len(file_buffer),
                        "type": mime_type,
                        "uploadTime": datetime.now(timezone.utc),
                        "extractionStatus": "extracting",
                    },
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("Firestore doc registration failed: %s", e)

        # 2. Upload to S3 for download-later (non-fatal).
        s3_result = None
        try:
            s3_result = await asyncio.to_thread(
                S3StorageService.upload_file, file_buffer, f"uploads/{timestamp}/{sanitized}", mime_type
            )
            logger.info("S3 upload: s3://%s/%s", s3_result["bucket"], s3_result["key"])
            if memory_id:
                try:
                    await asyncio.to_thread(
                        FirestoreMemoryService.update_document_status,
                        memory_id,
                        file_id,
                        "extracting",
                        {
                            "documentName": original_name,
                            "s3Bucket": s3_result["bucket"],
                            "s3Key": s3_result["key"],
                        },
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("S3 ref update failed: %s", e)
        except Exception as e:  # noqa: BLE001
            logger.error(
                "S3 upload failed (bucket=%s, region=%s): %s",
                os.getenv("AWS_S3_BUCKET"),
                os.getenv("AWS_REGION"),
                e,
            )

        # 3. Index in the vector store (skipped without a memoryId).
        if not memory_id:
            logger.warning("No memoryId — skipping vector store upload for %s", original_name)
            await broadcast_ws_event(
                "ragIngestionCompleted",
                {
                    "fileId": file_id,
                    "documentName": original_name,
                    "s3Key": s3_result["key"] if s3_result else None,
                    "s3Bucket": s3_result["bucket"] if s3_result else None,
                    "message": f'✅ "{original_name}" ready',
                },
            )
            return

        corpus_name = await asyncio.to_thread(
            VertexRagService.get_or_create_corpus, memory_id
        )
        indexed = await asyncio.to_thread(
            _process_pdf_ingestion_sync, file_buffer, original_name, mime_type, corpus_name
        )

        # 4. Mark ready in Firestore + notify frontend.
        method = {
            "spreadsheet": "EXCELJS_MARKDOWN",
            "gemini_vision": "GEMINI_VISION_OCR",
            "image_s3_only": "S3_ONLY",
        }.get(indexed["ingestionMethod"], "VERTEX_AI_RAG")
        try:
            await asyncio.to_thread(
                FirestoreMemoryService.update_document_status,
                memory_id,
                file_id,
                "rag_ready",
                {
                    "documentName": original_name,
                    "ragFileId": indexed["ragFileId"],
                    "ragCorpusName": corpus_name,
                    "extractionMethod": method,
                },
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Final status update failed: %s", e)

        # Dual-write the original PDF into the local store (best-effort, gated).
        _schedule_dual_write_pdf(file_buffer, original_name, mime_type, memory_id, file_id)

        await broadcast_ws_event(
            "ragIngestionCompleted",
            {
                "fileId": file_id,
                "documentName": original_name,
                "s3Key": s3_result["key"] if s3_result else None,
                "s3Bucket": s3_result["bucket"] if s3_result else None,
                "message": f'✅ "{original_name}" indexed and ready for queries',
            },
        )
    except Exception as err:  # noqa: BLE001
        err_msg = str(err)
        logger.exception("PDF ingestion failed for %s", original_name)
        if memory_id:
            try:
                await asyncio.to_thread(
                    FirestoreMemoryService.update_document_status,
                    memory_id,
                    file_id,
                    "failed",
                    {"documentName": original_name, "extractionError": err_msg},
                )
            except Exception:  # noqa: BLE001
                pass
        await broadcast_ws_event(
            "extractionFailed", {"fileId": file_id, "documentName": original_name, "error": err_msg}
        )


# ---------------------------------------------------------------------------
# Read-only routes (Firestore-backed). More specific paths are declared BEFORE
# the catch-all GET /{memory_id} so they take precedence.
# ---------------------------------------------------------------------------


@app.get(BASE_PATH + "/conversations")
async def get_user_conversations(userId: str | None = None):
    if not userId:
        return JSONResponse({"error": "userId is required"}, status_code=400)
    conversations = FirestoreMemoryService.get_user_conversations(userId)
    return {"conversations": conversations}


@app.get(BASE_PATH + "/conversations/{memory_id}/documents")
async def get_conversation_documents(memory_id: str):
    documents = FirestoreMemoryService.get_conversation_documents(memory_id)
    return {"documents": documents}


def _parse_upload_time(value: Any) -> datetime:
    """Mirror `document.uploadTime ? new Date(uploadTime) : new Date()` — accept
    epoch ms, ISO string, or nothing. A datetime is stored as a Firestore Timestamp."""
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(timezone.utc)
    return datetime.now(timezone.utc)


@app.post(BASE_PATH + "/conversations/{memory_id}/documents")
async def add_document(memory_id: str, body: dict):
    document = body.get("document")
    user_id = body.get("userId")
    if not document or not document.get("id") or not document.get("name"):
        return JSONResponse({"error": "document with id and name is required"}, status_code=400)
    doc_to_save = {
        **document,
        "uploadTime": _parse_upload_time(document.get("uploadTime")),
        "extractionStatus": document.get("extractionStatus") or "pending",
    }
    try:
        FirestoreMemoryService.add_or_update_document(memory_id, doc_to_save, user_id)
        return {"success": True, "document": {**doc_to_save, "uploadTime": doc_to_save["uploadTime"].isoformat()}}
    except Exception:  # noqa: BLE001
        logger.exception("Error adding document to %s", memory_id)
        return JSONResponse({"error": "Failed to add document"}, status_code=500)


@app.put(BASE_PATH + "/conversations/{memory_id}/documents/{document_id}")
async def update_document_status(memory_id: str, document_id: str, body: dict):
    status = body.get("status")
    if not status:
        return JSONResponse({"error": "status is required"}, status_code=400)
    additional = {
        "extractionMethod": body.get("extractionMethod"),
        "markdownFileName": body.get("markdownFileName"),
        "extractionError": body.get("extractionError"),
        "extractedMetadata": body.get("extractedMetadata"),
        "documentName": body.get("documentName"),
    }
    try:
        FirestoreMemoryService.update_document_status(memory_id, document_id, status, additional)
        return {"success": True}
    except Exception:  # noqa: BLE001
        logger.exception("Error updating document status %s/%s", memory_id, document_id)
        return JSONResponse({"error": "Failed to update document status"}, status_code=500)


@app.delete(BASE_PATH + "/conversations/{memory_id}/documents/{document_id}")
async def remove_document(memory_id: str, document_id: str):
    try:
        removed = FirestoreMemoryService.remove_document(memory_id, document_id)
        # Fire-and-forget OpenAI Files + vector-store cleanup of the removed doc's
        # artifacts. Failures are logged, never propagated — Firestore is updated.
        if removed:
            asyncio.create_task(
                _safe_delete_artifacts(
                    removed.get("ragCorpusName"),
                    removed.get("ragFileId"),
                )
            )
        return {"success": True}
    except Exception:  # noqa: BLE001
        logger.exception("Error removing document %s/%s", memory_id, document_id)
        return JSONResponse({"error": "Failed to remove document"}, status_code=500)


@app.delete(BASE_PATH + "/conversations/{memory_id}")
async def delete_conversation(memory_id: str, userId: str | None = None):
    try:
        memory = FirestoreMemoryService.load_memory(memory_id)
        # Ownership check — reject if the conversation belongs to another user.
        if userId and memory and memory.get("userId") and memory.get("userId") != userId:
            return JSONResponse(
                {"error": "Unauthorized: Conversation does not belong to user"}, status_code=403
            )
        FirestoreMemoryService.delete_memory(memory_id)
        # Fire-and-forget cleanup of the conversation's OpenAI vector store + every
        # uploaded file's artifacts. Loaded BEFORE deletion so we know what to clean.
        if memory:
            asyncio.create_task(_cleanup_conversation_artifacts(memory, memory_id))
        return {"success": True}
    except Exception:  # noqa: BLE001
        logger.exception("Error deleting conversation %s", memory_id)
        return Response(status_code=500)


@app.post(BASE_PATH + "/conversations/{memory_id}/metadata")
async def update_conversation_metadata(memory_id: str, body: dict):
    try:
        FirestoreMemoryService.update_conversation_metadata(
            memory_id,
            {
                "conversationTitle": body.get("conversationTitle"),
                "conversationSummary": body.get("conversationSummary"),
            },
        )
        return {"success": True}
    except Exception:  # noqa: BLE001
        logger.exception("Error updating metadata for %s", memory_id)
        return Response(status_code=500)


# ---------------------------------------------------------------------------
# Ingestion + download routes.
# ---------------------------------------------------------------------------


@app.post(BASE_PATH + "/ingest-geojson")
async def ingest_geojson(body: dict):
    geojson_content = body.get("geojsonContent")
    file_name = body.get("fileName")
    memory_id = body.get("memoryId")
    if geojson_content in (None, "") or not file_name:
        return JSONResponse({"error": "geojsonContent and fileName are required"}, status_code=400)
    try:
        geojson = json.loads(geojson_content) if isinstance(geojson_content, str) else geojson_content
    except (ValueError, TypeError):
        return JSONResponse({"error": "Invalid GeoJSON content"}, status_code=400)
    if (
        not isinstance(geojson, dict)
        or geojson.get("type") != "FeatureCollection"
        or not isinstance(geojson.get("features"), list)
    ):
        return JSONResponse({"error": "Content must be a GeoJSON FeatureCollection"}, status_code=400)

    feature_count = len(geojson["features"])
    file_id, timestamp, sanitized = _make_file_id(file_name)
    asyncio.create_task(
        _process_geojson_ingestion(geojson, file_name, memory_id, file_id, timestamp, sanitized)
    )
    return JSONResponse(
        {
            "success": True,
            "fileId": file_id,
            "featureCount": feature_count,
            "message": f"GeoJSON received ({feature_count} features). RAG ingestion started.",
            "status": "processing",
        },
        status_code=202,
    )


@app.post(BASE_PATH + "/ingest-json")
async def ingest_json(body: dict):
    json_content = body.get("jsonContent")
    file_name = body.get("fileName")
    memory_id = body.get("memoryId")
    if json_content in (None, "") or not file_name:
        return JSONResponse({"error": "jsonContent and fileName are required"}, status_code=400)
    try:
        data = json.loads(json_content) if isinstance(json_content, str) else json_content
    except (ValueError, TypeError):
        return JSONResponse({"error": "Invalid JSON content"}, status_code=400)

    if isinstance(data, list):
        record_count, unit = len(data), "records"
    elif isinstance(data, dict):
        record_count, unit = len(data), "keys"
    else:
        record_count, unit = 1, "keys"

    file_id, timestamp, sanitized = _make_file_id(file_name)
    asyncio.create_task(
        _process_json_ingestion(data, file_name, memory_id, file_id, timestamp, sanitized)
    )
    return JSONResponse(
        {
            "success": True,
            "fileId": file_id,
            "recordCount": record_count,
            "message": f"JSON received ({record_count} {unit}). Ingestion started.",
            "status": "processing",
        },
        status_code=202,
    )


@app.post(BASE_PATH + "/ingest-pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    memoryId: str | None = Form(default=None),
    userId: str | None = Form(default=None),
):
    """Multipart upload — mirrors the Node multer single('file') handler. Reads
    the file, returns 202 with a fileId, and runs extraction in the background."""
    file_buffer = await file.read()
    if not file_buffer:
        return JSONResponse({"error": "No file provided"}, status_code=400)

    original_name = file.filename or "upload"
    mime_type = file.content_type or "application/octet-stream"
    file_id, timestamp, sanitized = _make_file_id(original_name)

    asyncio.create_task(
        _process_pdf_ingestion(
            file_buffer, original_name, mime_type, memoryId, file_id, timestamp, sanitized
        )
    )
    return JSONResponse({"success": True, "fileId": file_id, "status": "processing"}, status_code=202)


@app.get(BASE_PATH + "/conversations/{memory_id}/documents/{document_id}/download")
async def download_document(memory_id: str, document_id: str, name: str | None = None):
    try:
        documents = await asyncio.to_thread(
            FirestoreMemoryService.get_conversation_documents, memory_id
        )
        # Search order: exact id, then name==documentId (id/name drift), then ?name= hint.
        doc = (
            next((d for d in documents if d.get("id") == document_id), None)
            or next((d for d in documents if d.get("name") == document_id), None)
            or (next((d for d in documents if d.get("name") == name), None) if name else None)
        )
        if not doc:
            logger.warning(
                "Download: document not found. memoryId=%s documentId=%s name=%s",
                memory_id,
                document_id,
                name,
            )
            return JSONResponse(
                {
                    "error": "Document not found. It may have been uploaded before download support "
                    "was added — please re-upload to enable downloads."
                },
                status_code=404,
            )

        if doc.get("s3Bucket") and doc.get("s3Key"):
            file_bytes = await asyncio.to_thread(
                S3StorageService.download_file, doc["s3Bucket"], doc["s3Key"]
            )
        else:
            logger.warning(
                "Download: document found (%s) but S3 refs missing",
                doc.get("id"),
            )
            return JSONResponse(
                {
                    "error": "File is not yet available for download. It may still be processing — "
                    "please try again in a moment."
                },
                status_code=404,
            )

        s3_key = doc.get("s3Key") or ""
        file_name = doc.get("name") or (s3_key.split("/")[-1] if s3_key else None) or "download"
        return Response(
            content=file_bytes,
            media_type=doc.get("type") or "application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{quote(file_name)}"'},
        )
    except Exception:  # noqa: BLE001
        logger.exception("Error downloading document from S3")
        return JSONResponse({"error": "Failed to download document"}, status_code=500)


@app.put(BASE_PATH + "/")
async def skills_first_chat(body: dict):
    """The chat turn — port of chatController.ts skillsFirstChat. Loads memory to
    return the existing chatLog (so the UI can hydrate), then runs the bot as a
    detached task that streams the answer over the wsClientId WebSocket. Mirrors
    the Node split: HTTP responds immediately; output goes over WS."""
    chat_log = body.get("chatLog")
    ws_client_id = body.get("wsClientId")
    memory_id = body.get("memoryId")
    silent_mode = bool(body.get("silentMode"))
    user_id = body.get("userId")

    _last_entry = (chat_log or [{}])[-1]
    _last_sender = _last_entry.get("sender", "?")
    _last_msg = (_last_entry.get("message") or "")[:200].replace("\n", " ")
    logger.info(
        "CHAT REQUEST — user=%s memory=%s ws=%s log_len=%d | [%s] %s",
        user_id or "anon",
        memory_id or "new",
        ws_client_id or "none",
        len(chat_log or []),
        _last_sender,
        _last_msg,
    )

    save_chat_log = None
    try:
        bot = SkillsFirstChatBot(ws_client_id, ws_clients, memory_id, user_id)
        bot.silent_mode = silent_mode

        if memory_id:
            memory = await asyncio.to_thread(FirestoreMemoryService.load_memory, memory_id)
            if memory:
                save_chat_log = memory.get("chatLog")
                bot.memory = bot._ensure_stages(memory)  # reuse the load we just did

        asyncio.create_task(bot.skills_first_conversation(chat_log, DATA_LAYOUT))
    except Exception:  # noqa: BLE001
        logger.exception("skillsFirstChat init failed")
        return Response(status_code=500)

    logger.info("ChatController for %s initialized chatLog len=%s", ws_client_id, len(chat_log or []))
    if save_chat_log is not None:
        return JSONResponse(save_chat_log)
    return Response(status_code=200)


@app.get(BASE_PATH + "/{memory_id}")
async def get_chat_log(memory_id: str):
    memory = FirestoreMemoryService.load_memory(memory_id)
    if memory is None:
        return Response(status_code=404)
    payload: dict = {
        "chatLog": memory.get("chatLog", []),
        "totalCosts": FirestoreMemoryService.full_cost_of_memory(memory),
    }
    uploaded = memory.get("uploadedDocuments")
    if uploaded:
        payload["uploadedDocuments"] = uploaded
    return payload
