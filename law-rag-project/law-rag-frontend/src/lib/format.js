export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The backend splits text into 800-character pieces with a 120-character
// overlap, so N pieces cover roughly N × 680 characters of the document.
export function approxCoverage(pieces) {
  const chars = pieces * 680 + 120;
  if (chars < 10000) {
    return `약 ${(Math.round(chars / 100) * 100).toLocaleString()}자`;
  }
  return `약 ${(chars / 10000).toFixed(1).replace(/\.0$/, "")}만 자`;
}

