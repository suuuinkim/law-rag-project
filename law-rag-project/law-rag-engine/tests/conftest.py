import math
from types import SimpleNamespace
from typing import Dict, List

import pytest

from app.core.config import settings
from app.services import vector_store


class FakeQdrantClient:
    """
    vector_store가 사용하는 QdrantClient 메서드만 구현한 테스트 더블.
    실제 서버 없이 코사인 유사도로 검색합니다.
    """

    def __init__(self):
        self.collections: Dict[str, List] = {}

    def get_collections(self):
        return SimpleNamespace(
            collections=[SimpleNamespace(name=name) for name in self.collections]
        )

    def get_collection(self, collection_name):
        vectors = vector_store.VectorParams(
            size=vector_store.VECTOR_SIZE,
            distance=vector_store.Distance.COSINE
        )
        return SimpleNamespace(config=SimpleNamespace(params=SimpleNamespace(vectors=vectors)))

    def create_collection(self, collection_name, vectors_config):
        self.collections[collection_name] = []

    def upsert(self, collection_name, points, wait=True):
        self.collections[collection_name].extend(points)

    def query_points(self, collection_name, query, limit):
        def cosine(a, b):
            dot = sum(x * y for x, y in zip(a, b))
            norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
            return dot / norm if norm else 0.0

        scored = [
            SimpleNamespace(score=cosine(query, point.vector), payload=point.payload)
            for point in self.collections.get(collection_name, [])
        ]
        scored.sort(key=lambda point: point.score, reverse=True)
        return SimpleNamespace(points=scored[:limit])


@pytest.fixture
def fake_qdrant(monkeypatch):
    client = FakeQdrantClient()
    monkeypatch.setattr(vector_store, "get_qdrant_client", lambda: client)
    monkeypatch.setattr(settings, "QDRANT_COLLECTION_NAME", "test_collection")
    return client
