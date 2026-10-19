import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  BookOpenText,
  FileText,
  PanelRightOpen,
  Quote,
  RotateCcw,
  Sparkles,
  SquarePen,
  Upload,
} from "lucide-react";
import AnswerText from "./AnswerText.jsx";
import { IconButton, Spinner, TechnicalDetail } from "./ui.jsx";

const EXAMPLES = [
  "근로자란 무엇인가요?",
  "사용자란 누구를 말하나요?",
  "근로조건은 어떻게 정해야 하나요?",
  "연차 유급휴가 규정을 알려주세요",
];

export default function ResearchPanel({
  messages,
  isAsking,
  onAsk,
  onRetry,
  onClear,
  activeCitation,
  onCitationClick,
  docCount,
  apiStatus,
  onUploadClick,
  viewerAvailable,
  onOpenViewer,
  onComposerFocusChange,
}) {
  const [question, setQuestion] = useState("");
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, isAsking]);

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [question]);

  const submit = () => {
    const clean = question.trim();
    if (!clean || isAsking) {
      return;
    }
    setQuestion("");
    onAsk(clean);
  };

  const pickExample = (text) => {
    setQuestion(text);
    inputRef.current?.focus();
  };

  return (
    <section className="panel research" aria-label="AI 리서치">
      <header className="research-head">
        <h1 className="research-title">AI 리서치</h1>
        <div className="research-actions">
          {viewerAvailable && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenViewer}>
              <PanelRightOpen size={15} aria-hidden="true" />
              원문 보기
            </button>
          )}
          {messages.length > 0 && (
            <IconButton label="새 대화" onClick={onClear} disabled={isAsking}>
              <SquarePen size={16} />
            </IconButton>
          )}
        </div>
      </header>

      <div className="thread" ref={threadRef}>
        <div className="thread-inner">
          {messages.length === 0 && (
            <EmptyThread
              hasDocuments={docCount > 0}
              onUploadClick={onUploadClick}
              onExample={pickExample}
            />
          )}

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="turn-user">
                <p>{message.text}</p>
              </div>
            ) : (
              <AssistantTurn
                key={message.id}
                message={message}
                activeIndex={
                  activeCitation?.messageId === message.id ? activeCitation.index : null
                }
                onCitationClick={(index) => onCitationClick(message, index)}
                onRetry={() => onRetry(message)}
                retryDisabled={isAsking}
              />
            ),
          )}

          {isAsking && <PendingTurn />}
        </div>
      </div>

      <div className="composer">
        <div className={`composer-box ${isAsking ? "is-busy" : ""}`}>
          <textarea
            ref={inputRef}
            rows={1}
            value={question}
            placeholder="법령 문서에 대해 질문하세요"
            aria-label="질문 입력"
            onChange={(event) => setQuestion(event.target.value)}
            onFocus={() => onComposerFocusChange?.(true)}
            onBlur={() => onComposerFocusChange?.(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className="send-btn"
            aria-label="질문 보내기"
            // Keep focus in the textarea: blurring it would re-show the mobile
            // tab bar and shift the button out from under the tap.
            onMouseDown={(event) => event.preventDefault()}
            onClick={submit}
            disabled={isAsking || !question.trim()}
          >
            {isAsking ? <Spinner size={14} /> : <ArrowUp size={17} strokeWidth={2.2} />}
          </button>
        </div>
        <p className="composer-hint">
          {apiStatus === "fail" ? (
            <span className="text-error">서버에 연결되지 않아 지금은 질문할 수 없습니다.</span>
          ) : (
<>AI 답변은 법률 자문이 아닙니다. 근거 원문을 함께 확인하세요.</>
          )}
        </p>
      </div>
    </section>
  );
}

function EmptyThread({ hasDocuments, onUploadClick, onExample }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpenText size={20} aria-hidden="true" />
      </div>
      {hasDocuments ? (
        <>
          <h2>무엇이든 질문해 보세요</h2>
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="example"
                onClick={() => onExample(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2>PDF를 올리고 질문해 보세요</h2>
          <button type="button" className="btn btn-primary" onClick={onUploadClick}>
            <Upload size={15} aria-hidden="true" />
            PDF 업로드
          </button>
        </>
      )}
    </div>
  );
}

function PendingTurn() {
  return (
    <div className="turn-ai" aria-live="polite" aria-busy="true">
      <div className="turn-label">
        <Sparkles size={14} aria-hidden="true" />
        AI 답변
      </div>
      <p className="pending-text">
        <Spinner size={12} /> 답변 작성 중…
      </p>
      <div className="skeleton">
        <span style={{ width: "92%" }} />
        <span style={{ width: "84%" }} />
        <span style={{ width: "61%" }} />
      </div>
    </div>
  );
}

function AssistantTurn({
  message,
  activeIndex,
  onCitationClick,
  onRetry,
  retryDisabled,
}) {
  if (message.status === "error") {
    return (
      <div className="turn-ai">
        <div className="error-card" role="alert">
          <div className="error-title">
            <AlertCircle size={16} aria-hidden="true" />
            {message.error.title}
          </div>
          {message.error.detail && <p>{message.error.detail}</p>}
          <TechnicalDetail text={message.error.technical} />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRetry}
            disabled={retryDisabled}
          >
            <RotateCcw size={13} aria-hidden="true" />
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  const citations = message.citations ?? [];
  const pageToIndex = new Map();
  citations.forEach((citation, index) => {
    if (citation.page_number != null && !pageToIndex.has(citation.page_number)) {
      pageToIndex.set(citation.page_number, index);
    }
  });

  return (
    <div className="turn-ai">
      <div className="turn-label">
        <Sparkles size={14} aria-hidden="true" />
        AI 답변
      </div>

      <AnswerText
        text={message.text}
        hasPage={(page) => pageToIndex.has(page)}
        onPageRef={(page) => onCitationClick(pageToIndex.get(page))}
      />

      {citations.length > 0 && (
        <section className="evidence" aria-label="근거">
          <h3 className="evidence-head">
            <Quote size={13} aria-hidden="true" />
            근거
            <span className="count">{citations.length}</span>
          </h3>
          <ol className="evidence-list">
            {citations.map((citation, index) => (
              <li key={`${citation.document_id}-${citation.chunk_id}-${index}`}>
                <CitationCard
                  index={index}
                  citation={citation}
                  active={activeIndex === index}
                  onClick={() => onCitationClick(index)}
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function CitationCard({ index, citation, active, onClick }) {
  return (
    <button
      type="button"
      className={`citation ${active ? "is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      title="원문에서 보기"
    >
      <span className="citation-top">
        <span className="citation-index">{index + 1}</span>
        <span className="citation-file" title={citation.original_filename ?? ""}>
          <FileText size={13} aria-hidden="true" />
          {citation.original_filename ?? "문서"}
        </span>
        <span className="citation-page">p.{citation.page_number ?? "?"}</span>
      </span>
      <span className="citation-quote">{citation.text_preview}</span>
    </button>
  );
}
