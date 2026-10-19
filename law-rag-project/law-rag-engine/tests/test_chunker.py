import string
import sys

import pytest

from app.services.chunker import create_chunks_from_pages, split_text_with_overlap


def make_text(length: int) -> str:
    """
    공백 없는 결정적 텍스트. strip()에 영향을 받지 않아 오프셋을 정확히 비교할 수 있습니다.
    """
    alphabet = string.ascii_letters + string.digits
    return "".join(alphabet[i % len(alphabet)] for i in range(length))


def test_text_of_800_chars_is_single_chunk():
    text = make_text(800)

    assert split_text_with_overlap(text, chunk_size=800, overlap=120) == [text]


def test_text_shorter_than_chunk_size_is_single_chunk():
    text = make_text(30)

    assert split_text_with_overlap(text) == [text]


def test_text_of_801_chars_is_split_into_two_chunks_with_overlap():
    text = make_text(801)

    chunks = split_text_with_overlap(text, chunk_size=800, overlap=120)

    assert chunks == [text[0:800], text[680:801]]
    assert len(chunks[1]) == 121


def test_text_of_2000_chars_is_split_into_three_chunks():
    text = make_text(2000)

    chunks = split_text_with_overlap(text, chunk_size=800, overlap=120)

    assert chunks == [text[0:800], text[680:1480], text[1360:2000]]
    assert [len(chunk) for chunk in chunks] == [800, 800, 640]


def test_consecutive_chunks_share_exactly_120_chars():
    text = make_text(2000)

    chunks = split_text_with_overlap(text, chunk_size=800, overlap=120)

    for previous, current in zip(chunks, chunks[1:]):
        assert previous[-120:] == current[:120]


def test_chunks_cover_entire_text_without_gaps():
    text = make_text(2000)

    chunks = split_text_with_overlap(text, chunk_size=800, overlap=120)
    rebuilt = chunks[0] + "".join(chunk[120:] for chunk in chunks[1:])

    assert rebuilt == text


def test_every_chunk_is_at_most_chunk_size():
    text = make_text(5000)

    chunks = split_text_with_overlap(text, chunk_size=800, overlap=120)

    assert all(len(chunk) <= 800 for chunk in chunks)


def test_empty_text_returns_no_chunks():
    assert split_text_with_overlap("") == []


def test_none_text_returns_no_chunks():
    assert split_text_with_overlap(None) == []


@pytest.mark.xfail(
    strict=True,
    reason="발견된 문제: 공백만 있는 입력은 strip() 이후 길이 0이 되지만 빈 문자열 청크 ['']를 반환한다."
)
def test_whitespace_only_text_returns_no_chunks():
    assert split_text_with_overlap("   \n\t ") == []


@pytest.mark.xfail(
    strict=True,
    reason="발견된 문제: 남은 텍스트가 overlap(120자) 이하이면 이전 청크에 완전히 포함된 중복 청크가 추가로 생성된다. "
           "예: 1480자 -> 세 번째 청크 text[1360:1480]은 두 번째 청크 text[680:1480]의 일부."
)
def test_no_chunk_is_fully_contained_in_previous_chunk():
    text = make_text(1480)

    chunks = split_text_with_overlap(text, chunk_size=800, overlap=120)

    for previous, current in zip(chunks, chunks[1:]):
        assert current not in previous


@pytest.mark.xfail(
    strict=True,
    reason="발견된 문제: overlap >= chunk_size이면 start가 증가하지 않아 무한 루프에 빠진다. 입력 검증이 없다."
)
def test_overlap_not_smaller_than_chunk_size_is_rejected():
    # 무한 루프를 안전하게 끊기 위해 줄 실행 횟수를 제한합니다.
    max_line_events = 20_000
    state = {"lines": 0}

    def tracer(frame, event, arg):
        if frame.f_code is split_text_with_overlap.__code__:
            def local_tracer(frame, event, arg):
                if event == "line":
                    state["lines"] += 1
                    if state["lines"] > max_line_events:
                        raise RuntimeError("infinite loop detected")
                return local_tracer
            return local_tracer
        return None

    sys.settrace(tracer)
    try:
        with pytest.raises(ValueError):
            split_text_with_overlap(make_text(1000), chunk_size=100, overlap=100)
    finally:
        sys.settrace(None)


def test_chunks_do_not_cross_page_boundaries():
    page_1 = make_text(1000)
    page_2 = "#" * 300
    pages = [
        {"page_number": 1, "text": page_1},
        {"page_number": 2, "text": page_2},
    ]

    chunks = create_chunks_from_pages(pages, chunk_size=800, overlap=120)

    assert [chunk["page_number"] for chunk in chunks] == [1, 1, 2]
    assert chunks[1]["text"] == page_1[680:1000]
    assert "#" not in chunks[1]["text"]
    assert chunks[2]["text"] == page_2


def test_overlap_is_not_carried_across_page_boundary():
    """
    현재 설계: 페이지가 바뀌면 오버랩이 이어지지 않는다.
    조문이 두 페이지에 걸치면 앞 페이지 끝부분 문맥이 다음 페이지 첫 청크에 없다. (한계로 기록)
    """
    page_1 = make_text(900)
    page_2 = "#" * 500
    pages = [
        {"page_number": 1, "text": page_1},
        {"page_number": 2, "text": page_2},
    ]

    chunks = create_chunks_from_pages(pages, chunk_size=800, overlap=120)
    first_chunk_of_page_2 = next(chunk for chunk in chunks if chunk["page_number"] == 2)

    assert first_chunk_of_page_2["text"] == page_2
    assert page_1[-120:] not in first_chunk_of_page_2["text"]


def test_empty_page_produces_no_chunks_and_keeps_numbering():
    pages = [
        {"page_number": 1, "text": make_text(100)},
        {"page_number": 2, "text": ""},
        {"page_number": 3, "text": make_text(100)},
    ]

    chunks = create_chunks_from_pages(pages)

    assert [chunk["page_number"] for chunk in chunks] == [1, 3]
    assert [chunk["chunk_index"] for chunk in chunks] == [0, 1]
