"""
평가 데이터셋의 정답 근거를 실제 PDF 원문과 대조합니다. (외부 API 호출 없음)

- expected_evidence가 지정한 페이지 원문에 실제로 있는지 확인 → verified / pending_verification
- 근거 문장이 어느 청크에 들어가는지 확인 (청크 경계에서 잘리는지 확인)
- /documents/upload/index 기본값 max_chunks=20으로 인덱싱했을 때 근거가 인덱스에 포함되는지 확인

사용법 (law-rag-engine 디렉터리에서):
    python -m eval.validate_dataset
"""
import argparse
import csv
import json
from pathlib import Path

from app.services.chunker import create_chunks_from_pages
from app.services.pdf_loader import extract_pages_from_pdf
from eval.metrics import load_questions, normalize, parse_page_group

DEFAULT_PDF = "eval/data/근로기준법(법률)(제20520호)(20251023).pdf"

# app/api/documents.py 의 인덱싱 설정과 동일하게 맞춥니다.
CHUNK_SIZE = 800
OVERLAP = 120
API_DEFAULT_MAX_CHUNKS = 20


def validate(questions, pages, chunks):
    page_text = {page["page_number"]: normalize(page["text"]) for page in pages}
    normalized_chunks = [(chunk, normalize(chunk["text"])) for chunk in chunks]

    rows = []

    for question in questions:
        evidences = question["expected_evidence"]
        groups = question["expected_pages"]

        if not question["answerable"]:
            rows.append({
                "question_id": question["question_id"],
                "category": question["category"],
                "evidence_index": "",
                "expected_pages": "",
                "found_on_pages": "",
                "status": "not_applicable (unanswerable)",
                "contained_in_chunk_ids": "",
                "split_across_chunks": "",
                "indexed_with_default_max_chunks_20": "",
            })
            continue

        for index, (evidence, group_value) in enumerate(zip(evidences, groups)):
            target = normalize(evidence)
            group = parse_page_group(group_value)

            found_on = sorted(
                page_number
                for page_number, text in page_text.items()
                if target in text
            )
            verified = bool(group) and group.issubset(set(found_on))

            containing = [
                chunk
                for chunk, text in normalized_chunks
                if target in text and chunk["page_number"] in group
            ]

            in_default_index = any(
                chunk["chunk_index"] < API_DEFAULT_MAX_CHUNKS
                for chunk in containing
            )

            rows.append({
                "question_id": question["question_id"],
                "category": question["category"],
                "evidence_index": index,
                "expected_pages": group_value,
                "found_on_pages": "|".join(str(p) for p in found_on),
                "status": "verified" if verified else "pending_verification",
                "contained_in_chunk_ids": "|".join(chunk["chunk_id"] for chunk in containing),
                "split_across_chunks": verified and not containing,
                "indexed_with_default_max_chunks_20": in_default_index,
            })

    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", default=DEFAULT_PDF)
    parser.add_argument("--questions", default="eval/questions.json")
    parser.add_argument("--out", default="eval/results/dataset_validation.csv")
    args = parser.parse_args()

    questions = load_questions(args.questions)
    pages = extract_pages_from_pdf(args.pdf)
    chunks = create_chunks_from_pages(pages, chunk_size=CHUNK_SIZE, overlap=OVERLAP)

    rows = validate(questions, pages, chunks)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    evidence_rows = [row for row in rows if row["evidence_index"] != ""]
    answerable_ids = sorted({row["question_id"] for row in evidence_rows})
    pending = [row for row in evidence_rows if row["status"] != "verified"]

    covered_questions = [
        question_id
        for question_id in answerable_ids
        if all(
            row["indexed_with_default_max_chunks_20"]
            for row in evidence_rows
            if row["question_id"] == question_id
        )
    ]

    summary = {
        "pdf_pages": len(pages),
        "total_chunks": len(chunks),
        "api_default_max_chunks": API_DEFAULT_MAX_CHUNKS,
        "last_page_indexed_with_default": chunks[API_DEFAULT_MAX_CHUNKS - 1]["page_number"],
        "questions": len(questions),
        "answerable_questions": len(answerable_ids),
        "evidence_items": len(evidence_rows),
        "verified_evidence_items": len(evidence_rows) - len(pending),
        "pending_verification": [f'{row["question_id"]}#{row["evidence_index"]}' for row in pending],
        "evidence_split_across_chunks": [
            f'{row["question_id"]}#{row["evidence_index"]}'
            for row in evidence_rows if row["split_across_chunks"]
        ],
        "answerable_questions_fully_indexed_with_default_max_chunks": covered_questions,
    }

    summary_path = out_path.with_name("dataset_validation_summary.json")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"saved: {out_path}, {summary_path}")


if __name__ == "__main__":
    main()
