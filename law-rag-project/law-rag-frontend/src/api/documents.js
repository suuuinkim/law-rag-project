import apiClient from "./client.js";

// Indexing runs synchronously on the server (extract → chunk → embed → store),
// so it can easily outlive the client's default 30s timeout.
const INDEX_TIMEOUT_MS = 5 * 60 * 1000;

// PDF upload + indexing
export async function uploadAndIndex(file, maxChunks = 20, options = {}) {
    const { onUploadProgress, signal } = options;
    const form = new FormData();
    form.append("file", file);

    const res = await apiClient.post(
        `/documents/upload/index?max_chunks=${maxChunks}`,
        form,
        {
            timeout: INDEX_TIMEOUT_MS,
            onUploadProgress,
            signal,
        },
    );

    return res.data;
}

// Question + RAG answer
export async function askQuestion(question, limit = 5) {
    const res = await apiClient.post("/documents/ask", {
        question,
        limit,
    });

    return res.data;
}

// Similar chunk search
export async function searchDocuments(question, limit = 5) {
    const res = await apiClient.post("/documents/search", {
        question,
        limit,
    });

    return res.data;
}

// Indexed document list (aggregated from Qdrant payloads)
export async function listDocuments() {
    const res = await apiClient.get("/documents");
    return res.data;
}

// Remove every vector belonging to one document
export async function deleteDocument(documentId) {
    const res = await apiClient.delete(
        `/documents/${encodeURIComponent(documentId)}`,
    );
    return res.data;
}

// Stored vector count
export async function getVectorCount() {
    const res = await apiClient.get("/documents/vector-store/count");
    return res.data;
}

// The backend requires the X-Admin-API-Key header for this endpoint.
export async function resetVectorStore(adminKey) {
    const res = await apiClient.delete("/documents/vector-store/reset", {
        headers: adminKey ? { "X-Admin-API-Key": adminKey } : undefined,
    });
    return res.data;
}
