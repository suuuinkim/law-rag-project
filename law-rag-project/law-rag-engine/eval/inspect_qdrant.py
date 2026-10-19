"""
Qdrant 컬렉션 상태를 읽기 전용으로 점검합니다. (scroll/count만 사용, 쓰기·삭제 없음)

같은 PDF가 여러 번 인덱싱되어 있는지, 문서별로 어느 페이지까지 인덱싱되었는지 확인해
평가 결과가 중복 데이터로 왜곡되지 않는지 판단하는 데 사용합니다.

사용법 (law-rag-engine 디렉터리에서):
    python -m eval.inspect_qdrant [--collection law_documents] [--out eval/results/qdrant_state.json]
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from app.core.config import settings
from app.services.vector_store import get_qdrant_client


def inspect_collection(collection_name: str) -> dict:
    client = get_qdrant_client()

    existing = [c.name for c in client.get_collections().collections]
    if collection_name not in existing:
        return {"collection_name": collection_name, "exists": False}

    total = client.count(collection_name=collection_name, exact=True).count

    documents = defaultdict(lambda: {"chunk_ids": set(), "pages": set(), "points": 0})
    offset = None

    while True:
        points, offset = client.scroll(
            collection_name=collection_name,
            with_payload=["document_id", "original_filename", "chunk_id", "page_number"],
            with_vectors=False,
            limit=256,
            offset=offset
        )

        for point in points:
            payload = point.payload or {}
            key = (payload.get("document_id"), payload.get("original_filename"))
            documents[key]["points"] += 1
            documents[key]["chunk_ids"].add(payload.get("chunk_id"))
            if payload.get("page_number") is not None:
                documents[key]["pages"].add(payload.get("page_number"))

        if offset is None:
            break

    per_document = []
    by_filename = defaultdict(list)

    for (document_id, filename), info in documents.items():
        row = {
            "document_id": document_id,
            "original_filename": filename,
            "points": info["points"],
            "unique_chunk_ids": len(info["chunk_ids"]),
            "max_page": max(info["pages"]) if info["pages"] else None,
        }
        per_document.append(row)
        by_filename[filename].append(row)

    filename_summary = []
    for filename, rows in by_filename.items():
        filename_summary.append({
            "original_filename": filename,
            "document_id_count": len(rows),
            "total_points": sum(r["points"] for r in rows),
            "points_per_document": sorted({r["points"] for r in rows}),
            "max_page_per_document": sorted({r["max_page"] for r in rows if r["max_page"] is not None}),
        })

    return {
        "collection_name": collection_name,
        "exists": True,
        "points_count": total,
        "document_count": len(per_document),
        "filenames": sorted(filename_summary, key=lambda r: -r["total_points"]),
        "documents": sorted(per_document, key=lambda r: (str(r["original_filename"]), str(r["document_id"]))),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection", default=settings.QDRANT_COLLECTION_NAME)
    parser.add_argument("--out", default="eval/results/qdrant_state.json")
    args = parser.parse_args()

    state = inspect_collection(args.collection)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({k: v for k, v in state.items() if k != "documents"}, ensure_ascii=False, indent=2))
    print(f"saved: {out_path}")


if __name__ == "__main__":
    main()
