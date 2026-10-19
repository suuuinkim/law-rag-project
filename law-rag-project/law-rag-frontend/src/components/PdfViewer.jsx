import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Highlighter,
  Maximize2,
  Minus,
  PanelRightClose,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { loadPdf, pdfjsLib } from "../lib/pdfjs.js";
import { findCitationItems } from "../lib/textMatch.js";
import { IconButton, Spinner } from "./ui.jsx";

const PAGE_GAP = 16;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export default function PdfViewer({ doc, target, onClearTarget, onAttachPdf, onClose }) {
  if (!doc) {
    return null;
  }

  if (!doc.blob) {
    return (
      <MissingPdf doc={doc} target={target} onAttachPdf={onAttachPdf} onClose={onClose} />
    );
  }

  return (
    <PdfDocument
      key={doc.id}
      doc={doc}
      target={target}
      onClearTarget={onClearTarget}
      onClose={onClose}
    />
  );
}

function ViewerTitle({ doc }) {
  return (
    <div className="viewer-title">
      <strong title={doc.name}>{doc.name}</strong>
      {doc.preview && <span className="tag">미리보기</span>}
    </div>
  );
}

function MissingPdf({ doc, target, onAttachPdf, onClose }) {
  const fileRef = useRef(null);

  return (
    <section className="panel viewer" aria-label="PDF 원문">
      <header className="viewer-bar">
        <ViewerTitle doc={doc} />
        {onClose && (
          <IconButton label="원문 패널 닫기" onClick={onClose}>
            <PanelRightClose size={17} />
          </IconButton>
        )}
      </header>
      <div className="viewer-missing">
        <FileWarning size={22} aria-hidden="true" />
        <h3>원본 PDF가 없습니다</h3>
        <p>
같은 파일을 연결하면 원문에서 위치를 볼 수 있습니다.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(event) => {
            onAttachPdf(doc.id, event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          <Paperclip size={15} aria-hidden="true" />
          PDF 파일 연결
        </button>

        {target?.text && (
          <figure className="missing-quote">
            <figcaption>p.{target.page ?? "?"}</figcaption>
            <blockquote>{target.text}</blockquote>
          </figure>
        )}
      </div>
    </section>
  );
}

function PdfDocument({ doc, target, onClearTarget, onClose }) {
  const scrollRef = useRef(null);
  const pageRefs = useRef([]);
  const prevScaleRef = useRef(null);
  const scrollRaf = useRef(0);

  const [pdf, setPdf] = useState(null);
  const [sizes, setSizes] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState({ mode: "fit", scale: 1 });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [hit, setHit] = useState(null);
  const [revealCount, setRevealCount] = useState(0);
  const scrolledKeyRef = useRef(null);

  // Load document + every page's base size (needed to lay out placeholders).
  useEffect(() => {
    let cancelled = false;
    let task = null;

    doc.blob
      .arrayBuffer()
      .then((data) => {
        task = loadPdf(data);
        return task.promise;
      })
      .then(async (loaded) => {
        const dims = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, i) =>
            loaded.getPage(i + 1).then((page) => {
              const { width, height } = page.getViewport({ scale: 1 });
              return { width, height };
            }),
          ),
        );
        if (!cancelled) {
          setPdf(loaded);
          setSizes(dims);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error?.name === "PasswordException"
              ? "암호로 보호된 PDF는 열 수 없습니다."
              : "PDF를 해석하지 못했습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다.",
          );
        }
      });

    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [doc.blob]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return undefined;
    }
    let lastWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      // Hidden → visible (mobile tab switch): the fit zoom is about to change,
      // so the citation jump has to happen again at the real size.
      if (!lastWidth && width) {
        scrolledKeyRef.current = null;
        setRevealCount((count) => count + 1);
      }
      lastWidth = width;
      setContainerWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const baseWidth = sizes.length ? Math.max(...sizes.map((size) => size.width)) : 0;
  const fitScale =
    baseWidth && containerWidth
      ? clamp((containerWidth - 32) / baseWidth, MIN_SCALE, MAX_SCALE)
      : 1;
  const scale = zoom.mode === "fit" ? fitScale : zoom.scale;

  // Keep the reading position when the zoom changes.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    const prev = prevScaleRef.current;
    prevScaleRef.current = scale;
    if (!node || !prev || prev === scale) {
      return;
    }
    node.scrollTop = node.scrollTop * (scale / prev);
  }, [scale]);

  const handleScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) {
        return;
      }
      const probe = node.scrollTop + node.clientHeight * 0.35;
      let page = 1;
      pageRefs.current.forEach((el, index) => {
        if (el && el.offsetTop <= probe) {
          page = index + 1;
        }
      });
      setCurrentPage(page);
      setPageInput(String(page));
    });
  };

  const goToPage = useCallback(
    (page, behavior = "smooth") => {
      const el = pageRefs.current[page - 1];
      const node = scrollRef.current;
      if (!el || !node) {
        return;
      }
      node.scrollTo({ top: el.offsetTop - PAGE_GAP, behavior });
    },
    [],
  );

  // Citation → page. Highlighting itself happens inside PdfPage once its text
  // layer exists; this only brings the page into view.
  const targetKey = target?.key;
  const targetPage = target?.page;
  useEffect(() => {
    if (!targetKey || !pdf) {
      return;
    }
    if (!targetPage || targetPage < 1 || targetPage > pdf.numPages) {
      queueMicrotask(() => setHit({ key: targetKey, status: "outofrange" }));
      return;
    }
    goToPage(targetPage);
  }, [targetKey, targetPage, pdf, goToPage, revealCount]);

  // Pages re-apply the highlight after every re-render (zoom, scrolling back),
  // but only the first application of a citation should move the viewport.
  const handleHighlight = useCallback((key, status, elements) => {
    setHit({ key, status });
    const node = scrollRef.current;
    if (!elements?.length || !node || scrolledKeyRef.current === key) {
      return;
    }
    scrolledKeyRef.current = key;

    // Text order isn't visual order (a chunk can start with the page footer),
    // so frame the bounding box of every highlighted span.
    const box = node.getBoundingClientRect();
    let top = Infinity;
    let bottom = -Infinity;
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    const regionTop = top - box.top + node.scrollTop;
    const regionHeight = bottom - top;
    const offset =
      regionHeight < node.clientHeight * 0.8
        ? (node.clientHeight - regionHeight) / 2
        : node.clientHeight * 0.12;
    node.scrollTo({ top: Math.max(0, regionTop - offset), behavior: "smooth" });
  }, []);

  const zoomBy = (delta) => {
    setZoom({
      mode: "manual",
      scale: clamp(Math.round((scale + delta) * 10) / 10, MIN_SCALE, MAX_SCALE),
    });
  };

  const commitPageInput = () => {
    const value = Number.parseInt(pageInput, 10);
    if (pdf && Number.isFinite(value)) {
      const page = clamp(value, 1, pdf.numPages);
      setPageInput(String(page));
      goToPage(page);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const activeHit = hit && hit.key === targetKey ? hit : null;
  const numPages = pdf?.numPages ?? 0;

  return (
    <section className="panel viewer" aria-label="PDF 원문">
      <header className="viewer-bar">
        <ViewerTitle doc={doc} />

        <div className="viewer-tools">
          <div className="tool-group" role="group" aria-label="페이지 이동">
            <IconButton
              label="이전 페이지"
              onClick={() => goToPage(currentPage - 1)}
              disabled={!pdf || currentPage <= 1}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span className="page-field">
              <input
                className="page-input"
                inputMode="numeric"
                aria-label="페이지 번호"
                value={pageInput}
                disabled={!pdf}
                onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
                onBlur={commitPageInput}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
              <span className="page-total">/ {numPages || "—"}</span>
            </span>
            <IconButton
              label="다음 페이지"
              onClick={() => goToPage(currentPage + 1)}
              disabled={!pdf || currentPage >= numPages}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>

          <div className="tool-group" role="group" aria-label="확대 및 축소">
            <IconButton label="축소" onClick={() => zoomBy(-0.1)} disabled={!pdf || scale <= MIN_SCALE}>
              <Minus size={15} />
            </IconButton>
            <span className="zoom-value mono">{Math.round(scale * 100)}%</span>
            <IconButton label="확대" onClick={() => zoomBy(0.1)} disabled={!pdf || scale >= MAX_SCALE}>
              <Plus size={15} />
            </IconButton>
            <IconButton
              label="너비에 맞춤"
              className={zoom.mode === "fit" ? "is-active" : ""}
              onClick={() => setZoom({ mode: "fit", scale })}
              disabled={!pdf}
            >
              <Maximize2 size={14} />
            </IconButton>
          </div>

          {onClose && (
            <IconButton label="원문 패널 닫기" onClick={onClose}>
              <PanelRightClose size={17} />
            </IconButton>
          )}
        </div>
      </header>

      {target && <HitBanner target={target} hit={activeHit} onClear={onClearTarget} />}

      <div className="viewer-scroll" ref={scrollRef} onScroll={handleScroll}>
        {loadError && (
          <div className="viewer-state" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <p>{loadError}</p>
          </div>
        )}

        {!loadError && !pdf && (
          <div className="viewer-state">
            <Spinner size={18} />
            <p>여는 중…</p>
          </div>
        )}

        {pdf && (
          <div className="pages" style={{ gap: PAGE_GAP, paddingBlock: PAGE_GAP }}>
            {sizes.map((size, index) => {
              const pageNumber = index + 1;
              return (
                <PdfPage
                  key={pageNumber}
                  pdf={pdf}
                  pageNumber={pageNumber}
                  width={size.width * scale}
                  height={size.height * scale}
                  scale={scale}
                  root={scrollRef}
                  highlight={target && target.page === pageNumber ? target : null}
                  onHighlight={handleHighlight}
                  pageRef={(el) => {
                    pageRefs.current[index] = el;
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function HitBanner({ target, hit, onClear }) {
  let text = `p.${target.page ?? "?"} 여는 중…`;
  let tone = "pending";

  if (hit?.status === "exact") {
    text = `p.${target.page} 근거 표시 중`;
    tone = "ok";
  } else if (hit?.status === "approx") {
    text = `p.${target.page} 근거 표시 중`;
    tone = "ok";
  } else if (hit?.status === "notfound") {
    text = `p.${target.page} · 정확한 위치를 찾지 못했습니다`;
    tone = "warn";
  } else if (hit?.status === "outofrange") {
    text = `이 PDF에는 p.${target.page ?? "?"}가 없습니다`;
    tone = "warn";
  }

  return (
    <div className={`hit-banner hit-${tone}`} role="status">
      <Highlighter size={14} aria-hidden="true" />
      <span>{text}</span>
      <IconButton label="하이라이트 지우기" onClick={onClear}>
        <X size={13} />
      </IconButton>
    </div>
  );
}

function PdfPage({ pdf, pageNumber, width, height, scale, root, highlight, onHighlight, pageRef }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const textItems = useRef({ divs: [], strs: [] });
  const [near, setNear] = useState(false);
  const [textVersion, setTextVersion] = useState(0);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: root.current, rootMargin: "1200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayer = textRef.current;
    if (!near || !canvas || !textLayer) {
      return undefined;
    }

    let cancelled = false;
    let renderTask = null;
    let layer = null;

    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled) {
        return;
      }
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);

      renderTask = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
      });

      try {
        await renderTask.promise;
        const content = await page.getTextContent();
        if (cancelled) {
          return;
        }
        textLayer.replaceChildren();
        layer = new pdfjsLib.TextLayer({
          textContentSource: content,
          container: textLayer,
          viewport,
        });
        await layer.render();
        if (cancelled) {
          return;
        }
        textItems.current = { divs: layer.textDivs, strs: layer.textContentItemsStr };
        setTextVersion((value) => value + 1);
      } catch {
        // cancelled render or text layer; the next pass will redo it
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      layer?.cancel();
    };
  }, [near, pdf, pageNumber, scale]);

  // Free canvases that scrolled far away.
  useEffect(() => {
    if (near) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    textRef.current?.replaceChildren();
    textItems.current = { divs: [], strs: [] };
  }, [near]);

  const highlightKey = highlight?.key;
  const highlightText = highlight?.text;
  useEffect(() => {
    const { divs, strs } = textItems.current;
    divs.forEach((div) => div.classList.remove("is-hit"));
    if (!highlightKey || !textVersion) {
      return;
    }
    const match = findCitationItems(strs, highlightText);
    if (!match) {
      onHighlight(highlightKey, "notfound", null);
      return;
    }
    const hits = match.indices.map((index) => divs[index]).filter(Boolean);
    hits.forEach((div) => div.classList.add("is-hit"));
    onHighlight(highlightKey, match.exact ? "exact" : "approx", hits);
  }, [highlightKey, highlightText, textVersion, onHighlight]);

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        pageRef(el);
      }}
      className="page"
      data-page={pageNumber}
      style={{
        width,
        height,
        "--total-scale-factor": scale,
      }}
    >
      <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />
      <div ref={textRef} className="textLayer" />
      <span className="page-number" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
