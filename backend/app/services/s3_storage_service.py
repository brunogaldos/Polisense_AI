"""S3 storage — Python port of backend/src/services/s3StorageService.ts (boto3).

Same env vars as the Node version (AWS_REGION, AWS_ACCESS_KEY_ID,
AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET) so both backends hit the identical bucket.
All methods are synchronous (boto3 is blocking) — call them via
asyncio.to_thread from async request handlers so the event loop isn't pinned.
"""

import logging
import os
from typing import Optional

import boto3

logger = logging.getLogger(__name__)


class S3StorageService:
    _client = None

    @classmethod
    def _get_client(cls):
        if cls._client is None:
            cls._client = boto3.client(
                "s3",
                region_name=os.getenv("AWS_REGION", "us-east-1"),
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            )
        return cls._client

    @staticmethod
    def _get_bucket() -> str:
        bucket = os.getenv("AWS_S3_BUCKET")
        if not bucket:
            raise RuntimeError("AWS_S3_BUCKET environment variable is not set")
        return bucket

    @classmethod
    def upload_file(cls, buffer: bytes, key: str, content_type: str) -> dict:
        """Upload bytes to S3. Returns bucket, key, and versionId (if S3
        Versioning is enabled)."""
        bucket = cls._get_bucket()
        response = cls._get_client().put_object(
            Bucket=bucket, Key=key, Body=buffer, ContentType=content_type
        )
        return {"bucket": bucket, "key": key, "versionId": response.get("VersionId")}

    @classmethod
    def download_file(cls, bucket: str, key: str) -> bytes:
        """Download an S3 object as bytes. Used for file recovery when the
        original is needed from storage."""
        response = cls._get_client().get_object(Bucket=bucket, Key=key)
        body = response.get("Body")
        if body is None:
            raise RuntimeError(f"Empty response body for S3 object: s3://{bucket}/{key}")
        return body.read()
