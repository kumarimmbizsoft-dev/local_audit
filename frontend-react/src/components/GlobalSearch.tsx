import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, BookOpen, Users, Truck, Tag, Banknote, GitBranch, PieChart } from "lucide-react";
import { api, envelopeResult } from "../lib/api";
import { cn } from "../lib/format";

interface Hit {
  type: string;
  id: string;
  name: string;
  sub: string;
  url: string;
}

const ICONS: Record<string, any> = {
  ledger: BookOpen,
  customer: Users,
  vendor: Truck,
  item: Tag,
  bank: Banknote,
  group: GitBranch,
  cost_center: PieChart,
};

/** Unified master search (GET /api/master/search) with Ctrl+K / Ctrl+F. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "f")) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else {
      setQ("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await api.get(`/master/search?q=${encodeURIComponent(q)}`);
      setHits(envelopeResult<Hit[]>(r) || []);
      setActive(0);
      setLoading(false);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  function go(h: Hit) {
    setOpen(false);
    nav(h.url, { state: { highlight: h.id, search: h.name } });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 rounded-[5px] border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:border-[var(--teal)] transition-colors w-52"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search masters…</span>
        <span className="mono text-[10px] rounded-[3px] bg-muted px-1">⌘K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 mx-auto mt-24 w-full max-w-[560px] card-panel overflow-hidden fade-up">
            <div className="flex items-center gap-2.5 px-4 border-b border-border">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
                  if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                  if (e.key === "Enter" && hits[active]) go(hits[active]);
                }}
                placeholder="Search ledgers, parties, items, banks, groups…"
                aria-label="Search ledgers, parties, items, banks, groups"
                className="flex-1 h-12 bg-transparent outline-none text-sm"
              />
              {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-[var(--teal)]" />}
            </div>
            <ul className="max-h-[380px] overflow-y-auto py-1.5">
              {q && !loading && hits.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No masters match “{q}”.
                </li>
              )}
              {hits.map((h, i) => {
                const Icon = ICONS[h.type] || Search;
                return (
                  <li key={h.type + h.id}>
                    <button
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-l-4",
                        i === active
                          ? "bg-primary text-primary-foreground font-bold border-l-primary shadow-sm"
                          : "border-l-transparent hover:bg-muted/50"
                      )}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h)}
                    >
                      <span
                        className="h-8 w-8 rounded-md grid place-items-center shrink-0"
                        style={{
                          background: i === active ? "rgba(255, 255, 255, 0.2)" : "var(--teal-soft)",
                          color: i === active ? "#ffffff" : "var(--teal)",
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] truncate", i === active ? "font-bold text-primary-foreground" : "font-medium")}>
                          {h.name}
                        </span>
                        <span className={cn("block text-[11px] truncate", i === active ? "text-primary-foreground/80 font-medium" : "text-muted-foreground")}>
                          {h.sub}
                        </span>
                      </span>
                      <span className={cn("mono text-[10px] uppercase tracking-wider", i === active ? "text-primary-foreground/90 font-semibold" : "text-muted-foreground")}>
                        {h.type.replace("_", " ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
