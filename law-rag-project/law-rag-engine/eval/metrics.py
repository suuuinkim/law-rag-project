"""
평가 스크립트에서 공통으로 사용하는 순수 함수 모음.
외부 API나 Qdrant에 의존하지 않으므로 단위 테스트로 검증합니다.
"""
import json
import math
import re
from pathlib import Path
from typing import Dict, List, Optional, Set


def normalize(text: str) -> str:
    """
    PDF 줄바꿈과 공백 차이를 무시하고 비교하기 위해 모든 공백 문자를 제거합니다.
    """
    return re.sub(r"\s+", "", text or "")


def parse_page_group(value: str) -> Set[int]:
    """
    '14|15' 형태의 페이지 표기를 {14, 15}로 변환합니다.
    같은 근거가 여러 페이지에 있을 때 그중 하나만 찾아도 되는 그룹을 의미합니다.
    """
    return {int(page) for page in str(value).split("|") if page.strip()}


def load_questions(path: str) -> List[Dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["questions"]


def evaluate_retrieval(
        expected_document: str,
        expected_pages: List[str],
        retrieved: List[Dict]
) -> Dict:
    """
    상위 k개 검색 결과에 정답 문서·페이지가 포함되었는지 평가합니다.

    - 근거 그룹이 1개면 그 그룹의 페이지가 하나라도 검색되면 hit
    - 근거 그룹이 여러 개면 모든 그룹이 검색되어야 hit (strict)
    - evidence_recall: 찾은 근거 그룹 수 / 전체 근거 그룹 수
    - first_hit_rank: 정답 페이지가 처음 등장한 순위 (1부터, 없으면 None)
    """
    groups = [parse_page_group(value) for value in expected_pages]

    if not groups:
        return {"hit": None, "evidence_recall": None, "first_hit_rank": None}

    found_groups = set()
    first_hit_rank: Optional[int] = None

    for rank, result in enumerate(retrieved, start=1):
        if result.get("original_filename") != expected_document:
            continue

        page = result.get("page_number")

        for group_index, group in enumerate(groups):
            if page in group:
                found_groups.add(group_index)
                if first_hit_rank is None:
                    first_hit_rank = rank

    return {
        "hit": len(found_groups) == len(groups),
        "evidence_recall": len(found_groups) / len(groups),
        "first_hit_rank": first_hit_rank,
    }


def hit_rate(rows: List[Dict]) -> Optional[float]:
    hits = [row["hit"] for row in rows if row.get("hit") is not None]
    if not hits:
        return None
    return sum(1 for hit in hits if hit) / len(hits)


def percentile(values: List[float], p: float) -> Optional[float]:
    """
    선형 보간 백분위수 (numpy.percentile 기본 방식과 동일).
    p는 0~100 범위입니다.
    """
    if not values:
        return None

    ordered = sorted(values)

    if len(ordered) == 1:
        return ordered[0]

    k = (len(ordered) - 1) * (p / 100)
    lower = math.floor(k)
    upper = math.ceil(k)

    if lower == upper:
        return ordered[int(k)]

    return ordered[lower] + (ordered[upper] - ordered[lower]) * (k - lower)
