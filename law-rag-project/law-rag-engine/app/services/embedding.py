import time
from typing import List

from google import genai

from app.core.config import settings


def get_gemini_client() -> genai.Client:
    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY가 설정되어 있지 않습니다.")

    return genai.Client(api_key=settings.GEMINI_API_KEY)


def create_embedding(text: str) -> List[float]:
    """
    단일 텍스트를 Gemini 임베딩 벡터로 변환합니다.
    """
    if not text or not text.strip():
        raise ValueError("임베딩할 텍스트가 비어 있습니다.")

    client = get_gemini_client()

    result = client.models.embed_content(
        model=settings.GEMINI_EMBEDDING_MODEL,
        contents=text
    )

    return result.embeddings[0].values


def create_embeddings(texts: List[str]) -> List[List[float]]:
    """
    여러 텍스트를 Gemini 임베딩 벡터로 변환합니다.
    단, quota 제한을 피하기 위해 작은 배치로 나누어 처리합니다.
    """
    clean_texts = [
        text.strip()
        for text in texts
        if text and text.strip()
    ]

    if not clean_texts:
        return []

    client = get_gemini_client()

    batch_size = 5
    sleep_seconds = 3
    all_embeddings = []

    for start in range(0, len(clean_texts), batch_size):
        batch = clean_texts[start:start + batch_size]

        result = client.models.embed_content(
            model=settings.GEMINI_EMBEDDING_MODEL,
            contents=batch
        )

        batch_embeddings = [
            embedding.values
            for embedding in result.embeddings
        ]

        all_embeddings.extend(batch_embeddings)

        # 마지막 배치가 아니면 잠깐 대기
        if start + batch_size < len(clean_texts):
            time.sleep(sleep_seconds)

    return all_embeddings