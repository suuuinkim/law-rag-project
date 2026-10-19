from typing import List, Dict
from google import genai
from app.core.config import settings

def get_gemini_client() -> genai.Client:
    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY가 설정되어 있지 않습니다.")

    return genai.Client(api_key=settings.GEMINI_API_KEY)

def build_rag_prompt(question: str, contexts: List[Dict]) -> str:
    """
    검색된 청크들을 기반으로 Gemini에게 전달할 프롬프트를 생성
    """
    context_texts = []

    for index, context in enumerate(contexts, start=1):
        page_number = context.get("page_number")
        text = context.get("text", "")

        context_texts.append(
            f"[근거 {index}]\n"
            f"페이지: {page_number}\n"
            f"내용:\n{text}\n"
        )

    joined_contexts = "\n---\n".join(context_texts)

    return f"""
당신은 업로드된 법령 PDF 문서를 기반으로 답변하는 RAG assistant입니다.

규칙:
1. 반드시 아래 제공된 근거 내용만 사용해서 답변하세요.
2. 근거에 없는 내용은 추측하지 말고 "제공된 문서 근거만으로는 확인할 수 없습니다."라고 답하세요.
3. 답변에는 관련 페이지 번호를 함께 언급하세요.
4. 법률 자문처럼 단정하지 말고, 문서 기반 설명으로 답변하세요.
5. 답변은 한국어 존댓말로 작성하세요.

사용자 질문:
{question}

문서 근거:
{joined_contexts}

답변 형식:
답변:
...

근거:
- p.페이지번호: 근거 요약
""".strip()


def generate_answer(question: str, contexts: List[Dict]) -> str:
    """
    질문과 검색된 문맥을 바탕으로 Gemini 답변을 생성합니다.
    """
    if not contexts:
        return "관련 문서 근거를 찾지 못했습니다."

    client = get_gemini_client()
    prompt = build_rag_prompt(question, contexts)

    response = client.models.generate_content(
        model=settings.GEMINI_GENERATION_MODEL,
        contents=prompt
    )

    return response.text