from pathlib import Path

import fitz # PyMuPDF

def extract_pages_from_pdf(file_path: str) -> list[dict] :
    """
    PDF 파일에서 페이지별 텍스트를 추출합니다
    """
    pdf_path = Path(file_path)

    if not pdf_path.exists() :
        raise FileNotFoundError(f"PDF 파일을 찾을 수 없습니다 : {file_path}")

    pages = []

    with fitz.open(pdf_path) as doc :
        for page_index, page in enumerate(doc):
            text = page.get_text()

            pages.append({
                "page_number" : page_index + 1,
                "text" : text.strip()
            })

    return pages