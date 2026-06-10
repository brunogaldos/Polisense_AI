"""Async port of @policysynth/api PsBaseChatBot + the local PsBaseChatBotFirestore.

The Node original wraps a synchronous `ws` socket and an optional Redis store.
This port targets FastAPI/Starlette: WebSocket sends are async and memory is
Firestore-only (no Redis). The chat turn runs as a detached asyncio task, so
every WS send is awaited on the running loop.

Only the surface the chat turn actually uses is reimplemented: memory
load/save, the WS message helpers (sendToClient / sendAgent*), the cost-stage
scaffolding, and chat-log handling. The Redis path and the setTimeout-based
live-cost broadcaster are intentionally dropped — the skills pipeline never
invokes them.
"""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, Optional

from app.services.firestore_memory_service import FirestoreMemoryService

logger = logging.getLogger("polisense.chatbot")

# PsConstants.analyseExternalSolutionsModel token prices (USD per token).
_IN_TOKEN_COST = 0.01 / 1000
_OUT_TOKEN_COST = 0.03 / 1000
_WORDS_TO_TOKENS_MAGIC_CONSTANT = 1.3


def _empty_stage() -> dict[str, int]:
    return {"tokensInCost": 0, "tokensOutCost": 0, "tokensIn": 0, "tokensOut": 0}


