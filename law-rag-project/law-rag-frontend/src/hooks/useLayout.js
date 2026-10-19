import { useCallback, useState, useSyncExternalStore } from "react";

const QUERIES = {
  mobile: "(max-width: 767px)",
  tablet: "(min-width: 768px) and (max-width: 1023px)",
  laptop: "(min-width: 1024px) and (max-width: 1439px)",
};

function currentMode() {
  for (const [mode, query] of Object.entries(QUERIES)) {
    if (window.matchMedia(query).matches) {
      return mode;
    }
  }
  return "desktop";
}

function subscribe(callback) {
  const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", callback));
  return () => lists.forEach((list) => list.removeEventListener("change", callback));
}

/** "mobile" | "tablet" | "laptop" | "desktop" */
export function useLayoutMode() {
  return useSyncExternalStore(subscribe, currentMode, () => "desktop");
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** useState mirrored to localStorage; storage failures are ignored. */
export function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => read(key, fallback));

  const update = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // ignore
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
