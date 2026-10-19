# Law RAG Project

법령 PDF를 업로드하면 내용을 벡터로 인덱싱하고, 자연어 질문에 문서 근거 기반으로 답변하는 RAG 시스템입니다.
<img width="1861" height="1198" alt="image" src="https://github.com/user-attachments/assets/0caea548-d159-4c84-867a-38be19f7c2a3" />


## 프로젝트 구조

```
law-rag-project/
├── law-rag-engine/     # FastAPI 백엔드
└── law-rag-frontend/   # React + Vite 프론트엔드
```

## 기술 스택

| 구분 | 기술 |
|------|------|
| 백엔드 | FastAPI, PyMuPDF |
| 임베딩 | Google Gemini (`gemini-embedding-001`, 3072차원) |
| 답변 생성 | Google Gemini (`gemini-2.0-flash`) |
| 벡터 DB | Qdrant (Docker) |
| 프론트엔드 | React 19, Vite |

## 동작 흐름

```
[인덱싱]
PDF 업로드 → 페이지별 텍스트 추출 → 청크 분할 (800자 / overlap 120자)
→ Gemini 임베딩 → Qdrant 저장

[질의응답]
질문 입력 → 질문 임베딩 → Qdrant 유사도 검색 → 중복 제거 → Gemini 답변 생성
```

## 시작하기

### 사전 요구사항

- Python 3.10+
- Node.js 18+
- Docker

### 1. Qdrant 실행

```bash
cd law-rag-engine
docker-compose up -d
```

### 2. 백엔드 실행

```bash
cd law-rag-engine
pip install -r requirements.txt
```

`law-rag-engine/.env` 파일을 생성합니다:

```env
GEMINI_API_KEY=your_gemini_api_key

# 아래는 기본값이 있으며 필요 시 변경
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_GENERATION_MODEL=gemini-2.0-flash
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION_NAME=law_documents
```

```bash
uvicorn app.main:app --reload
```

API 문서: `http://localhost:8000/docs`

### 3. 프론트엔드 실행

```bash
cd law-rag-frontend
npm install
npm run dev
```

## 주요 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/documents/upload/index` | PDF 업로드 → 임베딩 → Qdrant 인덱싱 |
| POST | `/documents/ask` | 질문 입력 → RAG 답변 생성 |
| POST | `/documents/search` | 유사 청크 검색 |
| GET | `/documents/vector-store/count` | 저장된 벡터 수 조회 |
| DELETE | `/documents/vector-store/reset` | 컬렉션 초기화 |
