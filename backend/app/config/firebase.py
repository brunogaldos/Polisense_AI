"""Firebase Admin initialization.

Credential resolution: service-account key file first, then
FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars.
"""

import json
import logging
import os
from pathlib import Path

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

logger = logging.getLogger(__name__)

# backend/app/config/firebase.py → backend/ is two parents up.
_BACKEND_PY = Path(__file__).resolve().parents[2]

for _env in (_BACKEND_PY / ".env", Path.cwd() / ".env"):
    if _env.exists():
        load_dotenv(_env, override=False)

_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "sturdy-quarter-479808-p0")


def _service_account_candidates() -> list[str]:
    return [
        # Dedicated Firebase key takes priority — keeps Firebase and Gemini credentials separate.
        os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", ""),
        # Legacy / fallback paths.
        str(Path.cwd() / "serviceAccountKey.json"),
        str(_BACKEND_PY / "serviceAccountKey.json"),
        str(_BACKEND_PY.parent / "serviceAccountKey.json"),
    ]


def _init_app() -> None:
    if firebase_admin._apps:
        logger.info("Firebase Admin already initialized")
        return

    for path in _service_account_candidates():
        if path and Path(path).exists():
            cred = credentials.Certificate(json.loads(Path(path).read_text()))
            firebase_admin.initialize_app(cred, {"projectId": _PROJECT_ID})
            logger.info("Firebase Admin initialized from %s", path)
            return

    client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
    private_key = os.getenv("FIREBASE_PRIVATE_KEY")
    if client_email and private_key:
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": _PROJECT_ID,
                "client_email": client_email,
                # Env-stored keys escape newlines; restore them like the Node code does.
                "private_key": private_key.replace("\\n", "\n"),
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
        firebase_admin.initialize_app(cred, {"projectId": _PROJECT_ID})
        logger.info("Firebase Admin initialized from environment variables")
        return

    raise RuntimeError(
        "No Firebase credentials found. Provide serviceAccountKey.json (searched: "
        f"{_service_account_candidates()}) or set FIREBASE_CLIENT_EMAIL and "
        "FIREBASE_PRIVATE_KEY."
    )


_init_app()
db = firestore.client()
