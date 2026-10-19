import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  FileText,
  FileWarning,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { approxCoverage, formatBytes } from "../lib/format.js";
import { IconButton, Spinner, TechnicalDetail } from "./ui.jsx";

const API_LABEL = {
  checking: "연결 확인 중",
  ok: "서버 연결됨",
  fail: "서버에 연결할 수 없음",
};

export function BrandMark({ size = 28 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <Scale size={size * 0.56} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

export default function Sidebar({
  variant,
  apiStatus,
  onRetryHealth,
  documents,
  docsLoading,
  docsError,
  activeDocId,
  onSelectDocument,
  onDeleteDocument,
  onRefreshDocuments,
  uploadJob,
  onPickFile,
  onStartIndex,
  onCancelJob,
  onDismissJob,
  settings,
  onSettingsChange,
  onResetRequest,
  onCollapse,
  onExpand,
  onClose,
}) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => fileRef.current?.click();
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".pdf,application/pdf"
      hidden
      onChange={(event) => {
        onPickFile(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );

  const busy = Boolean(uploadJob && uploadJob.stage !== "error");

  if (variant === "rail") {
    return (
      <nav className="rail" aria-label="문서">
        {fileInput}
        <BrandMark />
        <IconButton label="문서 패널 열기" onClick={onExpand}>
          <PanelLeftOpen size={18} />
        </IconButton>
        <IconButton
          label="PDF 업로드"
          className="rail-upload"
          onClick={openPicker}
          disabled={busy}
        >
          <Plus size={18} />
        </IconButton>
        <div className="rail-docs">
          {documents.slice(0, 8).map((doc) => (
            <IconButton
              key={doc.id}
              label={doc.name}
              className={doc.id === activeDocId ? "is-active" : ""}
              onClick={() => onSelectDocument(doc.id)}
            >
              <FileText size={17} />
            </IconButton>
          ))}
        </div>
        <span
          className={`status-dot status-${apiStatus} rail-status`}
          title={API_LABEL[apiStatus]}
          role="img"
          aria-label={API_LABEL[apiStatus]}
        />
      </nav>
    );
  }

  return (
    <aside
      className={`sidebar ${dragging ? "is-dragging" : ""}`}
      aria-label="문서"
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy) {
          onPickFile(event.dataTransfer.files?.[0]);
        }
      }}
    >
      {fileInput}

      <header className="sidebar-head">
        <div className="brand">
          <BrandMark />
          <strong className="brand-name">LawLens</strong>
        </div>
        {onCollapse && (
          <IconButton label="문서 패널 접기" onClick={onCollapse}>
            <PanelLeftClose size={18} />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="문서 패널 닫기" onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
      </header>

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={openPicker}
        disabled={busy}
      >
        <Upload size={16} aria-hidden="true" />
        PDF 업로드
      </button>

      {uploadJob && (
        <UploadJobCard
          job={uploadJob}
          onStart={onStartIndex}
          onCancel={onCancelJob}
          onDismiss={onDismissJob}
        />
      )}

      <section className="doc-section" aria-labelledby="doc-heading">
        <div className="section-head">
          <h2 id="doc-heading">
            문서 <span className="count">{documents.length}</span>
          </h2>
          <IconButton
            label="문서 목록 새로고침"
            onClick={onRefreshDocuments}
            disabled={docsLoading}
          >
            <RefreshCw size={14} className={docsLoading ? "spin" : ""} />
          </IconButton>
        </div>

        {docsError && (
          <div className="inline-alert" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span>{docsError}</span>
          </div>
        )}

        <ul className="doc-list">
          {documents.map((doc) => (
            <DocumentItem
              key={doc.id}
              doc={doc}
              active={doc.id === activeDocId}
              onSelect={() => onSelectDocument(doc.id)}
              onDelete={() => onDeleteDocument(doc)}
            />
          ))}
        </ul>

        {!docsLoading && documents.length === 0 && !docsError && (
          <p className="doc-empty">아직 문서가 없습니다</p>
        )}
      </section>

      <SettingsPanel
        settings={settings}
        onChange={onSettingsChange}
        onResetRequest={onResetRequest}
      />

      {apiStatus !== "ok" && (
        <footer className="sidebar-foot">
          <button
            type="button"
            className="status-chip"
            onClick={onRetryHealth}
            title="다시 연결"
          >
            <span className={`status-dot status-${apiStatus}`} aria-hidden="true" />
            {API_LABEL[apiStatus]}
          </button>
        </footer>
      )}
    </aside>
  );
}

function DocumentItem({ doc, active, onSelect, onDelete }) {
  const pages = doc.totalPages ?? doc.pageCount;
  const partial =
    doc.totalChunks && doc.chunkCount != null && doc.chunkCount < doc.totalChunks
      ? Math.max(1, Math.round((doc.chunkCount / doc.totalChunks) * 100))
      : null;

  const meta = [];
  if (pages) {
    meta.push(`${pages}쪽`);
  }
  if (partial) {
    meta.push(`앞부분 ${partial}%만 검색`);
  }
  if (!doc.hasPdf) {
    meta.push("원본 없음");
  }

  return (
    <li className={`doc-item ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className="doc-main"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
      >
        {doc.hasPdf ? (
          <FileText size={16} className="doc-icon" aria-hidden="true" />
        ) : (
          <FileWarning size={16} className="doc-icon is-missing" aria-hidden="true" />
        )}
        <span className="doc-text">
          <span className="doc-name" title={doc.name}>
            {doc.name}
          </span>
          <span className="doc-meta">
            {meta.join(" · ")}
            {doc.onServer === false && (
              <span className="doc-flag is-error">
                {meta.length ? " · " : ""}검색 불가
              </span>
            )}
          </span>
        </span>
      </button>
      <IconButton
        label={`${doc.name} 삭제`}
        className="doc-delete"
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </IconButton>
    </li>
  );
}

function UploadJobCard({ job, onStart, onCancel, onDismiss }) {
  const elapsed = useElapsed(job.stage === "processing" ? job.processingSince : null);

  return (
    <div className={`job-card job-${job.stage}`} aria-live="polite">
      <div className="job-file">
        <FileText size={16} aria-hidden="true" />
        <div className="job-file-text">
          <strong title={job.file.name}>{job.file.name}</strong>
          <span>{formatBytes(job.file.size)}</span>
        </div>
        {job.stage === "ready" && (
          <IconButton label="업로드 취소" onClick={onCancel}>
            <X size={14} />
          </IconButton>
        )}
      </div>

      {job.stage === "ready" && (
        <button type="button" className="btn btn-primary btn-block" onClick={onStart}>
          검색 준비 시작
        </button>
      )}

      {job.stage === "uploading" && (
        <div className="job-progress">
          <div className="job-row">
            <span>업로드 중</span>
            <span className="mono">{job.progress}%</span>
          </div>
          <div
            className="bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
            aria-label="업로드 진행률"
          >
            <span style={{ width: `${job.progress}%` }} />
          </div>
        </div>
      )}

      {job.stage === "processing" && (
        <div className="job-progress">
          <div className="job-row">
            <span className="job-row-label">
              <Spinner size={12} />
              문서를 읽는 중
            </span>
            <span className="mono">{elapsed}</span>
          </div>
          <div className="bar is-indeterminate" role="progressbar" aria-label="문서를 읽는 중">
            <span />
          </div>
        </div>
      )}

      {job.stage === "error" && (
        <div className="job-error" role="alert">
          <div className="job-error-title">
            <AlertCircle size={14} aria-hidden="true" />
            {job.error.title}
          </div>
          {job.error.detail && <p>{job.error.detail}</p>}
          <TechnicalDetail text={job.error.technical} />
          <div className="job-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onDismiss}>
              닫기
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onStart}>
              <RotateCcw size={13} aria-hidden="true" />
              다시 시도
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ settings, onChange, onResetRequest }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={`settings ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="settings-toggle"
        aria-expanded={open}
        aria-controls="settings-body"
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        설정
        <ChevronDown size={14} className="chevron" aria-hidden="true" />
      </button>

      {open && (
        <div id="settings-body" className="settings-body">
          <label className="field">
            <span className="field-row">
              <span>답변 근거 수</span>
              <span className="field-value">{settings.limit}개</span>
            </span>
            <input
              type="range"
              min="1"
              max="20"
              value={settings.limit}
              onChange={(event) => onChange({ limit: Number(event.target.value) })}
              style={{ "--fill": `${((settings.limit - 1) / 19) * 100}%` }}
            />
          </label>

          <label className="field">
            <span className="field-row">
              <span>새 문서 검색 분량</span>
              <span className="field-value">{approxCoverage(settings.maxChunks)}</span>
            </span>
            <input
              type="range"
              min="1"
              max="200"
              value={settings.maxChunks}
              onChange={(event) => onChange({ maxChunks: Number(event.target.value) })}
              style={{ "--fill": `${((settings.maxChunks - 1) / 199) * 100}%` }}
            />
            <span className="field-help">많을수록 더 넓게 찾지만 준비가 오래 걸립니다.</span>
          </label>

          <button
            type="button"
            className="btn btn-danger-ghost btn-sm btn-block"
            onClick={onResetRequest}
          >
            <Trash2 size={13} aria-hidden="true" />
            모든 문서 지우기
          </button>
        </div>
      )}
    </section>
  );
}

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function useElapsed(since) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!since) {
      return undefined;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  return since ? formatElapsed(Math.max(0, now - since)) : "0:00";
}
