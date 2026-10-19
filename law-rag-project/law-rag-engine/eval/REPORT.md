# LawLens 검색 품질 평가 · 단위 테스트 보고서

작성일 2026-10-19 · 대상 커밋 `15a95eb` · 평가 문서 `근로기준법(법률)(제20520호)(20251023).pdf` (26페이지)

## 0. 요약

| 항목 | 결과 | 상태 |
|---|---|---|
| 평가 데이터셋 | 20문항 (직접 6 · 의미 6 · 복수근거 4 · 답 없음 4), 근거 20개 모두 PDF 원문과 일치 | **실행·검증 완료** |
| pytest | 41개 중 **37 passed, 4 xfailed** (xfail = 발견한 결함을 기록한 테스트) | **실행 완료** |
| Hit Rate@5 (전체 PDF 인덱싱 기준) | — | **미측정** (Gemini API 비용 미승인, 아래 3장 참고) |
| Hit Rate@5 상한 (API 기본값 `max_chunks=20`) | **최대 25% (4/16)**. 근거가 인덱스에 들어가는 질문이 4개뿐 | 정적 분석 완료 (API 호출 없음) |
| 기존 Qdrant 상태 | `law_documents` 10포인트 = 같은 PDF 2벌 × 5청크(1~2페이지) | 읽기 전용 점검 완료 |

> 이 보고서에 검색 품질 수치(Hit Rate, 유사도 점수, 검색 시간)는 없습니다. 측정하지 않았기 때문입니다.
> 측정에 필요한 스크립트와 평가셋은 준비되어 있고, `python -m eval.run_hit_rate` 명령 하나로 실행할 수 있습니다.

---

## 1. 기존 파이프라인 분석

| 구성 | 실제 구현 | 위치 |
|---|---|---|
| PDF 인덱싱 흐름 | 업로드 → `extract_pages_from_pdf` → `create_chunks_from_pages(800, 120)` → `chunks[:max_chunks]` → `create_embeddings` → `upsert_chunks` | `app/api/documents.py:154` |
| 청크 분할 | 페이지 단위 고정 길이 슬라이딩 윈도우. `start = end - overlap`, 청크마다 `strip()`. 청크가 페이지 경계를 넘지 않음 | `app/services/chunker.py:3` |
| 페이지 메타데이터 | `page_number`(1부터), `chunk_id = page-{n}-chunk-{i}`, `chunk_index`(전역), `page_chunk_index`, `text_length`를 Qdrant payload에 저장 | `chunker.py:62`, `vector_store.py:81` |
| Qdrant 검색 | `query_points(query=embedding, limit=limit)`, 코사인, 3072차원, 필터 없음 | `vector_store.py:103` |
| 중복 제거 | `(original_filename, page_number, chunk_id)` 키로 먼저 나온 결과만 유지. **검색 후 적용** | `vector_store.py:245` |
| 임베딩 API | `gemini-embedding-001`, 5개씩 배치, 배치 사이 3초 대기, `task_type` 미지정 | `app/services/embedding.py:33` |
| 인덱싱 청크 수 상한 | `max_chunks` 기본 **20**, 최대 200 (`Query(20, ge=1, le=200)`) | `documents.py:157` |
| 검색 API | `POST /documents/search` (검색만), `POST /documents/ask` (검색 + Gemini 답변). `limit` 1~20, 기본 5 | `documents.py:253`, `:363` |
| 기존 테스트 | 없음 (테스트 파일, pytest 설정, CI 모두 없음) | — |

평가 스크립트는 새 API를 만들지 않고 `/documents/search`와 같은 함수 호출 순서를 그대로 재사용합니다.
`create_embeddings([q])[0] → search_similar_chunks(limit=5) → deduplicate_results`

---

## 2. 평가 데이터셋 — `eval/questions.json`

