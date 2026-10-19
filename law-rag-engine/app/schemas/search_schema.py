from pydantic import BaseModel, Field

class SearchRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        description="검색할 질문"
    )
    limit : int = Field(
        5,
        ge=1,
        le=20,
        description="검색 결과 개수"
    )