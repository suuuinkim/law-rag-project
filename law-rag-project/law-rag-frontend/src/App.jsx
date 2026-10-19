import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Files, Sparkles } from "lucide-react";
import {
  askQuestion,
  deleteDocument,
  listDocuments,
  resetVectorStore,
  uploadAndIndex,
} from "./api/documents.js";
import apiClient from "./api/client.js";
import { describeError } from "./lib/errors.js";
import { deleteRecord, getAllRecords, putRecord } from "./lib/pdfStore.js";
import { useLayoutMode, usePersistentState } from "./hooks/useLayout.js";
import Sidebar, { BrandMark } from "./components/Sidebar.jsx";
import ResearchPanel from "./components/ResearchPanel.jsx";
import { ConfirmDialog, Spinner, Toasts } from "./components/ui.jsx";
import "./App.css";

// pdf.js is large; keep it out of the initial bundle.
const PdfViewer = lazy(() => import("./components/PdfViewer.jsx"));

const PENDING = "__pending__";
const DEFAULT_SETTINGS = { maxChunks: 20, limit: 5 };
const DEFAULT_RESEARCH_WIDTH = 460;

async function isPdfFile(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return false;
  }
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

function readAdminKey() {
  try {
    return sessionStorage.getItem("lawlens.adminKey") ?? "";
  } catch {
    return "";
  }
}

