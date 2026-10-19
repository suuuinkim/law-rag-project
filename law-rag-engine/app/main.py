from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.documents import router as documents_router

app = FastAPI (
    title = "Law RAG Engine",
    description = "PDF 법령 문서 기반 RAG 검색 API",
    version = "0.1.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "https://law-rag-project.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)
app.include_router(documents_router)

# JAVA
# @GetMapping("/health")
# public Map<String, String> health() {
# return Map.of("status", "healthy")
# }
@app.get("/")
def health_check() :
    return {
        "status" : "ok",
        "service" : "law-rag-engine"
    }

@app.get("/health")
def health() :
    return {
        "status" : "healthy"
    }
