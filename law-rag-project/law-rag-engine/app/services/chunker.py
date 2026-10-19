from typing import List, Dict

def split_text_with_overlap(
        text: str,
        chunk_size: int = 800,
        overlap: int = 120
) -> List[str]:
    """
    긴 텍스트를 일정 길이의 청크로 나눕니다.
    overlap은 앞뒤 청크가 일부 내용을 공유하도록 하는 값
    """
    if not text :
        return []
    text = text.strip()

    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start = end - overlap

        if start < 0:
            start = 0

        if start >= len(text):
            break

    return chunks

def create_chunks_from_pages(
        pages: List[Dict],
        chunk_size: int = 800,
        overlap: int = 120
) -> List[Dict]:
    """
    페이지별 텍스트를 RAG 검색용 청크 목록으로 변환합니다.
    페이지 번호를 유지합니다.
    """
    all_chunks = []
    global_chunk_index = 0

    for page in pages:
        page_number = page["page_number"]
        text = page["text"]

        page_chunks = split_text_with_overlap(
            text=text,
            chunk_size=chunk_size,
            overlap=overlap
        )

        for page_chunk_index, chunk_text in enumerate(page_chunks):
            all_chunks.append({
                "chunk_id": f"page-{page_number}-chunk-{page_chunk_index}",
                "chunk_index": global_chunk_index,
                "page_number": page_number,
                "page_chunk_index": page_chunk_index,
                "text": chunk_text,
                "text_length": len(chunk_text)
            })

            global_chunk_index += 1

    return all_chunks