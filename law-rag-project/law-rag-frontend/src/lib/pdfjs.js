// The legacy build polyfills the very recent JS APIs (Map#getOrInsertComputed,
// Math.sumPrecise, …) that the modern pdf.js 6 build calls directly.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Korean statute PDFs often use CID fonts that need the predefined CMaps to
// extract text correctly (which the citation highlight depends on).
const ASSET_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}`;

export function loadPdf(data) {
  return pdfjsLib.getDocument({
    data,
    cMapUrl: `${ASSET_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}/standard_fonts/`,
  });
}

export { pdfjsLib };
