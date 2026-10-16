import { useEffect } from "react";

/** Tally-style power-user shortcuts: Ctrl+N (new), Ctrl+S (save), Ctrl+F (search). */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo =
        (e.ctrlKey || e.metaKey ? "ctrl+" : "") +
        (e.shiftKey ? "shift+" : "") +
        e.key.toLowerCase();
      const fn = map[combo];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
