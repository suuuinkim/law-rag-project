import apiClient from "./client.js";

// PDF upload + indexing
export async function uploadAndIndex(file, maxChunks = 20) {
    const form = new FormData();
    form.append("file", file);

    const res = await apiClient.post(
        `/documents/upload/index?max_chunks=${maxChunks}`,
        form,
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

// Stored vector count
export async function getVectorCount() {
    const res = await apiClient.get("/documents/vector-store/count");
    return res.data;
}

export async function resetVectorStore() {
    const res = await apiClient.delete("/documents/vector-store/reset");
    return res.data;
}