- 질문마다 `question_id, question, category, expected_document, expected_pages, expected_evidence, answerable`를 저장했습니다. 참고용으로 조문 번호(`article`)도 함께 넣었습니다.
- **원문 검증**: `python -m eval.validate_dataset`로 각 근거 문장이 지정한 페이지 원문에 있는지 공백·줄바꿈을 무시하고 대조했습니다. 근거 20개가 모두 일치(`verified`)했고, 검증 대기(`pending_verification`) 항목은 0개입니다. → `results/dataset_validation.csv`
- 모든 근거 문장이 청크 하나 안에 온전히 들어가 있어서, 청크 경계 때문에 근거가 잘린 경우는 없었습니다.
- **복수 근거 질문(M01~M04)**: 모든 근거 페이지가 상위 5개 안에 있어야 Hit로 봅니다(strict). 일부만 찾은 경우는 `evidence_recall`로 따로 기록합니다.
- **답 없는 질문(U01~U04)**: Hit Rate 계산에서 빼고 응답 거절 평가로 분리했습니다. 최저임금·퇴직금·육아휴직처럼 근로기준법이 다른 법률을 인용만 하는 주제를 골라, 비슷해 보이지만 정답이 없는 어려운 오답 후보(hard negative)가 되도록 구성했습니다.
- **원문 특이사항**: 이 PDF에는 제13조, 제43조의6, 제60조, 제101~116조가 현행 조문과 시행 예정 조문으로 **두 번씩** 들어 있습니다. 그래서 S04(제60조)의 정답은 `14|15`처럼 둘 중 하나만 찾아도 정답으로 처리합니다.

---

## 3. Hit Rate@5

### 3-1. 측정하지 않은 이유
측정하려면 Gemini 임베딩 API 호출이 필요합니다(`--dry-run`으로 계산한 결과 `embed_content` 요청 **38회** = 청크 88개 ÷ 5개씩 배치 18회 + 질문 20회). 비용이 발생하는 호출은 승인받지 않았기 때문에 실행하지 않았습니다.

### 3-2. API 호출 없이 확인한 사실
- **기본 인덱싱 설정에서는 검색 대상이 1~6페이지뿐입니다.** PDF 전체는 88청크인데 `max_chunks=20`이면 앞의 20청크(6페이지까지)만 저장됩니다. 답할 수 있는 질문 16개 중 근거가 모두 인덱스에 들어가는 질문은 D02, D04, S06, M03 **4개**뿐이므로, 기본 설정의 Hit Rate@5는 **최대 25%** 입니다.
- 로컬 Qdrant `law_documents`에는 같은 PDF가 document_id 2개로 들어가 있습니다(각 5청크, 2페이지까지). 그래서 이 컬렉션은 평가에 쓸 수 없습니다. `uploads/`에도 MD5가 같은 근로기준법 PDF가 25개 쌓여 있습니다.

### 3-3. 측정 방법 (실행 준비 완료)
```bash
cd law-rag-engine
docker compose up -d                      # Qdrant (localhost:6333)
python -m venv .venv-eval && .venv-eval/Scripts/pip install -r requirements-dev.txt
python -m eval.run_hit_rate --dry-run     # API 호출 없이 예상 요청 수만 확인
python -m eval.run_hit_rate               # law_documents_eval 컬렉션에 전체 88청크 인덱싱 후 평가
python -m eval.run_hit_rate --collection law_documents --search-only   # 기존 컬렉션 읽기 전용 평가(선택)
```
- 결과 파일: `results/hit_rate_<collection>.csv`(질문별 정답·검색 페이지·점수·Hit·검색 시간), `results/hit_rate_<collection>_summary.json`(전체·유형별 Hit Rate@5, 평균·p95 검색 시간, 응답 거절 지표)
- 안전장치
  - `.env`의 운영 컬렉션에는 인덱싱하지 않습니다.
  - 평가 컬렉션에 같은 PDF가 이미 완전히 들어 있으면 재인덱싱하지 않습니다.
  - 부분 인덱싱이나 중복 상태면 평가를 중단합니다.
  - 평가 컬렉션 초기화는 실행 중에 `y` 입력을 받아야만 진행합니다.
