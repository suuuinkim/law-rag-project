"""
LawLens 검색 파이프라인의 Hit Rate@k를 측정합니다.

POST /documents/search 와 같은 경로를 그대로 재사용합니다.
    create_embeddings([question])[0] -> search_similar_chunks(limit=k) -> deduplicate_results

운영 데이터 보호:
- 평가는 별도 컬렉션(기본 law_documents_eval)에서만 인덱싱합니다.
- 운영 컬렉션(.env의 QDRANT_COLLECTION_NAME)은 --search-only 로 읽기만 할 수 있습니다.
- 평가 컬렉션에 같은 PDF가 이미 완전하게 인덱싱되어 있으면 재인덱싱하지 않습니다(중복 방지).
- 평가 컬렉션 초기화(--reset-eval-collection)는 실행 중 사용자 확인(y)을 받은 뒤에만 수행합니다.

비용 관리:
- Gemini 임베딩 결과는 eval/cache/에 캐시하여 재실행 시 다시 호출하지 않습니다.
- --dry-run 은 Gemini를 호출하지 않고 필요한 API 호출 수만 계산합니다.

사용법 (law-rag-engine 디렉터리에서):
    python -m eval.run_hit_rate --dry-run
    python -m eval.run_hit_rate
    python -m eval.run_hit_rate --collection law_documents --search-only
"""
import argparse
import csv
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

from qdrant_client.models import FieldCondition, Filter, MatchValue

from app.core.config import settings
from app.services import embedding as embedding_service
from app.services.chunker import create_chunks_from_pages
from app.services.pdf_loader import extract_pages_from_pdf
from app.services.vector_store import (
    deduplicate_results,
    ensure_collection_exists,
    get_qdrant_client,
    search_similar_chunks,
    upsert_chunks,
)
from eval.metrics import evaluate_retrieval, hit_rate, load_questions, percentile

DEFAULT_PDF = "eval/data/근로기준법(법률)(제20520호)(20251023).pdf"
DEFAULT_EVAL_COLLECTION = "law_documents_eval"

# app/api/documents.py 와 동일한 청크 설정
CHUNK_SIZE = 800
OVERLAP = 120
# app/services/embedding.py 의 create_embeddings 배치 크기
EMBEDDING_BATCH_SIZE = 5


class EmbeddingCache:
    """
    (모델명, 텍스트) 기준으로 임베딩을 디스크에 캐시합니다.
    캐시에 없는 텍스트만 기존 create_embeddings로 요청합니다.
    """

    def __init__(self, path: Path):
        self.path = path
        self.data: Dict[str, List[float]] = {}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def key(text: str) -> str:
        raw = f"{settings.GEMINI_EMBEDDING_MODEL}\n{text.strip()}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def missing(self, texts: List[str]) -> List[str]:
        return [text for text in texts if self.key(text) not in self.data]

    def embed(self, texts: List[str]) -> Tuple[List[List[float]], int]:
        """
        임베딩 목록과 실제 API로 요청한 텍스트 수를 반환합니다.
        """
        missing = list(dict.fromkeys(self.missing(texts)))

        if missing:
            vectors = embedding_service.create_embeddings(missing)
            if len(vectors) != len(missing):
                raise RuntimeError("임베딩 개수가 요청한 텍스트 수와 다릅니다.")
            for text, vector in zip(missing, vectors):
                self.data[self.key(text)] = vector
            self.save()

        return [self.data[self.key(text)] for text in texts], len(missing)

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data), encoding="utf-8")


def file_md5(path: str) -> str:
    return hashlib.md5(Path(path).read_bytes()).hexdigest()


def count_document_points(collection: str, original_filename: str) -> int:
    client = get_qdrant_client()
    existing = [c.name for c in client.get_collections().collections]
    if collection not in existing:
        return 0

    return client.count(
        collection_name=collection,
        count_filter=Filter(
            must=[FieldCondition(key="original_filename", match=MatchValue(value=original_filename))]
        ),
        exact=True
    ).count


def reset_eval_collection(collection: str, protected: str):
    if collection == protected:
        raise SystemExit(f"운영 컬렉션 '{protected}'은 초기화할 수 없습니다.")

    answer = input(f"평가 컬렉션 '{collection}'을 삭제합니다. 계속하려면 y 입력: ").strip().lower()
    if answer != "y":
        raise SystemExit("사용자가 초기화를 취소했습니다.")

    client = get_qdrant_client()
    existing = [c.name for c in client.get_collections().collections]
    if collection in existing:
        client.delete_collection(collection_name=collection)


