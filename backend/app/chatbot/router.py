"""Intent router — Python port of backend/src/chatbot/router.ts (PsRagRouter).

The Node version subclasses BaseIngestionAgent and uses its callLLM helper. Here
it's a single OpenAI chat-completion classification call returning JSON. Same
prompt text and same output contract:
  {intent, primaryCategory, rewrittenUserQuestionVectorDatabaseSearch}
intent ∈ {rag, multi_query, conversational, geospatial}.
"""

import json
import logging
from typing import Any

logger = logging.getLogger("polisense.chatbot")


class PsRagRouter:
    def __init__(self, provider: Any) -> None:
        # `provider` is an LLMProvider (app.rag.providers). With AI_PROVIDER=openai
        # (default) this is behaviour-identical to the previous direct client call.
        self.provider = provider

    def _system_message(self, schema: str, about: str, chat_history: str) -> str:
        return f"""You are an expert user question analyzer for a RAG based chatbot.

Instructions:
- Classify the user's intent as one of: “rag”, “multi_query”, “conversational”, or “geospatial”
  - “geospatial”: ONLY use this when the user clearly wants something to be **rendered, drawn, displayed, or computed on the live interactive Mapbox map in the frontend** — i.e. an action that will change what is visible on the map. Strong signals (any language): an explicit visualization verb such as “show me”, “display”, “render”, “draw”, “plot”, “put on the map”, “visualize”, “muéstrame”, “dibuja”, “muestra en el mapa”, “affiche”; OR a spatial-search request such as “find / locate / search concessions near X”, “concessions within Y km of Z”, “buffer/overlap analysis around …”, “show layers (vegetation, protected areas, communities)”; OR an explicit request for a deep/full geospatial study of a city or region (“make a deep analysis on chisinau”, “run a full analysis on …”). A location reference combined with “concessions / concesiones / concessões” also qualifies.

    CRITICAL — do NOT classify as “geospatial” when:
    • The user is asking ABOUT the content of a map that appears inside an uploaded/ingested document (e.g. “what does the map in the PDF show”, “tell me the legend of the map”, “describe the map in the document”, “what regions are highlighted on that map”). These are questions about document content → use “rag”.
    • The user is asking a general / definitional / conversational question that merely mentions the word “map” (e.g. “what is a cadastral map”) → use “rag” or “conversational”.
    • The word “map” appears but there is no visualization verb and no place + concession reference → default to “rag”.

  In short: classify as “geospatial” only when executing the query will *produce a change on the Mapbox map*. If you are uncertain, prefer “rag”.
  - “multi_query”: the user asks a complex, multi-part, or comprehensive question about the project documents that would benefit from several different search angles to avoid missing relevant sections (e.g. “give me a complete analysis of X”, “explain all aspects of Y”, “review everything about Z”). Only use this for document-oriented questions that need broad coverage.
  - “rag”: the user has a focused question that requires searching project documents (default for document questions)
  - “conversational”: a greeting, simple follow-up, clarification, OR any question that does NOT require document retrieval — including pure mathematical/computational/algorithmic questions, general knowledge questions, coding tasks, and anything the model can answer from its own knowledge or tools without searching project documents
- Choose the most relevant primary category from the available categories
- Always keep track of the topic being discussed from your chat history and include it in
  "rewrittenUserQuestionVectorDatabaseSearch"
- Still allow the user to change the topic mid-conversation; if clearly changed, do not carry
  over the old topic
- Always rewrite the user question based on conversation history for the best possible vector
  search query
- If the question does not need rewriting, leave "rewrittenUserQuestionVectorDatabaseSearch" as ""
- For "geospatial" intent, DO NOT extract place names or radii here — the geospatial LLM agent
  will read the original user message directly and decide which MCP tool to call

Your conversation history with the user:
{chat_history}

About this project:
{about}

Available primary categories:
{schema}

JSON Output:
{{
  "intent": "rag" | "multi_query" | "conversational" | "geospatial",
  "primaryCategory": string,
  "rewrittenUserQuestionVectorDatabaseSearch": string
}}
"""

    def _user_message(self, question: str) -> str:
        return (
            f"<LATEST_QUESTION_FROM_USER>{question}</LATEST_QUESTION_FROM_USER>\n\n"
            "Your JSON classification:\n"
        )

    async def get_routing_data(
        self, user_question: str, data_layout: dict[str, Any], chat_history: str
    ) -> dict[str, Any]:
        if not self.provider or not getattr(self.provider, "available", False):
            logger.error("Router has no available provider — defaulting to rag")
            return {"intent": "rag", "primaryCategory": "", "rewrittenUserQuestionVectorDatabaseSearch": ""}

        logger.info("ROUTER — question=%r", user_question[:150])
        system = self._system_message(
            json.dumps(data_layout.get("categories") or []),
            data_layout.get("aboutProject") or "",
            chat_history,
        )
        try:
            routing = await self.provider.classify_json(system, self._user_message(user_question))
        except Exception as e:  # noqa: BLE001 - any failure degrades to plain rag
            logger.warning("Routing failed (%s) — defaulting to rag", e)
            routing = {}

        routing.setdefault("intent", "rag")
        routing.setdefault("primaryCategory", "")
        routing.setdefault("rewrittenUserQuestionVectorDatabaseSearch", "")
        logger.info("Routing information: %s", json.dumps(routing))
        return routing
