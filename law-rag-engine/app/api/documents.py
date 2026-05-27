from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Header

from app.core.config import settings
from app.schemas.search_schema import SearchRequest
from app.services.chunker import create_chunks_from_pages
from app.services.embedding import create_embeddings
from app.services.pdf_loader import extract_pages_from_pdf
from app.services.vector_store import (
    upsert_chunks
    , get_qdrant_client
    , search_similar_chunks
    , recreate_collection
    , deduplicate_results
    , list_documents
    , delete_document
)
from app.services.llm import generate_answer

router = APIRouter(
    prefix="/documents",
    tags=["documents"]
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    PDF 파일을 업로드하고 페이지별 텍스트를 추출합니다
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="PDF 파일만 업로드할 수 있습니다."
        )

    stored_filename = f"{uuid4()}_{file.filename}"
    file_path = UPLOAD_DIR / stored_filename

    content = await file.read()

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        pages = extract_pages_from_pdf(str(file_path))
        chunks = create_chunks_from_pages(
            pages=pages,
            chunk_size=800,
            overlap=120
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"PDF 텍스트 추출 중 오류가 발생했습니다 : {str(e)}"
        )

    preview_pages = []

    for page in pages[:3]:
        preview_pages.append({
            "page_number": page["page_number"],
            "text_preview": page["text"][:500]
        })

    preview_chunks = []

    for chunk in chunks[:5]:
        preview_chunks.append({
            "chunk_id": chunk["chunk_id"],
            "chunk_index": chunk["chunk_index"],
            "page_number": chunk["page_number"],
            "text_length": chunk["text_length"],
            "text_preview": chunk["text"][:300]
        })

    return {
        "original_filename" : file.filename,
        "stored_filename" : stored_filename,
        "page_count" : len(pages),
        "chunk_count" : len(chunks),
        "preview_pages" : preview_pages,
        "preview_chunks" : preview_chunks
    }

@router.post("/upload/embedding-test")
async def upload_document_embedding_test(file: UploadFile = File(...)):
    """
    PDF 파일을 업로드하고 청크 일부에 대해 임베딩을 생성합니다.
    Qdrant 저장 전 테스트용 API입니다.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="PDF 파일만 업로드할 수 있습니다."
        )

    stored_filename = f"{uuid4()}_{file.filename}"
    file_path = UPLOAD_DIR / stored_filename

    content = await file.read()

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        pages = extract_pages_from_pdf(str(file_path))
        chunks = create_chunks_from_pages(
            pages=pages,
            chunk_size=800,
            overlap=120
        )

        # 비용과 속도 관리를 위해 처음 3개 청크만 임베딩합니다.
        sample_chunks = chunks[:3]
        sample_texts = [
            chunk["text"]
            for chunk in sample_chunks
        ]

        embeddings = create_embeddings(sample_texts)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"임베딩 테스트 중 오류가 발생했습니다: {str(e)}"
        )

    preview_results = []

    for chunk, embedding in zip(sample_chunks, embeddings):
        preview_results.append({
            "chunk_id": chunk["chunk_id"],
            "page_number": chunk["page_number"],
            "text_preview": chunk["text"][:200],
            "embedding_dimension": len(embedding),
            "embedding_preview": embedding[:5]
        })

    return {
        "original_filename": file.filename,
        "page_count": len(pages),
        "chunk_count": len(chunks),
        "embedded_chunk_count": len(embeddings),
        "embedding_model": "gemini-embedding-001",
        "results": preview_results
    }

@router.post("/upload/index")
async def upload_document_and_index(
        file: UploadFile = File(...),
        max_chunks: int = Query(20, ge=1, le=200)
):
    """
    PDF 파일을 업로드하고 청크를 임베딩한 뒤 Qdrant에 저장합니다.
    개발 중에는 max_chunks로 인덱싱 개수를 제한합니다.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="PDF 파일만 업로드할 수 있습니다."
        )

    document_id = str(uuid4())
    stored_filename = f"{document_id}_{file.filename}"
    file_path = UPLOAD_DIR / stored_filename

    content = await file.read()

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        pages = extract_pages_from_pdf(str(file_path))
        chunks = create_chunks_from_pages(
            pages=pages,
            chunk_size=800,
            overlap=120
        )

        total_chunk_count = len(chunks)

        # 개발 중 quota 방지를 위해 일부 청크만 인덱싱
        chunks_to_index = chunks[:max_chunks]

        texts = [
            chunk["text"]
            for chunk in chunks_to_index
        ]

        embeddings = create_embeddings(texts)

        indexed_count = upsert_chunks(
            document_id=document_id,
            original_filename=file.filename,
            chunks=chunks_to_index,
            embeddings=embeddings
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"문서 인덱싱 중 오류가 발생했습니다: {str(e)}"
        )

    return {
        "document_id": document_id,
        "original_filename": file.filename,
        "stored_filename": stored_filename,
        "page_count": len(pages),
        "total_chunk_count": total_chunk_count,
        "requested_max_chunks": max_chunks,
        "indexed_count": indexed_count,
        "collection_name": "law_documents"
    }