def index_pdf(pdf_path: str, chunks: List[Dict], cache: EmbeddingCache) -> Dict:
    """
    /documents/upload/index 와 같은 함수(ensure_collection_exists, create_embeddings, upsert_chunks)로
    PDF 전체 청크를 인덱싱합니다. max_chunks 제한은 적용하지 않습니다.
    """
    ensure_collection_exists()

    texts = [chunk["text"] for chunk in chunks]
    embeddings, api_texts = cache.embed(texts)

    indexed = upsert_chunks(
        document_id=f"eval-{file_md5(pdf_path)[:12]}",
        original_filename=Path(pdf_path).name,
        chunks=chunks,
        embeddings=embeddings
    )

    return {"indexed_count": indexed, "embedding_api_texts": api_texts}


def search_question(question: str, top_k: int, cache: EmbeddingCache) -> Dict:
    started = time.perf_counter()
    vectors, api_texts = cache.embed([question])
    embedded = time.perf_counter()

    results = search_similar_chunks(question_embedding=vectors[0], limit=top_k)
    raw_count = len(results)
    results = deduplicate_results(results)
    finished = time.perf_counter()

    return {
        "results": results,
        "raw_count": raw_count,
        "query_embedding_cached": api_texts == 0,
        "embed_ms": (embedded - started) * 1000,
        "qdrant_ms": (finished - embedded) * 1000,
        "total_ms": (finished - started) * 1000,
    }


def format_retrieved(results: List[Dict]) -> str:
    return "; ".join(
        f'{result.get("original_filename")}#p{result.get("page_number")}'
        f'/{result.get("chunk_id")}({result.get("score"):.4f})'
        for result in results
    )


