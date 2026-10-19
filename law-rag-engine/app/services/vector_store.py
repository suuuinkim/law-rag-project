from typing import List, Dict
from uuid import uuid4

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

from app.core.config import settings

VECTOR_SIZE = 3072


def get_qdrant_client() -> QdrantClient:
    if settings.QDRANT_API_KEY:
        return QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY
        )

    return QdrantClient(
        url=settings.QDRANT_URL
    )


def ensure_collection_exists():
    """
    Qdrant 컬렉션이 없으면 생성합니다.
    Gemini embedding 모델은 3072차원 벡터를 반환합니다.
    """
    client = get_qdrant_client()
    collection_name = settings.QDRANT_COLLECTION_NAME

    collections = client.get_collections().collections
    collection_names = [
        collection.name
        for collection in collections
    ]

    if collection_name in collection_names:
        return

    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=VECTOR_SIZE,
            distance=Distance.COSINE
        )
    )


def upsert_chunks(
        document_id: str,
        original_filename: str,
        chunks: List[Dict],
        embeddings: List[List[float]]
) -> int:
    """
    청크와 임베딩을 Qdrant에 저장합니다.
    """
    if len(chunks) != len(embeddings):
        raise ValueError("chunks와 embeddings 개수가 일치하지 않습니다.")

    ensure_collection_exists()

    client = get_qdrant_client()
    points = []

    for chunk, embedding in zip(chunks, embeddings):
        point = PointStruct(
            id=str(uuid4()),
            vector=embedding,
            payload={
                "document_id": document_id,
                "original_filename": original_filename,
                "chunk_id": chunk["chunk_id"],
                "chunk_index": chunk["chunk_index"],
                "page_number": chunk["page_number"],
                "page_chunk_index": chunk["page_chunk_index"],
                "text": chunk["text"],
                "text_length": chunk["text_length"]
            }
        )

        points.append(point)

    client.upsert(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        points=points
    )

    return len(points)

def search_similar_chunks(
        question_embedding: List[float],
        limit: int = 5
) -> List[Dict]:
    """
    질문 임베딩과 유사한 청크를 Qdrant에서 검색합니다.
    """
    client = get_qdrant_client()

    query_result = client.query_points(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        query=question_embedding,
        limit=limit
    )

    results = []

    for point in query_result.points:
        payload = point.payload or {}

        results.append({
            "score": point.score,
            "document_id": payload.get("document_id"),
            "original_filename": payload.get("original_filename"),
            "chunk_id": payload.get("chunk_id"),
            "chunk_index": payload.get("chunk_index"),
            "page_number": payload.get("page_number"),
            "page_chunk_index": payload.get("page_chunk_index"),
            "text": payload.get("text"),
            "text_length": payload.get("text_length")
        })

    return results

def recreate_collection():
    """
    기존 Qdrant 컬렉션을 삭제하고 단일 벡터 컬렉션으로 다시 생성합니다.
    """
    client = get_qdrant_client()
    collection_name = settings.QDRANT_COLLECTION_NAME

    collections = client.get_collections().collections
    collection_names = [
        collection.name
        for collection in collections
    ]

    if collection_name in collection_names:
        client.delete_collection(
            collection_name=collection_name
        )

    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=VECTOR_SIZE,
            distance=Distance.COSINE
        )
    )

def list_documents() -> List[Dict]:
    """
    Qdrant에 인덱싱된 문서 목록을 반환합니다.
    document_id 기준으로 중복을 제거하고 청크 수와 페이지 수를 집계합니다.
    """
    client = get_qdrant_client()
    documents = {}
    offset = None

    while True:
        result, next_offset = client.scroll(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            with_payload=True,
            with_vectors=False,
            limit=100,
            offset=offset
        )

        for point in result:
            payload = point.payload or {}
            doc_id = payload.get("document_id")

            if not doc_id:
                continue

            if doc_id not in documents:
                documents[doc_id] = {
                    "document_id": doc_id,
                    "original_filename": payload.get("original_filename"),
                    "chunk_count": 0,
                    "page_numbers": set()
                }

            documents[doc_id]["chunk_count"] += 1
            page = payload.get("page_number")
            if page is not None:
                documents[doc_id]["page_numbers"].add(page)

        if next_offset is None:
            break
        offset = next_offset

    result_list = []
    for doc in documents.values():
        result_list.append({
            "document_id": doc["document_id"],
            "original_filename": doc["original_filename"],
            "chunk_count": doc["chunk_count"],
            "page_count": len(doc["page_numbers"])
        })

    return result_list


def delete_document(document_id: str) -> int:
    """
    특정 document_id에 해당하는 벡터를 Qdrant에서 모두 삭제합니다.
    삭제된 포인트 수를 반환합니다.
    """
    client = get_qdrant_client()

    count_before = client.count(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        count_filter=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
        ),
        exact=True
    ).count

    if count_before == 0:
        return 0

    client.delete(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        points_selector=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
        )
    )

    return count_before


def deduplicate_results(results: List[Dict]) -> List[Dict]:
    """
    검색 결과에서 같은 문서명, 페이지, 청크 ID 기준으로 중복을 제거
    같은 PDF를 여러 번 인덱싱했을 때 중복 citation이 나오는 것을 방지
    """

    seen = set()
    unique_results = []

    for result in results:
        key = (
            result.get("original_filename"),
            result.get("page_number"),
            result.get("chunk_id"),
        )

        if key in seen:
            continue

        seen.add(key)
        unique_results.append(result)

    return unique_results