// Locates a retrieved chunk inside a page's pdf.js text items.
//
// The backend extracts text with PyMuPDF while the viewer uses pdf.js, so line
// breaks and spacing differ. Matching therefore ignores all whitespace. The
// citation only carries the first 300 characters of the chunk (text_preview),
// which is what we search for.

const WHITESPACE = /\s/u;
const MIN_PROBE = 12;

function strip(text) {
  return text.replace(/\s+/gu, "");
}

/**
 * @param {string[]} items  pdf.js textContentItemsStr for one page
 * @param {string} needle   citation text_preview
 * @returns {{ indices: number[], exact: boolean } | null}
 */
export function findCitationItems(items, needle) {
  if (!needle || !items?.length) {
    return null;
  }

  const target = strip(needle);
  if (target.length < MIN_PROBE) {
    return null;
  }

  let haystack = "";
  const owner = [];
  items.forEach((str, index) => {
    for (const ch of str) {
      if (WHITESPACE.test(ch)) {
        continue;
      }
      haystack += ch;
      owner.push(index);
    }
  });

  let start = -1;
  let end = -1;
  let exact = false;

  const full = haystack.indexOf(target);
  if (full >= 0) {
    start = full;
    end = full + target.length - 1;
    exact = true;
  } else {
    // Progressively shorter probes from the head, then the tail. A hit only
    // anchors the position; the span is extended to the full preview length.
    const probes = [
      ["head", 120],
      ["head", 60],
      ["head", 30],
      ["tail", 60],
      ["tail", 30],
    ];

    for (const [side, size] of probes) {
      if (target.length <= size) {
        continue;
      }
      const probe = side === "head" ? target.slice(0, size) : target.slice(-size);
      const hit = haystack.indexOf(probe);
      if (hit < 0) {
        continue;
      }
      if (side === "head") {
        start = hit;
        end = Math.min(haystack.length - 1, hit + target.length - 1);
      } else {
        end = hit + probe.length - 1;
        start = Math.max(0, end - target.length + 1);
      }
      break;
    }
  }

  if (start < 0) {
    return null;
  }

  const indices = [];
  for (let i = owner[start]; i <= owner[end]; i += 1) {
    if (items[i]?.trim()) {
      indices.push(i);
    }
  }

  return indices.length ? { indices, exact } : null;
}
