import pytest

from app.api import documents
from app.schemas.search_schema import SearchRequest
from app.services.chunker import create_chunks_from_pages
from app.services.vector_store import deduplicate_results, upsert_chunks


def result(score, document_id, filename, page, chunk_id):
    return {
        "score": score,
        "document_id": document_id,
        "original_filename": filename,
        "page_number": page,
        "chunk_id": chunk_id,
    }


def test_same_evidence_from_reindexed_pdf_is_removed():
    results = [
        result(0.91, "doc-a", "law.pdf", 11, "page-11-chunk-1"),
        result(0.91, "doc-b", "law.pdf", 11, "page-11-chunk-1"),
        result(0.91, "doc-c", "law.pdf", 11, "page-11-chunk-1"),
    ]

    unique = deduplicate_results(results)

    assert unique == [results[0]]


def test_different_chunks_on_same_page_are_kept():
    results = [
        result(0.91, "doc-a", "law.pdf", 11, "page-11-chunk-0"),
        result(0.88, "doc-a", "law.pdf", 11, "page-11-chunk-1"),
    ]

    assert deduplicate_results(results) == results


def test_results_from_different_documents_are_kept():
    results = [
        result(0.91, "doc-a", "law.pdf", 1, "page-1-chunk-0"),
        result(0.90, "doc-b", "other-law.pdf", 1, "page-1-chunk-0"),
    ]

    assert deduplicate_results(results) == results


def test_same_filename_with_different_document_id_is_merged_by_design():
    """
    현재 계약: 중복 키가 (original_filename, page_number, chunk_id)이고 document_id는 포함하지 않는다.
    내용이 다른 두 PDF가 같은 파일명으로 업로드되면 서로 다른 근거도 하나로 합쳐진다. (한계로 기록)
    """
    results = [
        result(0.91, "doc-2024", "law.pdf", 3, "page-3-chunk-0"),
        result(0.85, "doc-2025", "law.pdf", 3, "page-3-chunk-0"),
    ]

    assert deduplicate_results(results) == [results[0]]


def test_duplicates_with_different_scores_keep_highest_when_sorted():
    results = [
        result(0.93, "doc-a", "law.pdf", 11, "page-11-chunk-1"),
        result(0.80, "doc-a", "law.pdf", 13, "page-13-chunk-0"),
        result(0.79, "doc-b", "law.pdf", 11, "page-11-chunk-1"),
    ]

    unique = deduplicate_results(results)

    assert [r["score"] for r in unique] == [0.93, 0.80]
    assert unique[0]["document_id"] == "doc-a"


def test_duplicates_keep_first_occurrence_not_max_score():
    """
    현재 계약: 정렬하지 않고 처음 등장한 결과를 유지한다.
    Qdrant query_points가 점수 내림차순으로 반환하므로 실제 경로에서는 최고 점수가 유지된다.
    """
    results = [
        result(0.70, "doc-a", "law.pdf", 11, "page-11-chunk-1"),
        result(0.95, "doc-b", "law.pdf", 11, "page-11-chunk-1"),
    ]

    assert deduplicate_results(results) == [results[0]]


def test_empty_results():
    assert deduplicate_results([]) == []


def _index_copies(copies: int):
    """
    같은 PDF를 여러 번 업로드한 상황을 재현합니다. (uploads/에 동일 PDF 25개, 로컬 Qdrant에 2벌 존재)
    """
    pages = [{"page_number": page, "text": f"조문 {page}"} for page in range(1, 7)]
    chunks = create_chunks_from_pages(pages)
    # 질문 벡터 [1, 0]과의 유사도가 페이지 순서대로 낮아지도록 구성
    embeddings = [[1.0, page * 0.1] for page in range(1, 7)]

    for copy in range(copies):
        upsert_chunks(f"doc-{copy}", "law.pdf", chunks, embeddings)


def test_search_endpoint_returns_unique_results_for_single_copy(fake_qdrant, monkeypatch):
    _index_copies(1)
    monkeypatch.setattr(documents, "create_embeddings", lambda texts: [[1.0, 0.0]])

    response = documents.search_documents(SearchRequest(question="질문", limit=5))

    assert response["result_count"] == 5
    assert [r["page_number"] for r in response["results"]] == [1, 2, 3, 4, 5]


@pytest.mark.xfail(
    strict=True,
    reason="발견된 문제: /documents/search는 Qdrant에서 limit개만 가져온 뒤 중복을 제거한다. "
           "같은 PDF가 여러 번 인덱싱되어 있으면 서로 다른 근거가 있어도 limit보다 적은 결과가 반환된다."
)
def test_search_endpoint_returns_limit_unique_results_when_pdf_indexed_twice(fake_qdrant, monkeypatch):
    _index_copies(2)
    monkeypatch.setattr(documents, "create_embeddings", lambda texts: [[1.0, 0.0]])

    response = documents.search_documents(SearchRequest(question="질문", limit=5))

    assert response["result_count"] == 5