- 비용 관리: 임베딩을 `eval/cache/`에 캐시합니다. 재실행할 때는 API를 다시 호출하지 않고, 이 경우 `live_query_embeddings`가 0으로 기록됩니다.
- 응답 거절 평가: 현재 검색 단계에는 점수 임계값이 없어서, 답 없는 질문에도 항상 5개를 반환합니다. 그래서 답 있는 질문의 top-1 최소 점수와 답 없는 질문의 top-1 최대 점수를 비교해 임계값으로 분리할 수 있는지(`separable_by_top1_threshold`)를 기록합니다. `/ask`의 LLM 답변을 이용한 거절 판정은 생성 API 비용 때문에 구현 범위에서 뺐습니다.
- 평가 스크립트 자체의 정확성은 `tests/test_eval_pipeline.py`로 검증했습니다. 가짜 임베딩과 인메모리 Qdrant로 전체 흐름(88청크 인덱싱, 20문항 CSV 생성, 재실행 시 중복 방지·캐시 재사용, 운영 컬렉션 보호)을 확인했습니다. 이 테스트의 Hit 값은 품질 지표가 아닙니다.

---

## 4. pytest 결과 — `results/pytest_output.txt`

```
37 passed, 4 xfailed in 1.50s   (Python 3.12.10, Windows 11, pytest 9.1.1)
```

| 파일 | 대상 | 결과 |
|---|---|---|
| `test_chunker.py` | 800자 이하, 801자, 2,000자, 빈 입력, 120자 오버랩, 페이지 경계, 빈 페이지 | 12 passed · 3 xfailed |
| `test_metadata.py` | page_number 1부터 순차 생성(실제 PDF 생성), chunk_id·인덱스, 근로기준법 88청크가 모두 원본 페이지 텍스트의 일부인지, Qdrant 저장·검색 왕복 시 페이지 연결 유지 | 6 passed |
| `test_deduplication.py` | 동일 근거 제거, 같은 페이지의 다른 청크 유지, 다른 문서 구분, 점수가 다른 중복, `/search` 엔드포인트 결과 수 | 8 passed · 1 xfailed |
| `test_eval_metrics.py` | Hit, 복수 근거, 대체 페이지, 답 없는 질문 제외, p95 계산 | 9 passed |
| `test_eval_pipeline.py` | 평가 스크립트 전체 흐름, 운영 컬렉션 보호 | 2 passed |

- Qdrant는 `FakeQdrantClient`(conftest)와 qdrant-client 인메모리 모드로, Gemini는 monkeypatch로 대체했습니다. 테스트 중 외부 호출은 없습니다.
- 기존 동작과 기대 동작이 다른 4건은 테스트를 억지로 통과시키지 않고, `xfail(strict=True)`로 결함을 기록했습니다. 코드를 고쳐서 이 테스트들이 통과하게 되면 XPASS로 실패가 나므로, 그때 xfail 표시를 제거하면 됩니다.

---

## 5. 발견한 문제 (영향이 큰 순서)