def summarize(rows: List[Dict], top_k: int) -> Dict:
    answerable = [row for row in rows if row["answerable"]]
    unanswerable = [row for row in rows if not row["answerable"]]

    by_category = {}
    for category in sorted({row["category"] for row in answerable}):
        category_rows = [row for row in answerable if row["category"] == category]
        by_category[category] = {
            "questions": len(category_rows),
            "hits": sum(1 for row in category_rows if row["hit"]),
            f"hit_rate@{top_k}": hit_rate(category_rows),
        }

    live_rows = [row for row in rows if not row["query_embedding_cached"]]
    total_ms = [row["total_ms"] for row in rows]
    qdrant_ms = [row["qdrant_ms"] for row in rows]

    answerable_top1 = [row["top1_score"] for row in answerable if row["top1_score"] is not None]
    unanswerable_top1 = [row["top1_score"] for row in unanswerable if row["top1_score"] is not None]

    return {
        f"hit_rate@{top_k}": hit_rate(answerable),
        "answerable_questions": len(answerable),
        "hits": sum(1 for row in answerable if row["hit"]),
        "mean_evidence_recall": (
            sum(row["evidence_recall"] for row in answerable) / len(answerable) if answerable else None
        ),
        "by_category": by_category,
        "latency_ms": {
            "note": "total = 질문 임베딩 + Qdrant 검색 + 중복 제거. 캐시된 질문 임베딩은 API 지연이 빠지므로 live_query_embeddings 수를 함께 확인할 것.",
            "live_query_embeddings": len(live_rows),
            "total_mean": sum(total_ms) / len(total_ms) if total_ms else None,
            "total_p95": percentile(total_ms, 95),
            "qdrant_mean": sum(qdrant_ms) / len(qdrant_ms) if qdrant_ms else None,
            "qdrant_p95": percentile(qdrant_ms, 95),
            "live_total_mean": (
                sum(row["total_ms"] for row in live_rows) / len(live_rows) if live_rows else None
            ),
            "live_total_p95": percentile([row["total_ms"] for row in live_rows], 95),
        },
        "results_shrunk_by_dedup": [row["question_id"] for row in rows if row["result_count"] < row["raw_count"]],
        "rejection_eval": {
            "note": "현재 검색 단계에는 점수 임계값이 없어 답이 없는 질문에도 항상 결과를 반환한다. 아래는 top-1 점수로 분리 가능한지 확인하는 참고 지표이다.",
            "unanswerable_questions": len(unanswerable),
            "unanswerable_returned_results": sum(1 for row in unanswerable if row["result_count"] > 0),
            "answerable_top1_min": min(answerable_top1) if answerable_top1 else None,
            "unanswerable_top1_max": max(unanswerable_top1) if unanswerable_top1 else None,
            "separable_by_top1_threshold": (
                min(answerable_top1) > max(unanswerable_top1)
                if answerable_top1 and unanswerable_top1 else None
            ),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", default=DEFAULT_PDF)
    parser.add_argument("--questions", default="eval/questions.json")
    parser.add_argument("--collection", default=DEFAULT_EVAL_COLLECTION)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--out-dir", default="eval/results")
    parser.add_argument("--cache", default="eval/cache/embeddings.json")
    parser.add_argument("--search-only", action="store_true", help="인덱싱 없이 기존 컬렉션을 읽기만 합니다.")
    parser.add_argument("--dry-run", action="store_true", help="Gemini 호출 없이 필요한 API 호출 수만 계산합니다.")
    parser.add_argument("--reset-eval-collection", action="store_true")
    args = parser.parse_args()

    protected_collection = settings.QDRANT_COLLECTION_NAME

    if args.collection == protected_collection and not args.search_only:
        raise SystemExit(
            f"'{protected_collection}'은 .env에 설정된 운영 컬렉션입니다. "
            "평가 인덱싱은 별도 컬렉션에서만 수행하세요. (읽기 전용 평가는 --search-only)"
        )

    # 기존 함수들이 settings.QDRANT_COLLECTION_NAME을 호출 시점에 읽으므로 평가 컬렉션으로 전환합니다.
    settings.QDRANT_COLLECTION_NAME = args.collection

    questions = load_questions(args.questions)
    pages = extract_pages_from_pdf(args.pdf)
    chunks = create_chunks_from_pages(pages, chunk_size=CHUNK_SIZE, overlap=OVERLAP)
    filename = Path(args.pdf).name
    cache = EmbeddingCache(Path(args.cache))

    existing_points = count_document_points(args.collection, filename)
    needs_indexing = not args.search_only and existing_points == 0

    if not args.search_only and existing_points not in (0, len(chunks)):
        if not args.reset_eval_collection:
            raise SystemExit(
                f"평가 컬렉션 '{args.collection}'에 '{filename}' 포인트가 {existing_points}개 있습니다 "
                f"(기대값 {len(chunks)}). 중복 또는 부분 인덱싱 상태이므로 평가를 중단합니다. "
                "--reset-eval-collection 으로 평가 컬렉션을 초기화한 뒤 다시 실행하세요."
            )
        needs_indexing = True

    if args.dry_run:
        texts_to_embed = (cache.missing([c["text"] for c in chunks]) if needs_indexing else [])
        query_texts = cache.missing([q["question"] for q in questions])
        print(json.dumps({
            "collection": args.collection,
            "pdf_pages": len(pages),
            "pdf_chunks": len(chunks),
            "existing_points_for_pdf": existing_points,
            "needs_indexing": needs_indexing,
            "uncached_chunk_embeddings": len(texts_to_embed),
            "uncached_query_embeddings": len(query_texts),
            "estimated_embed_content_requests": (
                math.ceil(len(texts_to_embed) / EMBEDDING_BATCH_SIZE) + len(query_texts)
            ),
            "embedding_model": settings.GEMINI_EMBEDDING_MODEL,
        }, ensure_ascii=False, indent=2))
        return

    index_info = {"indexed_count": 0, "embedding_api_texts": 0}
    if needs_indexing:
        if args.reset_eval_collection:
            reset_eval_collection(args.collection, protected_collection)
        index_info = index_pdf(args.pdf, chunks, cache)

    rows = []
    for question in questions:
        outcome = search_question(question["question"], args.top_k, cache)
        results = outcome["results"]
        evaluation = evaluate_retrieval(
            question["expected_document"], question["expected_pages"], results
        )

        rows.append({
            "question_id": question["question_id"],
            "category": question["category"],
            "answerable": question["answerable"],
            "question": question["question"],
            "expected": "; ".join(f'{question["expected_document"]}#p{p}' for p in question["expected_pages"]),
            "retrieved": format_retrieved(results),
            "retrieved_pages": "|".join(str(r.get("page_number")) for r in results),
            "scores": "|".join(f'{r.get("score"):.4f}' for r in results),
            "raw_count": outcome["raw_count"],
            "result_count": len(results),
            "hit": evaluation["hit"],
            "evidence_recall": evaluation["evidence_recall"],
            "first_hit_rank": evaluation["first_hit_rank"],
            "top1_score": results[0].get("score") if results else None,
            "embed_ms": round(outcome["embed_ms"], 1),
            "qdrant_ms": round(outcome["qdrant_ms"], 1),
            "total_ms": round(outcome["total_ms"], 1),
            "query_embedding_cached": outcome["query_embedding_cached"],
        })

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_path = out_dir / f"hit_rate_{args.collection}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    summary = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "collection": args.collection,
        "search_only": args.search_only,
        "pdf": filename,
        "pdf_md5": file_md5(args.pdf),
        "pdf_chunks": len(chunks),
        "points_for_pdf_before_run": existing_points,
        "index_info": index_info,
        "embedding_model": settings.GEMINI_EMBEDDING_MODEL,
        "top_k": args.top_k,
        "questions": len(questions),
        **summarize(rows, args.top_k),
    }

    summary_path = out_dir / f"hit_rate_{args.collection}_summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"saved: {csv_path}, {summary_path}")


if __name__ == "__main__":
    main()
