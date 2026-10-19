"""
평가 스크립트(eval.run_hit_rate) 전체 흐름 스모크 테스트.

Gemini 대신 결정적인 가짜 임베딩, Qdrant 서버 대신 qdrant-client 인메모리 모드를 사용합니다.
여기서 나오는 Hit Rate는 가짜 임베딩 기준이므로 검색 품질 지표로 사용하지 않습니다.
"""
import csv
import hashlib
import json
import sys
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from app.core.config import settings
from app.services import embedding as embedding_service
from app.services import vector_store
from eval import run_hit_rate

LAW_PDF = Path(__file__).resolve().parents[1] / "eval" / "data" / "근로기준법(법률)(제20520호)(20251023).pdf"
QUESTIONS = Path(__file__).resolve().parents[1] / "eval" / "questions.json"


def fake_vector(text: str):
    vector = [0.0] * vector_store.VECTOR_SIZE
    for i in range(len(text) - 1):
        bucket = int(hashlib.md5(text[i:i + 2].encode("utf-8")).hexdigest(), 16) % vector_store.VECTOR_SIZE
        vector[bucket] += 1.0
    return vector


@pytest.fixture
def offline_pipeline(monkeypatch, tmp_path):
    client = QdrantClient(":memory:")
    calls = {"texts": 0}

    def fake_create_embeddings(texts):
        calls["texts"] += len(texts)
        return [fake_vector(text) for text in texts]

    def no_gemini():
        raise AssertionError("Gemini client must not be created in tests")

    for module in (vector_store, run_hit_rate):
        monkeypatch.setattr(module, "get_qdrant_client", lambda: client)
    monkeypatch.setattr(embedding_service, "create_embeddings", fake_create_embeddings)
    monkeypatch.setattr(embedding_service, "get_gemini_client", no_gemini)
    monkeypatch.setattr(settings, "QDRANT_COLLECTION_NAME", "law_documents")

    def run(*extra):
        argv = [
            "run_hit_rate",
            "--pdf", str(LAW_PDF),
            "--questions", str(QUESTIONS),
            "--out-dir", str(tmp_path / "results"),
            "--cache", str(tmp_path / "cache.json"),
            *extra,
        ]
        monkeypatch.setattr(sys, "argv", argv)
        # main()이 settings.QDRANT_COLLECTION_NAME을 평가 컬렉션으로 바꾸므로 매 실행 전에 복원합니다.
        monkeypatch.setattr(settings, "QDRANT_COLLECTION_NAME", "law_documents")
        run_hit_rate.main()

    return {"run": run, "client": client, "calls": calls, "out": tmp_path / "results"}


@pytest.mark.skipif(not LAW_PDF.exists(), reason="평가용 근로기준법 PDF가 없습니다.")
def test_pipeline_indexes_once_and_writes_results(offline_pipeline):
    offline_pipeline["run"]()

    summary = json.loads((offline_pipeline["out"] / "hit_rate_law_documents_eval_summary.json").read_text(encoding="utf-8"))
    with (offline_pipeline["out"] / "hit_rate_law_documents_eval.csv").open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    assert summary["index_info"]["indexed_count"] == 88
    assert summary["answerable_questions"] == 16
    assert summary["rejection_eval"]["unanswerable_questions"] == 4
    assert len(rows) == 20
    assert all(row["hit"] == "" for row in rows if row["answerable"] == "False")
    assert all(int(row["result_count"]) <= 5 for row in rows)
    assert offline_pipeline["client"].count("law_documents_eval").count == 88
    assert "law_documents" not in [c.name for c in offline_pipeline["client"].get_collections().collections]

    # 재실행 시 중복 인덱싱하지 않고, 캐시 덕분에 임베딩을 다시 요청하지 않는다.
    calls_after_first_run = offline_pipeline["calls"]["texts"]
    offline_pipeline["run"]()
    summary = json.loads((offline_pipeline["out"] / "hit_rate_law_documents_eval_summary.json").read_text(encoding="utf-8"))

    assert summary["points_for_pdf_before_run"] == 88
    assert summary["index_info"]["indexed_count"] == 0
    assert offline_pipeline["client"].count("law_documents_eval").count == 88
    assert offline_pipeline["calls"]["texts"] == calls_after_first_run
    assert summary["latency_ms"]["live_query_embeddings"] == 0


def test_pipeline_refuses_to_index_into_protected_collection(offline_pipeline):
    with pytest.raises(SystemExit):
        offline_pipeline["run"]("--collection", "law_documents")

    assert offline_pipeline["calls"]["texts"] == 0
