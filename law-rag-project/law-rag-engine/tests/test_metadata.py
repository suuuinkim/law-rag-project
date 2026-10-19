from pathlib import Path

import pymupdf
import pytest

from app.services.chunker import create_chunks_from_pages
from app.services.pdf_loader import extract_pages_from_pdf
from app.services.vector_store import search_similar_chunks, upsert_chunks
from eval.metrics import normalize

LAW_PDF = Path(__file__).resolve().parents[1] / "eval" / "data" / "근로기준법(법률)(제20520호)(20251023).pdf"


@pytest.fixture
def three_page_pdf(tmp_path):
    path = tmp_path / "sample.pdf"
    doc = pymupdf.open()
    for text in ["first page", "second page", "third page"]:
        page = doc.new_page()
        page.insert_text((72, 72), text)
    doc.save(path)
    doc.close()
    return path


def test_page_number_starts_at_one_and_is_sequential(three_page_pdf):
    pages = extract_pages_from_pdf(str(three_page_pdf))

    assert [page["page_number"] for page in pages] == [1, 2, 3]
    assert [page["text"] for page in pages] == ["first page", "second page", "third page"]


def test_missing_pdf_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        extract_pages_from_pdf(str(tmp_path / "missing.pdf"))


def test_chunk_metadata_fields_and_ids():
    pages = [
        {"page_number": 1, "text": "a" * 900},
        {"page_number": 2, "text": "b" * 100},
    ]

    chunks = create_chunks_from_pages(pages, chunk_size=800, overlap=120)

    assert [
        (chunk["chunk_id"], chunk["chunk_index"], chunk["page_number"], chunk["page_chunk_index"])
        for chunk in chunks
    ] == [
        ("page-1-chunk-0", 0, 1, 0),
        ("page-1-chunk-1", 1, 1, 1),
        ("page-2-chunk-0", 2, 2, 0),
    ]
    assert all(chunk["text_length"] == len(chunk["text"]) for chunk in chunks)


@pytest.mark.skipif(not LAW_PDF.exists(), reason="평가용 근로기준법 PDF가 없습니다.")
def test_every_law_chunk_text_comes_from_its_page():
    pages = extract_pages_from_pdf(str(LAW_PDF))
    chunks = create_chunks_from_pages(pages, chunk_size=800, overlap=120)
    page_text = {page["page_number"]: page["text"] for page in pages}

    assert len(pages) == 26
    assert len(chunks) == 88
    assert all(chunk["text"] in page_text[chunk["page_number"]] for chunk in chunks)
    assert "제1조(목적)" in page_text[1]
    assert "제50조(근로시간)" in normalize(page_text[11])


def test_page_metadata_survives_qdrant_round_trip(fake_qdrant):
    pages = [
        {"page_number": 4, "text": "해고의 예고"},
        {"page_number": 11, "text": "근로시간 40시간"},
    ]
    chunks = create_chunks_from_pages(pages)
    embeddings = [[1.0, 0.0], [0.0, 1.0]]

    indexed = upsert_chunks(
        document_id="doc-1",
        original_filename="law.pdf",
        chunks=chunks,
        embeddings=embeddings
    )
    results = search_similar_chunks(question_embedding=[0.1, 0.9], limit=1)

    assert indexed == 2
    assert results[0]["page_number"] == 11
    assert results[0]["chunk_id"] == "page-11-chunk-0"
    assert results[0]["document_id"] == "doc-1"
    assert results[0]["original_filename"] == "law.pdf"
    assert results[0]["text"] == "근로시간 40시간"
    assert results[0]["score"] == pytest.approx(0.9 / (0.01 + 0.81) ** 0.5)


def test_upsert_rejects_mismatched_chunks_and_embeddings(fake_qdrant):
    chunks = create_chunks_from_pages([{"page_number": 1, "text": "text"}])

    with pytest.raises(ValueError):
        upsert_chunks("doc-1", "law.pdf", chunks, embeddings=[])
