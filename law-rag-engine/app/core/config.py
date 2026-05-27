import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self):
        self.GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY")
        self.ADMIN_API_KEY = os.getenv("ADMIN_API_KEY")
        self.GEMINI_EMBEDDING_MODEL  = os.getenv(
            "GEMINI_EMBEDDING_MODEL",
            "gemini-embedding-001"
        )
        self.GEMINI_GENERATION_MODEL = os.getenv(
            "GEMINI_GENERATION_MODEL",
            "gemini-2.0-flash"
        )

        self.QDRANT_URL = os.getenv(
            "QDRANT_URL",
            "http://localhost:6333"
        )

        self.QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
        
        self.QDRANT_COLLECTION_NAME = os.getenv(
            "QDRANT_COLLECTION_NAME",
            "law_documents"
        )

settings = Settings()