function App() {
  const layout = useLayoutMode();

  // ── layout state ──────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState(
    "lawlens.sidebarCollapsed",
    false,
  );
  const [researchWidth, setResearchWidth] = usePersistentState(
    "lawlens.researchWidth",
    DEFAULT_RESEARCH_WIDTH,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState("research");
  const [composerFocused, setComposerFocused] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(true);

  // ── server / workspace state ─────────────────────────────
  const [settings, setSettings] = usePersistentState("lawlens.settings", DEFAULT_SETTINGS);
  const [adminKey, setAdminKeyState] = useState(readAdminKey);
  const [apiStatus, setApiStatus] = useState("checking");
  const [serverDocs, setServerDocs] = useState(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState(null);
  const [localRecords, setLocalRecords] = useState(() => new Map());
  const [uploadJob, setUploadJob] = useState(null);

  // ── research state ────────────────────────────────────────
  const [activeDocId, setActiveDocId] = useState(null);
  const [target, setTarget] = useState(null);
  const [activeCitation, setActiveCitation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isAsking, setIsAsking] = useState(false);
  const askingRef = useRef(false);

  const [toasts, setToasts] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const pickerRef = useRef(null);

  const showToast = useCallback((message, type = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const refreshDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const data = await listDocuments();
      setServerDocs(data.documents ?? []);
      setDocsError(null);
    } catch (error) {
      setDocsError(describeError(error, "list").title);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    setApiStatus("checking");
    try {
      await apiClient.get("/health");
      setApiStatus("ok");
      refreshDocuments();
    } catch {
      setApiStatus("fail");
      setDocsLoading(false);
    }
  }, [refreshDocuments]);

  useEffect(() => {
    checkHealth();
    getAllRecords().then((records) => {
      setLocalRecords(new Map(records.map((record) => [record.documentId, record])));
      const latest = records
        .filter((record) => record.blob)
        .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))[0];
      if (latest) {
        setActiveDocId((prev) => prev ?? latest.documentId);
      }
    });
  }, [checkHealth]);

  // ── documents: server list enriched with local PDF copies ─
  const documents = useMemo(() => {
    const list = [];
    const seen = new Set();

    for (const item of serverDocs ?? []) {
      const local = localRecords.get(item.document_id);
      seen.add(item.document_id);
      list.push({
        id: item.document_id,
        name: item.original_filename ?? local?.name ?? "이름 없는 문서",
        chunkCount: item.chunk_count,
        pageCount: item.page_count,
        totalPages: local?.pageCount,
        totalChunks: local?.totalChunks,
        blob: local?.blob ?? null,
        hasPdf: Boolean(local?.blob),
        uploadedAt: local?.uploadedAt ?? 0,
        onServer: true,
      });
    }

    for (const local of localRecords.values()) {
      if (seen.has(local.documentId)) {
        continue;
      }
      list.push({
        id: local.documentId,
        name: local.name,
        chunkCount: local.indexedChunks,
        totalPages: local.pageCount,
        totalChunks: local.totalChunks,
        blob: local.blob ?? null,
        hasPdf: Boolean(local.blob),
        uploadedAt: local.uploadedAt ?? 0,
        // Unknown while the server list is unavailable.
        onServer: serverDocs ? false : undefined,
      });
    }

    return list.sort(
      (a, b) => b.uploadedAt - a.uploadedAt || a.name.localeCompare(b.name, "ko"),
    );
  }, [serverDocs, localRecords]);

  const documentsById = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc])),
    [documents],
  );

  let activeDoc = null;
  if (activeDocId === PENDING && uploadJob) {
    activeDoc = { id: PENDING, name: uploadJob.file.name, blob: uploadJob.file, preview: true };
  } else if (activeDocId) {
    activeDoc =
      documentsById.get(activeDocId) ??
      (target?.documentId === activeDocId
        ? { id: activeDocId, name: target.filename ?? "문서", blob: null }
        : null);
  }
  const viewerTarget = activeDoc && target?.documentId === activeDoc.id ? target : null;

  // ── upload + indexing ─────────────────────────────────────
  const revealSidebar = () => {
    if (layout === "mobile") {
      setMobileTab("documents");
    } else if (layout === "tablet") {
      setDrawerOpen(true);
    } else {
      setSidebarCollapsed(false);
    }
  };

  const pickFile = async (file) => {
    if (!file) {
      return;
    }
    if (!(await isPdfFile(file))) {
      showToast("PDF 파일만 올릴 수 있습니다", "error");
      return;
    }
    setUploadJob({ file, stage: "ready" });
    setActiveDocId(PENDING);
    setViewerOpen(true);
    revealSidebar();
  };

  const startIndex = async () => {
    if (!uploadJob) {
      return;
    }
    const { file } = uploadJob;
    const maxChunks = settings.maxChunks;
    setUploadJob({ file, stage: "uploading", progress: 0 });

    try {
      const data = await uploadAndIndex(file, maxChunks, {
        onUploadProgress: (event) => {
          if (!event.total) {
            return;
          }
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadJob((job) => {
            if (!job || job.stage !== "uploading") {
              return job;
            }
            return progress >= 100
              ? { ...job, stage: "processing", progress: 100, processingSince: Date.now() }
              : { ...job, progress };
          });
        },
      });

      const record = {
        documentId: data.document_id,
        name: data.original_filename ?? file.name,
        size: file.size,
        blob: file,
        pageCount: data.page_count,
        totalChunks: data.total_chunk_count,
        indexedChunks: data.indexed_count,
        uploadedAt: Date.now(),
      };
      await putRecord(record);
      setLocalRecords((prev) => new Map(prev).set(record.documentId, record));
      setUploadJob(null);
      setActiveDocId((prev) => (prev === PENDING ? record.documentId : prev));
      showToast(
        data.indexed_count < data.total_chunk_count
          ? "검색 준비가 끝났습니다 (앞부분만)"
          : "검색 준비가 끝났습니다",
        "success",
      );
      refreshDocuments();
    } catch (error) {
      setUploadJob((job) => job && { ...job, stage: "error", error: describeError(error, "index") });
    }
  };

  const discardJob = () => {
    setUploadJob(null);
    setActiveDocId((prev) => (prev === PENDING ? null : prev));
  };

  const attachPdf = async (documentId, file) => {
    if (!file) {
      return;
    }
    if (!(await isPdfFile(file))) {
      showToast("PDF 파일만 연결할 수 있습니다", "error");
      return;
    }
    const doc = documentsById.get(documentId);
    const record = {
      ...(localRecords.get(documentId) ?? {}),
      documentId,
      name: doc?.name ?? file.name,
      size: file.size,
      blob: file,
      uploadedAt: localRecords.get(documentId)?.uploadedAt ?? Date.now(),
    };
    await putRecord(record);
    setLocalRecords((prev) => new Map(prev).set(documentId, record));
    showToast("PDF를 연결했습니다", "success");
  };

  // ── document management ───────────────────────────────────
  const removeDocumentLocally = (documentId) => {
    setServerDocs((prev) => prev?.filter((doc) => doc.document_id !== documentId) ?? prev);
    setLocalRecords((prev) => {
      const next = new Map(prev);
      next.delete(documentId);
      return next;
    });
    setActiveDocId((prev) => (prev === documentId ? null : prev));
    setTarget((prev) => (prev?.documentId === documentId ? null : prev));
  };

  const confirmDelete = async (doc) => {
    setConfirmBusy(true);
    try {
      if (doc.onServer !== false) {
        try {
          await deleteDocument(doc.id);
        } catch (error) {
          if (error?.response?.status !== 404) {
            throw error;
          }
        }
      }
      await deleteRecord(doc.id);
      removeDocumentLocally(doc.id);
      showToast("삭제했습니다", "info");
      setConfirm(null);
    } catch (error) {
      const info = describeError(error, "delete");
      showToast(info.detail ? `${info.title}. ${info.detail}` : info.title, "error");
    } finally {
      setConfirmBusy(false);
    }
  };

  const confirmReset = async () => {
    setConfirmBusy(true);
    try {
      await resetVectorStore(adminKey);
      await Promise.all([...localRecords.keys()].map((id) => deleteRecord(id)));
      setLocalRecords(new Map());
      setServerDocs([]);
      setActiveDocId((prev) => (prev === PENDING ? prev : null));
      setTarget(null);
      setActiveCitation(null);
      showToast("모든 문서를 지웠습니다", "info");
      setConfirm(null);
    } catch (error) {
      const info = describeError(error, "reset");
      showToast(info.detail ? `${info.title}. ${info.detail}` : info.title, "error");
    } finally {
      setConfirmBusy(false);
    }
  };

  const setAdminKey = (value) => {
    setAdminKeyState(value);
    try {
      sessionStorage.setItem("lawlens.adminKey", value);
    } catch {
      // ignore
    }
  };

  // ── asking ────────────────────────────────────────────────
  const ask = async (question, { appendUser = true } = {}) => {
    if (askingRef.current) {
      return;
    }
    askingRef.current = true;
    setIsAsking(true);
    if (appendUser) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: question }]);
    }

    try {
      const data = await askQuestion(question, settings.limit);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          status: "ready",
          question,
          text: data.answer,
          citations: data.citations ?? [],
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          status: "error",
          question,
          error: describeError(error, "ask"),
        },
      ]);
    } finally {
      askingRef.current = false;
      setIsAsking(false);
    }
  };

  const retry = (message) => {
    setMessages((prev) => prev.filter((item) => item.id !== message.id));
    ask(message.question, { appendUser: false });
  };

  const clearConversation = () => {
    setMessages([]);
    setActiveCitation(null);
    setTarget(null);
  };

  // ── citation → PDF ────────────────────────────────────────
  const openCitation = (message, index) => {
    const citation = message.citations?.[index];
    if (!citation) {
      return;
    }
    setActiveCitation({ messageId: message.id, index });
    setActiveDocId(citation.document_id);
    setTarget({
      key: crypto.randomUUID(),
      documentId: citation.document_id,
      filename: citation.original_filename,
      page: citation.page_number,
      text: citation.text_preview,
    });
    setViewerOpen(true);
    if (layout === "mobile") {
      setMobileTab("viewer");
    }
  };

  const clearTarget = () => {
    setTarget(null);
    setActiveCitation(null);
  };

  const selectDocument = (documentId) => {
    setActiveDocId(documentId);
    setViewerOpen(true);
    setDrawerOpen(false);
    if (layout === "mobile") {
      setMobileTab("viewer");
    }
  };

  useEffect(() => {
    if (!drawerOpen) {
      return undefined;
    }
    const onKey = (event) => event.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // ── render ────────────────────────────────────────────────
  const sidebarProps = {
    apiStatus,
    onRetryHealth: checkHealth,
    documents,
    docsLoading,
    docsError,
    activeDocId,
    onSelectDocument: selectDocument,
    onDeleteDocument: (doc) => setConfirm({ type: "delete", doc }),
    onRefreshDocuments: refreshDocuments,
    uploadJob,
    onPickFile: pickFile,
    onStartIndex: startIndex,
    onCancelJob: discardJob,
    onDismissJob: discardJob,
    settings,
    onSettingsChange: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    onResetRequest: () => setConfirm({ type: "reset" }),
  };

  const isMobile = layout === "mobile";
  const showViewer = Boolean(activeDoc) && (isMobile || viewerOpen);
  const canReopenViewer = !isMobile && Boolean(activeDoc) && !viewerOpen;

  const viewer = (
    <Suspense
      fallback={
        <section className="panel viewer viewer-state" aria-busy="true">
          <Spinner size={18} />
          <p>뷰어를 불러오는 중…</p>
        </section>
      }
    >
      <PdfViewer
        doc={activeDoc}
        target={viewerTarget}
        onClearTarget={clearTarget}
        onAttachPdf={attachPdf}
        onClose={isMobile ? undefined : () => setViewerOpen(false)}
      />
    </Suspense>
  );

  const research = (
    <ResearchPanel
      messages={messages}
      isAsking={isAsking}
      onAsk={ask}
      onRetry={retry}
      onClear={clearConversation}
      activeCitation={activeCitation}
      onCitationClick={openCitation}
      docCount={serverDocs?.length ?? documents.length}
      apiStatus={apiStatus}
      onUploadClick={() => pickerRef.current?.click()}
      viewerAvailable={canReopenViewer}
      onOpenViewer={() => setViewerOpen(true)}
      onComposerFocusChange={setComposerFocused}
    />
  );

  let sidebar = null;
  if (layout === "desktop" || layout === "laptop") {
    sidebar = (
      <Sidebar
        {...sidebarProps}
        variant={sidebarCollapsed ? "rail" : "full"}
        onCollapse={() => setSidebarCollapsed(true)}
        onExpand={() => setSidebarCollapsed(false)}
      />
    );
  } else if (layout === "tablet") {
    sidebar = <Sidebar {...sidebarProps} variant="rail" onExpand={() => setDrawerOpen(true)} />;
  }

  return (
    <div className={`app layout-${layout}`} data-tab={isMobile ? mobileTab : undefined}>
      <input
        ref={pickerRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(event) => {
          pickFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {sidebar}

      {layout === "tablet" && drawerOpen && (
        <div className="drawer-scrim" onMouseDown={() => setDrawerOpen(false)}>
          <div className="drawer" onMouseDown={(event) => event.stopPropagation()}>
            <Sidebar {...sidebarProps} variant="full" onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {isMobile && (
        <header className="mobile-head">
          <div className="brand">
            <BrandMark size={26} />
            <strong>LawLens</strong>
          </div>
          <span className={`status-dot status-${apiStatus}`} role="img" aria-label={apiStatus === "ok" ? "서버 연결됨" : apiStatus === "fail" ? "서버 연결 끊김" : "연결 확인 중"} />
        </header>
      )}

      <main className={`workspace ${showViewer ? "has-viewer" : ""}`}>
        {isMobile && (
          <div className="mobile-pane pane-documents">
            <Sidebar {...sidebarProps} variant="full" />
          </div>
        )}

        {isMobile ? (
          <div className="mobile-pane pane-viewer">
            {activeDoc ? (
              viewer
            ) : (
              <div className="panel viewer-placeholder">
                <BookOpen size={20} aria-hidden="true" />
                <p>선택한 문서가 없습니다</p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setMobileTab("documents")}
                >
                  문서 목록 보기
                </button>
              </div>
            )}
          </div>
        ) : (
          showViewer && viewer
        )}

        {showViewer && !isMobile && (
          <Resizer width={researchWidth} onChange={setResearchWidth} />
        )}

        <div
          className={isMobile ? "mobile-pane pane-research" : "research-slot"}
          style={
            showViewer && !isMobile
              ? { "--research-w": `${researchWidth}px` }
              : undefined
          }
        >
          {research}
        </div>
      </main>

      {isMobile && !composerFocused && (
        <nav className="mobile-tabs" aria-label="화면 전환">
          {[
            { id: "documents", label: "문서", icon: Files },
            { id: "viewer", label: "원문", icon: BookOpen },
            { id: "research", label: "AI 리서치", icon: Sparkles },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={mobileTab === id ? "is-active" : ""}
              aria-current={mobileTab === id ? "page" : undefined}
              onClick={() => setMobileTab(id)}
            >
              <Icon size={19} aria-hidden="true" />
              {label}
              {id === "viewer" && viewerTarget && <span className="tab-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
      )}

      {confirm?.type === "delete" && (
        <ConfirmDialog
          title="문서를 삭제할까요?"
          description={confirm.doc.name}
          confirmLabel="삭제"
          busy={confirmBusy}
          onConfirm={() => confirmDelete(confirm.doc)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.type === "reset" && (
        <ConfirmDialog
          title="모든 문서를 지울까요?"
          description="되돌릴 수 없습니다."
          confirmLabel="모두 지우기"
          busy={confirmBusy}
          onConfirm={confirmReset}
          onCancel={() => setConfirm(null)}
        >
          <label className="field">
            <span className="field-row">관리자 비밀번호</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder=""
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}

      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))}
      />
    </div>
  );
}

function Resizer({ width, onChange }) {
  const dragRef = useRef(null);

  const clampWidth = (value, workspace) => {
    const max = workspace ? workspace.clientWidth - 380 : 900;
    return Math.round(Math.min(Math.max(value, 340), Math.max(340, max)));
  };

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="원문과 AI 패널 크기 조절"
      aria-valuenow={width}
      tabIndex={0}
      onDoubleClick={() => onChange(DEFAULT_RESEARCH_WIDTH)}
      onKeyDown={(event) => {
        const workspace = event.currentTarget.parentElement;
        if (event.key === "ArrowLeft") {
          onChange(clampWidth(width + 24, workspace));
        } else if (event.key === "ArrowRight") {
          onChange(clampWidth(width - 24, workspace));
        }
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = event.currentTarget.parentElement;
        document.body.classList.add("is-resizing");
      }}
      onPointerMove={(event) => {
        const workspace = dragRef.current;
        if (!workspace) {
          return;
        }
        const rect = workspace.getBoundingClientRect();
        onChange(clampWidth(rect.right - event.clientX - 12, workspace));
      }}
      onPointerUp={() => {
        dragRef.current = null;
        document.body.classList.remove("is-resizing");
      }}
    />
  );
}

export default App;
