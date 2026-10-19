"""
평가 스크립트의 채점 로직 검증. (검색 품질 측정이 아니라 측정 도구의 정확성 확인)
"""
import pytest

from eval.metrics import evaluate_retrieval, hit_rate, normalize, parse_page_group, percentile

DOC = "law.pdf"


def retrieved(*pages, filename=DOC):
    return [{"original_filename": filename, "page_number": page} for page in pages]


def test_normalize_removes_line_breaks_and_spaces():
    assert normalize("그 기간\n은 1년을  초과") == "그기간은1년을초과"


def test_parse_page_group():
    assert parse_page_group("14|15") == {14, 15}
    assert parse_page_group("4") == {4}


def test_single_evidence_hit_and_rank():
    outcome = evaluate_retrieval(DOC, ["11"], retrieved(3, 11, 11))

    assert outcome == {"hit": True, "evidence_recall": 1.0, "first_hit_rank": 2}


def test_single_evidence_miss():
    outcome = evaluate_retrieval(DOC, ["11"], retrieved(3, 4, 5, 6, 7))

    assert outcome == {"hit": False, "evidence_recall": 0.0, "first_hit_rank": None}


def test_alternative_pages_count_as_one_evidence():
    assert evaluate_retrieval(DOC, ["14|15"], retrieved(15))["hit"] is True


def test_multi_evidence_requires_all_groups():
    partial = evaluate_retrieval(DOC, ["12", "13"], retrieved(12, 1, 2))
    full = evaluate_retrieval(DOC, ["12", "13"], retrieved(13, 12))

    assert partial["hit"] is False
    assert partial["evidence_recall"] == 0.5
    assert full["hit"] is True


def test_other_document_with_same_page_is_not_a_hit():
    assert evaluate_retrieval(DOC, ["11"], retrieved(11, filename="other.pdf"))["hit"] is False


def test_unanswerable_question_is_excluded():
    rows = [
        {"hit": True},
        {"hit": False},
        evaluate_retrieval(DOC, [], retrieved(1)),
    ]

    assert rows[2]["hit"] is None
    assert hit_rate(rows) == 0.5


def test_percentile_matches_linear_interpolation():
    values = list(range(1, 21))

    assert percentile(values, 95) == pytest.approx(19.05)
    assert percentile([5.0], 95) == 5.0
    assert percentile([], 95) is None
