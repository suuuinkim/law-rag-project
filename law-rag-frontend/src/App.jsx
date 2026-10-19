import { useEffect, useRef, useState } from "react";
import {
  askQuestion,
  getVectorCount,
  resetVectorStore,
  uploadAndIndex,
} from "./api/documents.js";
import apiClient from "./api/client.js";
import "./App.css";

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [chunkCount, setChunkCount] = useState(20);
  const [apiStatus, setApiStatus] = useState("checking");
  const [apiStatusText, setApiStatusText] = useState("API 연결 확인 중");

  const [docState, setDocState] = useState("대기");
  const [docName, setDocName] = useState("아직 업로드된 문서가 없습니다.");
  const [pageCount, setPageCount] = useState("—");
  const [totalChunks, setTotalChunks] = useState("—");
  const [indexedChunks, setIndexedChunks] = useState("—");
  const [vectorCount, setVectorCount] = useState("—");

  const [progressVisible, setProgressVisible] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [progressText, setProgressText] = useState("준비 중");

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toasts, setToasts] = useState([]);

  const chatRef = useRef(null);

  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isAsking]);

  const showToast = (message, type = "info") => {
    const id = crypto.randomUUID();

    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        type,
      },
    ]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  };

  const checkHealth = async () => {
    try {
      await apiClient.get("/health");

      setApiStatus("ok");
      setApiStatusText("API 연결됨");
      fetchVectorCount();
    } catch {
      setApiStatus("fail");
      setApiStatusText("API 연결 실패");
    }
  };

  const fetchVectorCount = async () => {
    try {
      const data = await getVectorCount();
      setVectorCount(Number(data.points_count ?? 0).toLocaleString());
    } catch {
      setVectorCount("—");
    }
  };

  const handleFileSelect = (file) => {
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showToast("PDF 파일만 업로드할 수 있습니다.", "error");
      return;
    }

    setSelectedFile(file);
    setDocState("파일 선택됨");
    setDocName(file.name);
  };

  const handleIndex = async () => {
    if (!selectedFile || isIndexing) {
      return;
    }

    setIsIndexing(true);
    setDocState("인덱싱 중");
    setProgressVisible(true);
    setProgressValue(12);
    setProgressText("PDF 업로드 중");

    try {
      setProgressValue(42);
      setProgressText("텍스트 추출 및 임베딩 중");

      setProgressValue(86);
      setProgressText("Qdrant에 벡터 저장 중");

      const data = await uploadAndIndex(selectedFile, chunkCount);

      setPageCount(data.page_count ?? "—");
      setTotalChunks(data.total_chunk_count ?? "—");
      setIndexedChunks(data.indexed_count ?? "—");
      setDocName(data.original_filename ?? selectedFile.name);
      setDocState("검색 준비 완료");

      setProgressValue(100);
      setProgressText("완료");

      await fetchVectorCount();

      setTimeout(() => {
        setProgressVisible(false);
      }, 900);

      showToast(`${data.indexed_count}개 청크가 인덱싱되었습니다.`, "success");
    } catch (error) {
      setDocState("오류");
      setProgressVisible(false);
      showToast(`인덱싱 실패: ${error.message}`, "error");
    } finally {
      setIsIndexing(false);
    }
  };

  const handleReset = async () => {
    const confirmed = window.confirm(
      "벡터 저장소를 초기화하면 인덱싱 데이터가 모두 삭제됩니다. 계속할까요?",
    );

    if (!confirmed) {
      return;
    }

    try {
      await resetVectorStore();

      setVectorCount("0");
      setIndexedChunks("—");
      setDocState("검색 데이터 없음");
      showToast("벡터 저장소를 초기화했습니다.", "info");
    } catch (error) {
      showToast(`초기화 실패: ${error.message}`, "error");
    }
  };

  const handleAsk = async () => {
    const cleanQuestion = question.trim();

    if (!cleanQuestion || isAsking) {
      return;
    }

    setQuestion("");
    setIsAsking(true);

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: cleanQuestion,
      },
    ]);

    try {
      const data = await askQuestion(cleanQuestion, 5);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer,
          citations: data.citations || [],
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `오류가 발생했습니다.\n\n${error.message}\n\n먼저 PDF를 업로드하고 인덱싱했는지 확인해주세요.`,
          citations: [],
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleQuestionKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleAsk();
    }
  };

  const progressFillStyle = {
    width: `${progressValue}%`,
  };

  const rangeStyle = {
    "--fill": `${((chunkCount - 1) / (200 - 1)) * 100}%`,
  };

  return (
    <div className="app">
      <div id="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>

      <header className="brand-header">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
            </svg>
          </div>
          <div className="brand-copy">
            <strong>LawLens</strong>
            <span>법령 문서 검색 도구</span>
          </div>
        </div>

        <div className="api-state">
          <span
            className={`state-dot ${
              apiStatus === "ok" ? "ok" : apiStatus === "fail" ? "fail" : ""
            }`}
          />
          <span>{apiStatusText}</span>
        </div>
      </header>

      <main className="shell">
        <aside className="panel doc-panel">
          <div className="panel-head">
            <div className="eyebrow">Document Panel</div>
            <h1>
              법령 PDF를
              <br />
              업로드 해 주세요.
            </h1>
            <p>
              업로드한 문서를 AI가 검색할 수 있는 형태로 준비합니다.
            </p>
          </div>

          <div className="doc-scroll">
            <section className="card">
              <div className="card-title">
                <h3>문서 업로드</h3>
                <small>PDF only</small>
              </div>

              <div
                className={`upload ${selectedFile ? "has-file" : ""} ${
                  isDragging ? "drag" : ""
                }`}
                id="uploadZone"
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  handleFileSelect(event.dataTransfer.files[0]);
                }}
              >
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(event) => handleFileSelect(event.target.files[0])}
                />
                <div>
                  <div className="upload-icon">
                    <svg viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <div className="upload-main">PDF 파일 선택 또는 드래그</div>
                  <div className="upload-sub">법령, 약관, 규정집 PDF 지원</div>
                  <div className="filename">
                    {selectedFile ? selectedFile.name : "—"}
                  </div>
                </div>
              </div>

              <div className="field">
                <div className="field-row">
                  <label htmlFor="chunkRange">검색 준비 범위</label>
                  <span className="pill">{chunkCount}</span>
                </div>
                <input
                  type="range"
                  id="chunkRange"
                  min="1"
                  max="200"
                  value={chunkCount}
                  style={rangeStyle}
                  onChange={(event) =>
                    setChunkCount(Number(event.target.value))
                  }
                />
              </div>

              <div className={`progress ${progressVisible ? "show" : ""}`}>
                <div className="progress-meta">
                  <span>{progressText}</span>
                  <span>{progressValue}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={progressFillStyle} />
                </div>
              </div>

              <button
                className="primary-btn"
                disabled={!selectedFile || isIndexing}
                onClick={handleIndex}
              >
                검색 준비 시작
              </button>
            </section>

            <section className="card">
              <div className="card-title">
                <h3>문서 상태</h3>
                <small>{docState}</small>
              </div>

              <div className="doc-name">{docName}</div>

              <div className="stats">
                <div className="stat">
                  <span>페이지 수</span>
                  <strong>{pageCount}</strong>
                </div>
                <div className="stat">
                  <span>문서 조각</span>
                  <strong>{totalChunks}</strong>
                </div>
                <div className="stat">
                  <span>저장된 조각</span>
                  <strong>{indexedChunks}</strong>
                </div>
                <div className="stat">
                  <span>검색 데이터</span>
                  <strong>{vectorCount}</strong>
                </div>
              </div>

              <button
                className="ghost-btn"
                style={{ marginTop: 14 }}
                onClick={handleReset}
              >
                검색 데이터 초기화
              </button>
            </section>

            {/* <section className="card">
              <div className="card-title">
                <h3>작동 흐름</h3>
                <small>RAG</small>
              </div>

              <div className="steps">
                <Step number="1" text="PDF에서 글자를 읽습니다." />
                <Step number="2" text="내용을 검색하기 쉽게 나눕니다." />
                <Step
                  number="3"
                  text="질문과 관련 있는 부분을 찾습니다."
                />
                <Step number="4" text="찾은 근거를 바탕으로 답변합니다." />
              </div>
            </section> */}
          </div>
        </aside>

        <section className="panel answer-panel">
          <div className="answer-head">
            <div className="answer-title">
              <div className="eyebrow">Answer & Citations</div>
              <h2>
                궁금한 내용을
                <br />
                물어보세요.
              </h2>
              <p>
                업로드한 법령 문서에서 관련 근거를 찾아 답변과 함께 보여드립니다.
              </p>
            </div>
            <div className="flow-badge">PDF → Vector → Search → Answer</div>
          </div>

          <div className="chat" ref={chatRef}>
            {messages.length === 0 && (
              <div className="welcome">
                <div className="welcome-inner">
                  <div className="welcome-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <h3>
                    문서 안에서 찾고,
                    <br />
                    근거와 함께 답변해요.
                  </h3>
                  <p>
                    법령의 정의, 적용 범위, 휴가, 해고, 근로계약 등 궁금한 내용을 자연어로 물어보세요.
                  </p>
                  <div className="chips">
                    <button
                      className="chip"
                      onClick={() => setQuestion("근로자란 무엇인가요?")}
                    >
                      근로자란 무엇인가요?
                    </button>
                    <button
                      className="chip"
                      onClick={() => setQuestion("사용자란 누구를 말하나요?")}
                    >
                      사용자란 누구인가요?
                    </button>
                    <button
                      className="chip"
                      onClick={() =>
                        setQuestion("근로조건은 어떻게 정해야 하나요?")
                      }
                    >
                      근로조건 기준은?
                    </button>
                    <button
                      className="chip"
                      onClick={() =>
                        setQuestion("연차 유급휴가 규정을 알려주세요")
                      }
                    >
                      연차 유급휴가
                    </button>
                  </div>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}

            {isAsking && (
              <div className="typing show">
                <div className="typing-box">
                  <div className="dot" />
                  <div className="dot" />
                  <div className="dot" />
                </div>
              </div>
            )}
          </div>

          <div className="composer">
            <div className="composer-box">
              <textarea
                rows="1"
                placeholder="법령 문서에 대해 질문하세요. 예: 근로자란 무엇인가요?"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleQuestionKeyDown}
              />
              <button
                className="send"
                aria-label="질문 보내기"
                disabled={isAsking}
                onClick={handleAsk}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M22 2 11 13" />
                  <path d="m22 2-7 20-4-9-9-4 20-7Z" />
                </svg>
              </button>
            </div>
            <div className="hint">
              답변은 업로드된 문서 근거를
              바탕으로 생성됩니다.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Step({ number, text }) {
  return (
    <div className="step">
      <div className="step-num">{number}</div>
      <p>{text}</p>
    </div>
  );
}

function Message({ message }) {
  return (
    <>
      <div className={`msg ${message.role}`}>
        <div className="role">{message.role === "user" ? "나" : "LawLens"}</div>
        <div className="bubble">{message.text}</div>
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="citations">
          <div className="citation-title">
            근거 문서 {message.citations.length}건
          </div>

          {message.citations.map((citation, index) => (
            <article
              className="citation-card"
              key={`${citation.chunk_id}-${index}`}
            >
              <div className="citation-top">
                <div className="citation-page">
                  p.{citation.page_number ?? "?"} ·문서 근거
                </div>
                <div className="citation-score">
                  {citation.score != null
                    ? `${(citation.score * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
              <div className="citation-file">
                {citation.original_filename ?? "문서"}
              </div>
              <div className="citation-preview">
                {citation.text_preview ?? ""}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export default App;