| # | 문제 | 근거 | 영향 |
|---|---|---|---|
| 1 | **기본 `max_chunks=20`이면 1~6페이지만 인덱싱됨** | `documents.py:157`, `dataset_validation_summary.json` | 16문항 중 12문항은 구조적으로 검색할 수 없음 (상한 25%) |
| 2 | **중복 제거를 검색 후에 해서 결과 수가 limit보다 적어짐** | `documents.py:262-267`, xfail 테스트 | 같은 PDF가 N번 인덱싱되어 있으면 top-5가 1~2개로 줄어듦. 로컬 DB에 실제로 2벌이 들어 있음 |
| 3 | **같은 PDF를 업로드할 때 중복을 확인하지 않음** | `uploads/` 동일 MD5 25개, Qdrant 2벌 | #2의 원인. 저장 공간과 임베딩 비용 낭비 |
| 4 | **중복 청크 생성** (남은 텍스트가 overlap 이하일 때) | xfail 테스트, 실제 PDF에서 88개 중 **6개**(마침표 1글자짜리 청크 포함) | 임베딩 비용 낭비, 검색 결과 자리 차지 |
| 5 | `overlap >= chunk_size`이면 무한 루프 | xfail 테스트 | 현재 호출부는 고정값(800/120)이라 바로 문제 되지는 않음. 입력 검증 필요 |
| 6 | 공백만 있는 입력에 `['']` 반환 | xfail 테스트 | `pdf_loader`가 `strip()`하므로 현재 경로에서는 발생하지 않음 |
| 7 | 중복 제거 키에 `document_id`가 없음 | 동작 고정(characterization) 테스트 | 같은 파일명의 다른 버전 PDF 결과가 하나로 합쳐짐 |
| 8 | 페이지 경계에서 오버랩이 끊김 | 동작 고정 테스트 | 두 페이지에 걸친 조문(예: 제24조 p.3→4)은 문맥이 분리됨 |
| 9 | 시행 예정 조문이 현행 조문과 함께 인덱싱됨 | PDF 원문 | 시행일 메타데이터가 없어 아직 효력이 없는 조문을 인용할 수 있음 |

참고(평가 범위 밖)
- `DELETE /documents/{id}`에는 관리자 키 검사가 없습니다(`reset`에는 있음).
- `Dockerfile`은 `ubuntu` + `top -b` 상태로 비어 있습니다.
- 임베딩 호출에 `task_type`(문서용/질의용)을 지정하지 않습니다.

---

## 6. 실행 조건과 제한 사항

- 환경: Windows 11, Python 3.12.10(`.venv-eval`, 기존 `.venv`는 다른 PC 경로를 가리켜 동작하지 않음), Qdrant 1.19.2(Docker, `localhost:6333`), qdrant-client 1.19.1, PyMuPDF 1.28.2
- 점검 전에 `qdrant_storage/`(401MB)를 백업했고, 실제 Qdrant에는 쓰기·삭제를 하지 않았습니다(`law_documents` 10포인트 유지, 평가 컬렉션 미생성).
- 평가셋은 근로기준법 PDF 1개, 20문항입니다. 문항 수가 적어서 1문항이 Hit Rate에 미치는 영향이 6.25%p입니다. 질문은 평가자 1명이 작성했습니다.
- 정답 단위는 페이지입니다. 같은 페이지의 다른 조문을 가져와도 Hit로 처리되므로 실제 품질보다 높게 나올 수 있습니다. `first_hit_rank`와 `retrieved` 열의 chunk_id로 보완해서 확인해야 합니다.
- 검색 시간에는 Gemini 임베딩 API의 네트워크 지연이 포함됩니다. 캐시된 질문은 API 지연이 빠지므로 `live_*` 지표를 따로 보아야 합니다.

---

## 7. 포트폴리오 마지막 페이지 카피

**현재 사실만으로 쓴 버전 (지금 사용 가능)**

> **검증**
> 근로기준법 기반 검색 평가셋 20문항 구축 · 근거 20/20 원문 대조 완료
> pytest 41건 작성 — 37 passed · 결함 4건은 xfail로 기록
> 기본 인덱싱 상한(20청크) 탓에 검색 가능 범위가 26쪽 중 6쪽 → 정답 도달 상한 25%
> 검색 후 중복 제거로 top-5가 줄어드는 문제, 중복 청크 6/88 확인
> **다음 단계** 전체 인덱싱 Hit Rate@5 측정 · 검색 전 중복 제거 · 업로드 해시 중복 방지

**Hit Rate 측정 후 바꿀 첫 줄 (실측값으로 채우기)**

> Hit Rate@5 **{XX}%** ({h}/16, 답 있는 질문 기준) · 유형별 직접 {a}% / 의미 {b}% / 복수근거 {c}%