class PsBaseChatBot:
    """Async base chatbot. Subclasses override the conversation entry point."""

    def __init__(
        self,
        ws_client_id: Optional[str],
        ws_clients: dict[str, Any],
        memory_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> None:
        self.ws_client_id = ws_client_id
        self.ws_clients = ws_clients
        self.ws_client_socket = ws_clients.get(ws_client_id) if ws_clients else None
        self.user_id = user_id

        self.memory: Optional[dict[str, Any]] = None
        self.memory_id = memory_id
        self.silent_mode = False
        self.persist_memory = False

        self.temperature = 0.7
        self.max_tokens = 4000
        self.llm_model = "gpt-4o-mini"

        from app.rag.providers.factory import get_provider
        # AsyncOpenAI client pointed at Vertex AI — reuses the cached provider singleton
        self.openai_client = getattr(get_provider(), '_client', None)

        if not self.ws_client_socket:
            logger.warning("WS client %s not found in registry", ws_client_id)

    # ─── WebSocket helpers ─────────────────────────────────────────────────────

    async def _ws_send(self, payload: dict[str, Any]) -> None:
        """Send one JSON frame to this turn's client. Re-resolves the socket from
        the registry if the cached handle was dropped (client reconnected)."""
        sock = self.ws_client_socket
        if sock is None and self.ws_clients and self.ws_client_id:
            sock = self.ws_clients.get(self.ws_client_id)
            self.ws_client_socket = sock
        if sock is None:
            return
        try:
            await sock.send_text(json.dumps(payload))
        except Exception as e:  # noqa: BLE001
            logger.warning("WS send error: %s", e)
            self.ws_client_socket = None

    async def send_to_client(self, sender: str, message: str, type: str = "stream") -> None:
        """Stream-frame to the client: {sender, type, message}. NB this envelope
        uses `message` (chat), distinct from the ingestion broadcast's `data`."""
        if self.silent_mode:
            return
        await self._ws_send({"sender": sender, "type": type, "message": message})

    async def send_memory_id(self) -> None:
        await self._ws_send({"sender": "bot", "type": "memoryIdCreated", "data": self.memory_id})

    async def send_agent_start(self, name: str, has_no_streaming: bool = True) -> None:
        if self.silent_mode:
            return
        await self._ws_send(
            {"sender": "bot", "type": "agentStart", "data": {"name": name, "noStreaming": has_no_streaming}}
        )

    async def send_agent_completed(
        self, name: str, last_agent: bool = False, error: Optional[str] = None
    ) -> None:
        if self.silent_mode:
            return
        await self._ws_send(
            {"sender": "bot", "type": "agentCompleted", "data": {"name": name, "lastAgent": last_agent, "error": error}}
        )

    async def send_agent_update(self, message: str) -> None:
        if self.silent_mode:
            return
        await self._ws_send({"sender": "bot", "type": "agentUpdated", "message": message})

    # ─── Memory ────────────────────────────────────────────────────────────────

    def get_empty_memory(self) -> dict[str, Any]:
        return {
            "memoryId": self.memory_id,
            "currentStage": "chatbot-conversation",
            "stages": {"chatbot-conversation": _empty_stage()},
            "timeStart": int(time.time() * 1000),
            "chatLog": [],
            "totalCost": 0,
        }

    @staticmethod
    def _ensure_stages(memory: dict[str, Any]) -> dict[str, Any]:
        memory.setdefault("stages", {})
        memory["stages"].setdefault("chatbot-conversation", _empty_stage())
        return memory

    async def load_memory(self) -> dict[str, Any]:
        """Firestore-only load (no Redis fallback). Returns empty memory on miss."""
        if self.memory_id:
            mem = await asyncio.to_thread(FirestoreMemoryService.load_memory, self.memory_id)
            if mem:
                return self._ensure_stages(mem)
        return self.get_empty_memory()

    async def get_loaded_memory(self) -> dict[str, Any]:
        return await self.load_memory()

    async def setup_memory(self) -> None:
        """Mirror of the Node constructor's setupMemory (run explicitly since
        Python __init__ can't await)."""
        if self.memory_id:
            self.memory = await self.load_memory()
        else:
            self.memory_id = str(uuid.uuid4())
            self.memory = self.get_empty_memory()
            await self.send_memory_id()

    async def save_memory(self) -> None:
        if self.memory and self.memory_id:
            await asyncio.to_thread(
                FirestoreMemoryService.save_memory, self.memory_id, self.memory, self.user_id
            )
        else:
            logger.error("Memory is not initialized (memoryId=%s)", self.memory_id)

    async def save_memory_if_needed(self) -> None:
        if self.persist_memory:
            await self.save_memory()

    async def set_chat_log(self, chat_log: list[dict[str, Any]]) -> None:
        if self.memory is None:
            self.memory = self.get_empty_memory()
        self.memory["chatLog"] = chat_log
        await self.save_memory_if_needed()

    # ─── Cost tracking ──────────────────────────────────────────────────────────

    @staticmethod
    def get_full_cost_of_memory(memory: dict[str, Any]) -> Optional[float]:
        if memory and memory.get("stages"):
            total = 0.0
            for stage in memory["stages"].values():
                if isinstance(stage, dict) and stage.get("tokensInCost") and stage.get("tokensOutCost"):
                    total += stage["tokensInCost"] + stage["tokensOutCost"]
            return total
        return None

    def _get_token_costs(self, estimate_tokens: float, kind: str) -> float:
        return estimate_tokens * (_IN_TOKEN_COST if kind == "in" else _OUT_TOKEN_COST)

    def add_to_memory_costs(self, text: str, kind: str) -> None:
        """Word-count-based cost estimate accumulated on the chatbot stage —
        parity with addToExternalSolutionsMemoryCosts."""
        if not text or not self.memory:
            return
        parts = [p for p in text.split(" ") if p != ""]
        estimate = len(parts) * _WORDS_TO_TOKENS_MAGIC_CONSTANT
        stage = self.memory["stages"].setdefault("chatbot-conversation", _empty_stage())
        if kind == "in":
            stage["tokensIn"] = stage.get("tokensIn", 0) + estimate
            stage["tokensInCost"] = stage.get("tokensInCost", 0) + self._get_token_costs(estimate, "in")
        else:
            stage["tokensOut"] = stage.get("tokensOut", 0) + estimate
            stage["tokensOutCost"] = stage.get("tokensOutCost", 0) + self._get_token_costs(estimate, "out")