@router.get("/vector-store/count")
def get_vector_store_count():
    """
    Qdrant에 저장된 벡터 개수를 확인합니다.
    """
    try:
        client = get_qdrant_client()
        result = client.count(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            exact=True
        )

        return {
            "collection_name": settings.QDRANT_COLLECTION_NAME,
            "points_count": result.count
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Qdrant count 조회 중 오류가 발생했습니다: {str(e)}"
        )

@router.post("/search")
def search_documents(request: SearchRequest):
    """
    사용자 질문을 임베딩한 뒤 Qdrant에서 유사한 청크를 검색
    """

    try:
        question_embedding = create_embeddings([request.question])[0]

        results = search_similar_chunks(
            question_embedding = question_embedding,
            limit=request.limit
        )

        results = deduplicate_results(results)

        return {
            "question": request.question,
            "limit": request.limit,
            "result_count": len(results),
            "results": results
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"문서 검색 중 오류가 발생했습니다: {str(e)}"
        )

@router.delete("/vector-store/reset")
def reset_vector_store(x_admin_api_key: str | None = Header(default=None)):
    if not settings.ADMIN_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="ADMIN_API_KEY is not configured"
        )

    if x_admin_api_key != settings.ADMIN_API_KEY:
        raise HTTPException(
            status_code=403,
            detail="관리자 권한이 필요합니다"
        )
    """
    Qdrant 컬렉션을 삭제하고 다시 생성합니다.
    개발 중 벡터 설정이 꼬였을 때 사용합니다.
    """
    try:
        recreate_collection()

        return {
            "collection_name": settings.QDRANT_COLLECTION_NAME,
            "status": "reset"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Qdrant 컬렉션 초기화 중 오류가 발생했습니다: {str(e)}"
        )


@router.get("")
def get_documents():
    """
    인덱싱된 문서 목록을 반환합니다.
    """
    try:
        documents = list_documents()

        return {
            "document_count": len(documents),
            "documents": documents
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"문서 목록 조회 중 오류가 발생했습니다: {str(e)}"
        )


@router.delete("/{document_id}")
def delete_document_by_id(document_id: str):
    """
    특정 문서의 벡터를 Qdrant에서 삭제합니다.
    """
    try:
        deleted_count = delete_document(document_id)

        if deleted_count == 0:
            raise HTTPException(
                status_code=404,
                detail=f"document_id '{document_id}'에 해당하는 문서를 찾을 수 없습니다."
            )

        return {
            "document_id": document_id,
            "deleted_chunk_count": deleted_count,
            "status": "deleted"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"문서 삭제 중 오류가 발생했습니다: {str(e)}"
        )


@router.post("/ask")
def ask_document(request: SearchRequest):
    """
    사용자 질문에 대해 관련 청크를 검색하고 Gemini로 답변을 생성합니다.
    """
    try:
        # 저장 때와 같은 경로로 질문 임베딩을 생성합니다.
        question_embedding = create_embeddings([request.question])[0]

        retrieved_chunks = search_similar_chunks(
            question_embedding=question_embedding,
            limit=request.limit
        )

        retrieved_chunks = deduplicate_results(retrieved_chunks)

        answer = generate_answer(
            question=request.question,
            contexts=retrieved_chunks
        )

        citations = []

        for chunk in retrieved_chunks:
            citations.append({
                "score": chunk.get("score"),
                "document_id": chunk.get("document_id"),
                "original_filename": chunk.get("original_filename"),
                "chunk_id": chunk.get("chunk_id"),
                "page_number": chunk.get("page_number"),
                "text_preview": chunk.get("text", "")[:300]
            })

        return {
            "question": request.question,
            "answer": answer,
            "citation_count": len(citations),
            "citations": citations
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"문서 답변 생성 중 오류가 발생했습니다: {str(e)}"
        )