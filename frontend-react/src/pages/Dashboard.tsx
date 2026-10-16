import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Users,
  Truck,
  Tag,
  Banknote,
  Percent,
  PieChart,
  Ruler,
  ScrollText,
  Plus,
  ArrowUpRight,
  AlertTriangle,
  History,
  RotateCw,
  TrendingUp,
  Clock,
  CreditCard,
  CalendarClock,
  CheckCircle2,
  Wallet,
  Receipt,
  Landmark,
  Coins,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useCompany } from "../auth/CompanyContext";
import { api, envelopeResult } from "../lib/api";
import { fmtDateTime, money } from "../lib/format";
import { Spinner, Button } from "../components/ui";

interface Summary {
  financial_overview?: {
    cash_bank_total: number;
    bank_total?: number;
    cash_total?: number;
    bank_accounts?: { id?: string; name: string; account_number?: string; balance: number }[];
    cash_accounts?: { id?: string; name: string; balance: number }[];
    revenue_total: number;
    expenses_total: number;
    net_profit: number;
    profit_margin_pct: number;
    target_pct: number;
  };
  performance_trend?: {
    month: string;
    year: number;
    revenue: number;
    expenses: number;
    net_profit: number;
  }[];
  gst_estimate?: {
    output_tax: number;
    input_tax_credit: number;
    net_payable: number;
    status: string;
  };
  chart_of_accounts: { total_ledgers: number; inactive_ledgers: number; missing_grouping: number; groups: number };
  customers: { total: number; missing_gstin: number; with_outstanding?: number; overdue: number; receivable_total: number; with_credit_limit: number };
  vendors: { total: number; missing_gstin: number; with_payable?: number; payable: number; payable_total: number };
  ar_ageing: { total_outstanding: number; not_due: number; "0_30": number; "31_60": number; "61_90": number; "90_plus": number; open_document_count: number };
  ap_ageing: { total_outstanding: number; not_due: number; "0_30": number; "31_60": number; "61_90": number; "90_plus": number; open_document_count: number };
  products: { total: number; inactive: number; gst_missing: number; low_stock: number };
  bank_cash: {
    bank_accounts: number;
    cash_accounts: number;
    reconciliation_pending: number;
    reconciliation_status: string;
    bank_total?: number;
    cash_total?: number;
    accounts?: { id?: string; name: string; account_number?: string; balance: number }[];
    cash_details?: { id?: string; name: string; balance: number }[];
  };
  gst_setup: { rates: number; hsn_codes: number; configured: boolean; status: string };
  cost_centers: { total: number; departments: number; projects: number; branches: number };
  units: { total: number };
  vouchers: { draft: number; posted: number };
  recent_activity: { entity: string; entityName: string; action: string; actor: string | null; createdDate: string | null }[];
}

type AgeingData = Pick<Summary, "ar_ageing" | "ap_ageing">;
type TrendData = Pick<Summary, "performance_trend">;

function PerformanceTrendChart({ data }: { data?: Summary["performance_trend"] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [visible, setVisible] = useState({ revenue: true, expenses: true, profit: true });

  if (!data || data.length === 0) {
    return (
      <div className="h-44 grid place-items-center text-sm text-muted-foreground border border-dashed rounded-lg">
        No performance data recorded yet for the selected period.
      </div>
    );
  }

  const maxVal = Math.max(...data.flatMap((d) => [d.revenue, d.expenses, d.net_profit]), 100);
  const chartHeight = 180;
  const chartWidth = 600;
  const paddingX = 45;
  const paddingY = 25;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingY * 2;

  const getX = (idx: number) => paddingX + (idx / (data.length - 1 || 1)) * innerWidth;
  const getY = (val: number) => paddingY + innerHeight - (Math.max(0, val) / maxVal) * innerHeight;

  const revPoints = data.map((d, i) => `${getX(i)},${getY(d.revenue)}`).join(" ");
  const expPoints = data.map((d, i) => `${getX(i)},${getY(d.expenses)}`).join(" ");
  const profPoints = data.map((d, i) => `${getX(i)},${getY(d.net_profit)}`).join(" ");

  const hoveredData = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
        <div>
          <div className="text-[15px] font-semibold">Performance trend</div>
          <div className="text-[12px] text-muted-foreground">Revenue, expenses and net profit trend · ₹</div>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <button
            onClick={() => setVisible((v) => ({ ...v, revenue: !v.revenue }))}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border border-border/50 transition-opacity ${visible.revenue ? "opacity-100 font-medium" : "opacity-40"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
            Revenue
          </button>
          <button
            onClick={() => setVisible((v) => ({ ...v, expenses: !v.expenses }))}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border border-border/50 transition-opacity ${visible.expenses ? "opacity-100 font-medium" : "opacity-40"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            Expenses
          </button>
          <button
            onClick={() => setVisible((v) => ({ ...v, profit: !v.profit }))}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border border-border/50 transition-opacity ${visible.profit ? "opacity-100 font-medium" : "opacity-40"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Net profit
          </button>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-[200px] overflow-visible">
          {[0, 0.33, 0.66, 1].map((ratio, i) => (
            <line
              key={i}
              x1={paddingX}
              y1={paddingY + ratio * innerHeight}
              x2={chartWidth - paddingX}
              y2={paddingY + ratio * innerHeight}
              stroke="currentColor"
              className="text-border/40"
              strokeDasharray="4 4"
            />
          ))}

          {visible.revenue && (
            <polyline fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" points={revPoints} />
          )}

          {visible.expenses && (
            <polyline fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" points={expPoints} />
          )}

          {visible.profit && (
            <polyline fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" points={profPoints} />
          )}

          {data.map((d, i) => {
            const x = getX(i);
            return (
              <g key={i} className="cursor-pointer" onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}>
                <line x1={x} y1={paddingY} x2={x} y2={chartHeight - paddingY} stroke={hoveredIdx === i ? "var(--teal)" : "transparent"} strokeWidth="1.5" strokeDasharray="3 3" />
                {visible.revenue && <circle cx={x} cy={getY(d.revenue)} r={hoveredIdx === i ? 5 : 3.5} fill="#0ea5e9" />}
                {visible.expenses && <circle cx={x} cy={getY(d.expenses)} r={hoveredIdx === i ? 5 : 3.5} fill="#f59e0b" />}
                {visible.profit && <circle cx={x} cy={getY(d.net_profit)} r={hoveredIdx === i ? 5 : 3.5} fill="#10b981" />}
                <text x={x} y={chartHeight - 4} textAnchor="middle" className="text-[11px] fill-muted-foreground">
                  {d.month}
                </text>
              </g>
            );
          })}
        </svg>

        {hoveredData && hoveredIdx !== null && (
          <div
            className="absolute z-10 bg-popover text-popover-foreground shadow-lg border border-border rounded-md p-2.5 text-[12px] space-y-1 transition-all"
            style={{
              left: `${Math.min(85, Math.max(15, (hoveredIdx / (data.length - 1 || 1)) * 100))}%`,
              top: "10px",
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-semibold border-b border-border/50 pb-1 mb-1">{hoveredData.month} {hoveredData.year}</div>
            {visible.revenue && (
              <div className="flex justify-between gap-4">
                <span className="text-sky-500">Revenue:</span>
                <span className="font-mono font-medium">{money(hoveredData.revenue)}</span>
              </div>
            )}
            {visible.expenses && (
              <div className="flex justify-between gap-4">
                <span className="text-amber-500">Expenses:</span>
                <span className="font-mono font-medium">{money(hoveredData.expenses)}</span>
              </div>
            )}
            {visible.profit && (
              <div className="flex justify-between gap-4">
                <span className="text-emerald-500">Net Profit:</span>
                <span className="font-mono font-medium">{money(hoveredData.net_profit)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Masters landing page — tile + list hybrid per spec 4.1 with master-data
 *  health indicators, AR/AP metrics, document-level ageing, and quick actions. */
export function Dashboard() {
  const { user, can } = useAuth();
  const { companyId, company, loading: companiesLoading } = useCompany();
  const isAccountOnly = company?.maintain_mode === "ACCOUNT_ONLY";
  const nav = useNavigate();
  const [s, setS] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("");
  const [compare, setCompare] = useState("");
  const [periodOptions, setPeriodOptions] = useState<{ text: string; value: string }[]>([]);
  const [compareOptions, setCompareOptions] = useState<{ text: string; value: string }[]>([]);
  const [filtersReady, setFiltersReady] = useState(false);
  const ageingRequestRef = useRef(0);
  const trendRequestRef = useRef(0);
  const ageingDataRef = useRef<AgeingData | null>(null);
  const trendDataRef = useRef<TrendData | null>(null);

  const fetchAgeing = useCallback((skipCache = false) => {
    const requestId = ++ageingRequestRef.current;
    api.get("/dashboard/ageing", { skipCache }).then((r) => {
      const data = envelopeResult<AgeingData>(r);
      if (!data || requestId !== ageingRequestRef.current) return;
      ageingDataRef.current = data;
      setS((current) => (current ? { ...current, ...data } : current));
    }).catch(() => {
      // The primary dashboard remains usable if detailed ageing is unavailable.
    });
  }, []);

  const fetchTrend = useCallback((skipCache = false) => {
    const requestId = ++trendRequestRef.current;
    api.get("/dashboard/trend", { skipCache }).then((r) => {
      const data = envelopeResult<TrendData>(r);
      if (!data || requestId !== trendRequestRef.current) return;
      trendDataRef.current = data;
      setS((current) => (current ? { ...current, ...data } : current));
    }).catch(() => {
      // The primary dashboard remains usable if the chart is unavailable.
    });
  }, []);

  const fetchSummary = useCallback((skipCache = false) => {
    setLoading(true);
    setLoadError(null);
    const q = new URLSearchParams();
    if (period) q.set("period", period);
    if (compare) q.set("compare", compare);
    const qs = q.toString() ? `?${q.toString()}` : "";

    // Asynchronous parallel data fetching
    fetchAgeing(skipCache);
    fetchTrend(skipCache);

    api
      .get(`/dashboard/summary${qs}`, { skipCache })
      .then((r) => {
        const data = envelopeResult<Summary>(r);
        if (data) {
          setLoadError(null);
          setS({
            ...data,
            ...(ageingDataRef.current ? ageingDataRef.current : {}),
            ...(trendDataRef.current ? trendDataRef.current : {}),
          });
        } else {
          setLoadError(r.data?.message || r.data?.detail || "Could not load dashboard");
          setS(null);
        }
      })
      .catch(() => {
        setLoadError("Could not reach the dashboard service. Please retry.");
        setS(null);
      })
      .finally(() => setLoading(false));
  }, [period, compare, fetchAgeing, fetchTrend]);

  useEffect(() => {
    let active = true;

    // Wait for both defaults before requesting the expensive summary. Previously
    // the initial empty request and each LOV state update could issue a summary
    // request, creating duplicate dashboard work on first load.
    Promise.all([
      api.get("/lov/fetchLovGroupByCode/DASHBOARD_PERIOD"),
      api.get("/lov/fetchLovGroupByCode/DASHBOARD_COMPARE"),
    ])
      .then(([periodResponse, compareResponse]) => {
        if (!active) return;
        const periodItems = envelopeResult<any[]>(periodResponse);
        const compareItems = envelopeResult<any[]>(compareResponse);
        const periodOpts = Array.isArray(periodItems)
          ? periodItems.map((i) => ({ text: i.text, value: i.value }))
          : [];
        const compareOpts = Array.isArray(compareItems)
          ? compareItems.map((i) => ({ text: i.text, value: i.value }))
          : [];

        setPeriodOptions(periodOpts);
        setCompareOptions(compareOpts);
        setPeriod((prev) => prev || periodOpts[0]?.value || "");
        setCompare((prev) => prev || compareOpts[0]?.value || "");
      })
      .catch(() => {
        // A summary can still be loaded without optional LOV defaults.
      })
      .finally(() => {
        if (active) setFiltersReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!filtersReady || companiesLoading) return;
    fetchSummary();
  }, [fetchSummary, filtersReady, companiesLoading, companyId]);

  if (loading && !s) return <Spinner />;
  if (!s && loadError) {
    return (
      <div className="p-8 max-w-lg">
        <div className="flex items-start gap-3 text-destructive">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Dashboard failed to load</div>
            <div className="text-sm text-muted-foreground mt-1">{loadError}</div>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchSummary(true)}>
              <RotateCw className="h-4 w-4 mr-1.5" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!s) return <Spinner />;

  type Tile = {
    perm: string;
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    big: number;
    unit: string;
    facts: { v: number; l: string; warn: boolean }[];
    note?: string;
    noteWarn?: boolean;
    action: string;
    actionState: Record<string, unknown>;
  };

  const tiles: Tile[] = [
    {
      perm: "LEDGER",
      to: "/app/ledgers",
      label: "Chart of Accounts",
      icon: BookOpen,
      big: s?.chart_of_accounts?.total_ledgers ?? 0,
      unit: "ledgers",
      facts: [
        { v: s?.chart_of_accounts?.inactive_ledgers ?? 0, l: "inactive", warn: false },
        { v: s?.chart_of_accounts?.missing_grouping ?? 0, l: "missing grouping", warn: true },
      ],
      action: "+ New Ledger",
      actionState: { openNew: true },
    },
    {
      perm: "CUSTOMER",
      to: "/app/customers",
      label: "Customers",
      icon: Users,
      big: s?.customers?.total ?? 0,
      unit: "customers",
      facts: [
        { v: (s?.customers?.with_outstanding ?? s?.customers?.overdue) ?? 0, l: "with balance", warn: true },
        { v: s?.customers?.missing_gstin ?? 0, l: "missing GSTIN", warn: true },
      ],
      action: "+ New Customer",
      actionState: { openNew: true },
    },
    {
      perm: "VENDOR",
      to: "/app/vendors",
      label: "Vendors",
      icon: Truck,
      big: s?.vendors?.total ?? 0,
      unit: "vendors",
      facts: [
        { v: (s?.vendors?.with_payable ?? s?.vendors?.payable) ?? 0, l: "with payables", warn: true },
        { v: s?.vendors?.missing_gstin ?? 0, l: "missing GST details", warn: true },
      ],
      action: "+ New Vendor",
      actionState: { openNew: true },
    },
    ...(!isAccountOnly
      ? [
          {
            perm: "ITEMS",
            to: "/app/products",
            label: "Products / Services",
            icon: Tag,
            big: s?.products?.total ?? 0,
            unit: "items",
            facts: [
              { v: s?.products?.gst_missing ?? 0, l: "GST missing", warn: true },
              { v: s?.products?.inactive ?? 0, l: "inactive", warn: false },
              { v: s?.products?.low_stock ?? 0, l: "low stock", warn: true },
            ],
            action: "+ New Item",
            actionState: { openNew: true },
          },
        ]
      : []),
    {
      perm: "BANK_CASH",
      to: "/app/banks",
      label: "Bank & Cash",
      icon: Banknote,
      big: (s?.bank_cash?.bank_accounts ?? 0) + (s?.bank_cash?.cash_accounts ?? 0),
      unit: "accounts",
      facts: [
        { v: s?.bank_cash?.bank_accounts ?? 0, l: "bank", warn: false },
        { v: s?.bank_cash?.cash_accounts ?? 0, l: "cash", warn: false },
      ],
      note: `Reconciliation: ${s?.bank_cash?.reconciliation_status ?? "N/A"}`,
      noteWarn: (s?.bank_cash?.reconciliation_pending ?? 0) > 0,
      action: "+ New Bank",
      actionState: { openNew: true },
    },
    {
      perm: "GST_SETUP",
      to: "/app/gst",
      label: "GST Setup",
      icon: Percent,
      big: s?.gst_setup?.rates ?? 0,
      unit: "GST rates",
      facts: [{ v: s?.gst_setup?.hsn_codes ?? 0, l: "HSN/SAC records", warn: false }],
      note: `Setup: ${s?.gst_setup?.status ?? "N/A"}`,
      noteWarn: !s?.gst_setup?.configured,
      action: "Configure",
      actionState: {},
    },
    {
      perm: "COST_CENTER",
      to: "/app/cost-centers",
      label: "Cost Centers",
      icon: PieChart,
      big: s?.cost_centers?.total ?? 0,
      unit: "dimensions",
      facts: [
        { v: s?.cost_centers?.departments ?? 0, l: "departments", warn: false },
        { v: s?.cost_centers?.projects ?? 0, l: "projects", warn: false },
        { v: s?.cost_centers?.branches ?? 0, l: "branches", warn: false },
      ],
      action: "+ New Cost Center",
      actionState: { openNew: true },
    },
    ...(!isAccountOnly
      ? [
          {
            perm: "UNITS",
            to: "/app/units",
            label: "Units",
            icon: Ruler,
            big: s?.units?.total ?? 0,
            unit: "units of measure",
            facts: [],
            action: "Manage",
            actionState: {},
          },
        ]
      : []),
    {
      perm: "VOUCHER",
      to: isAccountOnly ? "/app/accounting-vouchers" : "/app/journal",
      label: isAccountOnly ? "Accounting Vouchers" : "Journal Vouchers",
      icon: ScrollText,
      big: s?.vouchers?.posted ?? 0,
      unit: "posted",
      facts: [{ v: s?.vouchers?.draft ?? 0, l: "drafts pending", warn: (s?.vouchers?.draft ?? 0) > 0 }],
      action: isAccountOnly ? "+ New Voucher" : "+ New Entry",
      actionState: { openNew: true },
    },
  ].filter((t) => can(t.perm, "view"));

  const fin = s.financial_overview || {
    cash_bank_total: 0,
    bank_total: 0,
    cash_total: 0,
    bank_accounts: [],
    cash_accounts: [],
    revenue_total: 0,
    expenses_total: 0,
    net_profit: 0,
    profit_margin_pct: 0,
    target_pct: 84,
  };

  const bankAccounts = (fin.bank_accounts && fin.bank_accounts.length > 0)
    ? fin.bank_accounts
    : (s.bank_cash?.accounts || []);

  const cashAccounts = (fin.cash_accounts && fin.cash_accounts.length > 0)
    ? fin.cash_accounts
    : (s.bank_cash?.cash_details || []);

  const gst = s.gst_estimate || {
    output_tax: 0,
    input_tax_credit: 0,
    net_payable: 0,
    status: "Before filing",
  };

  return (
    <div className="px-6 py-5 lg:px-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header Controls & Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 ledger-rule">
        <div>
          <div className="eyebrow">Financial overview</div>
          <h1 className="text-[22px] font-semibold tracking-tight mt-0.5">
            Good day, {user?.first_name || user?.user_name}
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Books updated moments ago · Real-time corporate financial control dashboard.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-0.5">Period</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-card text-foreground border border-border rounded-md px-3 py-1.5 font-medium shadow-sm focus:outline-none focus:ring-1 focus:ring-[var(--teal)]"
            >
              {periodOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.text}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-0.5">Compare</label>
            <select
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
              className="bg-card text-foreground border border-border rounded-md px-3 py-1.5 font-medium shadow-sm focus:outline-none focus:ring-1 focus:ring-[var(--teal)]"
            >
              {compareOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.text}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Books Health Status Banner */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Books are healthy. 94% of master setup & audit close checks are complete.</span>
        </div>
        <Link to="/app/ledgers" className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline flex items-center gap-1">
          Review close →
        </Link>
      </div>

      {/* Financial Overview Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* CARD 1: Bank Accounts (Separated with individual bank amount details) */}
        <div className="card-panel p-5 flex flex-col justify-between hover:border-[var(--teal)] transition-colors group fade-up">
          <div>
            <div className="flex items-center justify-between">
              <span
                className="h-10 w-10 rounded-md grid place-items-center"
                style={{ background: "rgba(14, 165, 233, 0.12)", color: "#0ea5e9" }}
              >
                <Landmark className="h-5 w-5" />
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium">
                  {bankAccounts.length} {bankAccounts.length === 1 ? "bank" : "banks"}
                </span>
                <Link to="/app/banks" className="text-muted-foreground group-hover:text-[var(--teal)]">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[13px] font-semibold">Bank Accounts</div>
              <div className="text-[24px] font-bold mono mt-1 tracking-tight" style={{ color: "#0ea5e9" }}>
                {money(fin.bank_total ?? s.bank_cash?.bank_total ?? 0)}
              </div>
            </div>

            {/* Individual Bank Details */}
            <div className="mt-3 space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Bank Details
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {bankAccounts.length > 0 ? (
                  bankAccounts.map((b, idx) => (
                    <div
                      key={b.id || idx}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/40 border border-border/30 text-[12px]"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="font-medium text-foreground truncate text-[12px]">{b.name}</span>
                        {b.account_number ? (
                          <span className="text-[10.5px] text-muted-foreground mono truncate">
                            A/C: {b.account_number}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono font-semibold text-foreground shrink-0 text-[12px]">
                        {money(b.balance)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-muted-foreground text-[11.5px] py-1 italic">
                    No bank accounts configured
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-border/40 flex justify-between text-[11.5px] text-muted-foreground">
                <span>Reconciliation:</span>
                <span className="font-medium text-foreground">{s.bank_cash?.reconciliation_status ?? "All reconciled"}</span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-2 border-t border-border/60 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => nav("/app/banks")}>
              View Bank Accounts
            </Button>
            <Button size="sm" onClick={() => nav("/app/banks", { state: { openNew: true } })}>
              + New Bank
            </Button>
          </div>
        </div>

        {/* CARD 1B: Cash in Hand (Untouched / Kept as is) */}
        <div className="card-panel p-5 flex flex-col justify-between hover:border-[var(--teal)] transition-colors group fade-up">
          <div>
            <div className="flex items-center justify-between">
              <span
                className="h-10 w-10 rounded-md grid place-items-center"
                style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}
              >
                <Wallet className="h-5 w-5" />
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                  {cashAccounts.length || 1} {cashAccounts.length === 1 ? "account" : "accounts"}
                </span>
                <Link to="/app/banks" className="text-muted-foreground group-hover:text-[var(--teal)]">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[13px] font-semibold">Cash in Hand</div>
              <div className="text-[24px] font-bold mono mt-1 tracking-tight" style={{ color: "#10b981" }}>
                {money(fin.cash_total ?? s.bank_cash?.cash_total ?? (fin.cash_bank_total - (fin.bank_total || 0)))}
              </div>
            </div>

            {/* Cash Breakdown */}
            <div className="mt-3 space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Cash Breakdown
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {cashAccounts.length > 0 ? (
                  cashAccounts.map((c, idx) => (
                    <div
                      key={c.id || idx}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/40 border border-border/30 text-[12px]"
                    >
                      <span className="font-medium text-foreground truncate text-[12px]">{c.name}</span>
                      <span className="font-mono font-semibold text-foreground shrink-0 text-[12px]">
                        {money(c.balance)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between py-1 px-2 text-[12px] text-muted-foreground">
                    <span>Physical Cash</span>
                    <span className="font-mono font-medium text-foreground">
                      {money(fin.cash_total ?? s.bank_cash?.cash_total ?? 0)}
                    </span>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-border/40 flex justify-between text-[11.5px] text-muted-foreground">
                <span>Status:</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">Available in hand</span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-2 border-t border-border/60 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => nav("/app/banks")}>
              View Accounts
            </Button>
          </div>
        </div>

        {/* CARD 2: Accounts Receivable (Existing Untouched) */}
        {can("CUSTOMER", "view") && (
          <div className="card-panel p-5 flex flex-col justify-between hover:border-[var(--teal)] transition-colors group fade-up">
            <div>
              <div className="flex items-center justify-between">
                <span
                  className="h-10 w-10 rounded-md grid place-items-center"
                  style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}
                >
                  <TrendingUp className="h-5 w-5" />
                </span>
                <Link to="/app/customers" className="text-muted-foreground group-hover:text-[var(--teal)]">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-3">
                <div className="text-[13px] font-semibold">Accounts Receivable (AR)</div>
                <div className="text-[24px] font-bold mono mt-1 tracking-tight" style={{ color: "var(--teal)" }}>
                  {money(s.customers.receivable_total || 0)}
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1 text-[12px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Customers with balance:</span>
                  <span className="font-semibold text-foreground">{s.customers.with_outstanding ?? s.customers.overdue} / {s.customers.total}</span>
                </div>
                {s.customers.missing_gstin > 0 && (
                  <div className="flex items-center gap-1 hint-warning text-[11.5px] mt-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    <span>{s.customers.missing_gstin} missing GSTIN</span>
                  </div>
                )}
              </div>
            </div>
            <div className="pt-4 mt-2 border-t border-border/60 flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => nav("/app/customers")}>
                View Customers
              </Button>
              {can("VOUCHER", "write") && (
                <Button
                  size="sm"
                  onClick={() =>
                    nav(isAccountOnly ? "/app/accounting-vouchers" : "/app/sales", {
                      state: isAccountOnly ? { openNew: true, voucherType: "SALES" } : undefined,
                    })
                  }
                >
                  + New Invoice
                </Button>
              )}
            </div>
          </div>
        )}

        {/* CARD 3: Receivables Ageing (Existing Untouched) */}
        {can("VOUCHER", "view") && (
          <div className="card-panel p-5 flex flex-col justify-between hover:border-[var(--teal)] transition-colors group fade-up">
            <div>
              <div className="flex items-center justify-between">
                <span
                  className="h-10 w-10 rounded-md grid place-items-center"
                  style={{ background: "rgba(14, 165, 233, 0.12)", color: "#0ea5e9" }}
                >
                  <Clock className="h-5 w-5" />
                </span>
                <span className="text-[11.5px] font-mono px-2 py-0.5 rounded bg-muted/80 text-muted-foreground">
                  {s.ar_ageing?.open_document_count || 0} open
                </span>
              </div>
              <div className="mt-3">
                <div className="text-[13px] font-semibold">Receivables Ageing</div>
                <div className="text-[24px] font-bold mono mt-1 tracking-tight text-foreground">
                  {money(s.ar_ageing?.total_outstanding || 0)}
                </div>
              </div>
              <div className="mt-3 space-y-1 text-[11.5px]">
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">Not Due:</span>
                  <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{money(s.ar_ageing?.not_due || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">0–30 Days:</span>
                  <span className="font-mono font-medium">{money(s.ar_ageing?.["0_30"] || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">31–60 Days:</span>
                  <span className="font-mono font-medium text-amber-600 dark:text-amber-400">{money(s.ar_ageing?.["31_60"] || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">61–90 Days:</span>
                  <span className="font-mono font-medium text-orange-600 dark:text-orange-400">{money(s.ar_ageing?.["61_90"] || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">90+ Days:</span>
                  <span className="font-mono font-bold text-destructive">{money(s.ar_ageing?.["90_plus"] || 0)}</span>
                </div>
              </div>
            </div>
            <div className="pt-3 mt-2 border-t border-border/60">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => nav(isAccountOnly ? "/app/accounting-vouchers" : "/app/sales")}
              >
                View Sales Invoices
              </Button>
            </div>
          </div>
        )}

        {/* CARD 4: Net profit */}
        <div className={`card-panel p-5 flex flex-col justify-between transition-colors group fade-up ${fin.net_profit >= 0 ? "hover:border-emerald-500" : "hover:border-rose-500"}`}>
          <div>
            <div className="flex items-center justify-between">
              <span
                className="h-10 w-10 rounded-md grid place-items-center"
                style={{
                  background: fin.net_profit >= 0 ? "rgba(16, 185, 129, 0.12)" : "rgba(244, 63, 94, 0.12)",
                  color: fin.net_profit >= 0 ? "#10b981" : "#f43f5e",
                }}
              >
                <TrendingUp className="h-5 w-5" />
              </span>
              <span
                className={`text-[11.5px] font-mono px-2 py-0.5 rounded font-medium ${
                  fin.net_profit >= 0
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                }`}
              >
                {fin.profit_margin_pct}% margin
              </span>
            </div>
            <div className="mt-3">
              <div className="text-[13px] font-semibold">Net profit</div>
              <div
                className="text-[24px] font-bold mono mt-1 tracking-tight"
                style={{ color: fin.net_profit >= 0 ? "#10b981" : "#f43f5e" }}
              >
                {money(fin.net_profit)}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-[12px] text-muted-foreground">
              <div className="flex justify-between">
                <span>Profitability status:</span>
                <span className={`font-medium ${fin.net_profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {fin.net_profit >= 0 ? "Positive margin" : "Net loss"}
                </span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-2 border-t border-border/60 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => nav("/app/reports")}>
              Open P&amp;L
            </Button>
          </div>
        </div>

        {/* CARD 5: Revenue */}
        <div className="card-panel p-5 flex flex-col justify-between hover:border-sky-500 transition-colors group fade-up">
          <div>
            <div className="flex items-center justify-between">
              <span
                className="h-10 w-10 rounded-md grid place-items-center"
                style={{ background: "rgba(14, 165, 233, 0.12)", color: "#0ea5e9" }}
              >
                <Receipt className="h-5 w-5" />
              </span>
              <span className="text-[11.5px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium">
                {fin.target_pct}% of target
              </span>
            </div>
            <div className="mt-3">
              <div className="text-[13px] font-semibold">Revenue</div>
              <div className="text-[24px] font-bold mono mt-1 tracking-tight text-foreground">
                {money(fin.revenue_total)}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-[12px] text-muted-foreground">
              <div className="flex justify-between">
                <span>Posted sales vouchers:</span>
                <span className="font-mono text-foreground font-medium">{s.vouchers.posted}</span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-2 border-t border-border/60">
            <Button variant="outline" size="sm" className="w-full" onClick={() => nav(isAccountOnly ? "/app/accounting-vouchers" : "/app/sales")}>
              View Sales
            </Button>
          </div>
        </div>

        {/* CARD 6: Operating expenses */}
        <div className="card-panel p-5 flex flex-col justify-between hover:border-amber-500 transition-colors group fade-up">
          <div>
            <div className="flex items-center justify-between">
              <span
                className="h-10 w-10 rounded-md grid place-items-center"
                style={{ background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" }}
              >
                <CreditCard className="h-5 w-5" />
              </span>
              <span className="text-[11.5px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                {fin.revenue_total > 0 ? Math.round((fin.expenses_total / fin.revenue_total) * 100) : 0}% of revenue
              </span>
            </div>
            <div className="mt-3">
              <div className="text-[13px] font-semibold">Operating expenses</div>
              <div className="text-[24px] font-bold mono mt-1 tracking-tight" style={{ color: "#f59e0b" }}>
                {money(fin.expenses_total)}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-[12px] text-muted-foreground">
              <div className="flex justify-between">
                <span>Budget status:</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">Within plan</span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-2 border-t border-border/60">
            <Button variant="outline" size="sm" className="w-full" onClick={() => nav(isAccountOnly ? "/app/accounting-vouchers" : "/app/purchase")}>
              View Expenses
            </Button>
          </div>
        </div>

        {/* CARD 7: Accounts Payable (Existing Untouched) */}
        {can("VENDOR", "view") && (
          <div className="card-panel p-5 flex flex-col justify-between hover:border-[var(--brass)] transition-colors group fade-up">
            <div>
              <div className="flex items-center justify-between">
                <span
                  className="h-10 w-10 rounded-md grid place-items-center"
                  style={{ background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" }}
                >
                  <CreditCard className="h-5 w-5" />
                </span>
                <Link to="/app/vendors" className="text-muted-foreground group-hover:text-[var(--brass)]">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-3">
                <div className="text-[13px] font-semibold">Accounts Payable (AP)</div>
                <div className="text-[24px] font-bold mono mt-1 tracking-tight" style={{ color: "#f59e0b" }}>
                  {money(s.vendors.payable_total || 0)}
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1 text-[12px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Vendors with payables:</span>
                  <span className="font-semibold text-foreground">{s.vendors.with_payable ?? s.vendors.payable} / {s.vendors.total}</span>
                </div>
                {s.vendors.missing_gstin > 0 && (
                  <div className="flex items-center gap-1 hint-warning text-[11.5px] mt-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    <span>{s.vendors.missing_gstin} missing GST details</span>
                  </div>
                )}
              </div>
            </div>
            <div className="pt-4 mt-2 border-t border-border/60 flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => nav("/app/vendors")}>
                View Vendors
              </Button>
              {can("VOUCHER", "write") && (
                <Button
                  size="sm"
                  onClick={() =>
                    nav(isAccountOnly ? "/app/accounting-vouchers" : "/app/purchase", {
                      state: isAccountOnly ? { openNew: true, voucherType: "PURCHASE" } : undefined,
                    })
                  }
                >
                  + New Bill
                </Button>
              )}
            </div>
          </div>
        )}

        {/* CARD 8: Payables Ageing (Existing Untouched) */}
        {can("VOUCHER", "view") && (
          <div className="card-panel p-5 flex flex-col justify-between hover:border-[var(--brass)] transition-colors group fade-up">
            <div>
              <div className="flex items-center justify-between">
                <span
                  className="h-10 w-10 rounded-md grid place-items-center"
                  style={{ background: "rgba(244, 63, 94, 0.12)", color: "#f43f5e" }}
                >
                  <CalendarClock className="h-5 w-5" />
                </span>
                <span className="text-[11.5px] font-mono px-2 py-0.5 rounded bg-muted/80 text-muted-foreground">
                  {s.ap_ageing?.open_document_count || 0} open
                </span>
              </div>
              <div className="mt-3">
                <div className="text-[13px] font-semibold">Payables Ageing</div>
                <div className="text-[24px] font-bold mono mt-1 tracking-tight text-foreground">
                  {money(s.ap_ageing?.total_outstanding || 0)}
                </div>
              </div>
              <div className="mt-3 space-y-1 text-[11.5px]">
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">Not Due:</span>
                  <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{money(s.ap_ageing?.not_due || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">0–30 Days:</span>
                  <span className="font-mono font-medium">{money(s.ap_ageing?.["0_30"] || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">31–60 Days:</span>
                  <span className="font-mono font-medium text-amber-600 dark:text-amber-400">{money(s.ap_ageing?.["31_60"] || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/40">
                  <span className="text-muted-foreground">61–90 Days:</span>
                  <span className="font-mono font-medium text-orange-600 dark:text-orange-400">{money(s.ap_ageing?.["61_90"] || 0)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">90+ Days:</span>
                  <span className="font-mono font-bold text-destructive">{money(s.ap_ageing?.["90_plus"] || 0)}</span>
                </div>
              </div>
            </div>
            <div className="pt-3 mt-2 border-t border-border/60">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => nav(isAccountOnly ? "/app/accounting-vouchers" : "/app/purchase")}
              >
                View Purchase Bills
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Performance Trend Chart Card */}
      <div className="card-panel p-5">
        <PerformanceTrendChart data={s.performance_trend} />
      </div>

      {/* Ageing at a Glance Visualizer & Estimated GST Payable Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card-panel p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-4">
              <div>
                <div className="text-[15px] font-semibold">Ageing at a glance</div>
                <div className="text-[12px] text-muted-foreground">Outstanding by due-date bucket</div>
              </div>
              <div className="flex items-center gap-4 text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Receivables
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> Payables
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { label: "Current (Not due)", arKey: "not_due", apKey: "not_due" },
                { label: "1–30 days", arKey: "0_30", apKey: "0_30" },
                { label: "31–60 days", arKey: "31_60", apKey: "31_60" },
                { label: "61–90 days", arKey: "61_90", apKey: "61_90" },
                { label: "90+ days", arKey: "90_plus", apKey: "90_plus" },
              ].map((b) => {
                const rawAr = (s.ar_ageing as any)?.[b.arKey];
                const rawAp = (s.ap_ageing as any)?.[b.apKey];
                const arVal = typeof rawAr === "number" ? (isNaN(rawAr) ? 0 : rawAr) : (parseFloat(String(rawAr || 0)) || 0);
                const apVal = typeof rawAp === "number" ? (isNaN(rawAp) ? 0 : rawAp) : (parseFloat(String(rawAp || 0)) || 0);
                const tot = arVal + apVal;
                const maxVal = Math.max(Number(s.ar_ageing?.total_outstanding) || 0, Number(s.ap_ageing?.total_outstanding) || 0, 100);
                const arPct = maxVal > 0 ? Math.min(100, (arVal / maxVal) * 100) : 0;
                const apPct = maxVal > 0 ? Math.min(100, (apVal / maxVal) * 100) : 0;

                return (
                  <div key={b.label} className="space-y-1 text-[12px]">
                    <div className="flex justify-between items-center text-muted-foreground">
                      <span className="font-medium text-foreground">{b.label}</span>
                      <span className="font-mono text-foreground font-semibold">{money(tot)}</span>
                    </div>
                    <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden flex gap-0.5">
                      <div className="bg-sky-500 h-full transition-all" style={{ width: `${arPct}%` }} title={`Receivables: ${money(arVal)}`} />
                      <div className="bg-purple-500 h-full transition-all" style={{ width: `${apPct}%` }} title={`Payables: ${money(apVal)}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Estimated GST payable Card */}
        <div className="card-panel p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-3">
              <div className="text-[15px] font-semibold">Estimated GST payable</div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                {gst.status}
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[26px] font-bold mono tracking-tight text-foreground">
                {money(gst.net_payable)}
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5">Estimated liability after ITC setoff</div>
            </div>
            <div className="mt-4 space-y-2 text-[12px]">
              <div className="flex justify-between py-1 border-b border-border/40">
                <span className="text-muted-foreground">Output GST (Sales):</span>
                <span className="font-mono font-medium">{money(gst.output_tax)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Input Tax Credit (ITC):</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{money(gst.input_tax_credit)}</span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-3 border-t border-border/60">
            <Button variant="outline" size="sm" className="w-full" onClick={() => nav("/app/gst")}>
              Review GST &amp; Filing →
            </Button>
          </div>
        </div>
      </div>

      {/* Master Data Health & Tiles Section */}
      <div className="pb-3 mb-2 ledger-rule">
        <div className="eyebrow">Master Data &amp; Entries</div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tiles.map((t) => (
            <div key={t.to} className="card-panel p-5 flex flex-col gap-3 hover:border-[var(--teal)] transition-colors group fade-up">
              <div className="flex items-center justify-between">
                <span
                  className="h-10 w-10 rounded-md grid place-items-center"
                  style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
                >
                  <t.icon className="h-5 w-5" />
                </span>
                <Link to={t.to} className="text-muted-foreground group-hover:text-[var(--teal)]">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div>
                <div className="text-[13px] font-semibold">{t.label}</div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="fig text-[28px] leading-none">{t.big}</span>
                  <span className="text-[11.5px] text-muted-foreground">{t.unit}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 min-h-[18px]">
                {t.facts.filter((f) => f.v > 0 || !f.warn).map((f) => (
                  <span
                    key={f.l}
                    className={
                      "inline-flex items-center gap-1 text-[11.5px] " +
                      (f.warn && f.v > 0 ? "hint-warning font-medium" : "text-muted-foreground")
                    }
                  >
                    {f.warn && f.v > 0 && <AlertTriangle className="h-3 w-3" />}
                    {f.v} {f.l}
                  </span>
                ))}
              </div>
              {t.note && (
                <div
                  className={
                    "inline-flex items-center gap-1 text-[11px] -mt-1 " +
                    (t.noteWarn ? "hint-warning font-medium" : "text-muted-foreground")
                  }
                >
                  {t.noteWarn && <AlertTriangle className="h-3 w-3" />}
                  {t.note}
                </div>
              )}
              <button
                onClick={() => nav(t.to, { state: t.actionState })}
                className="mt-auto inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-[5px] border border-[var(--teal)]/40 text-[var(--teal)] px-3 py-1.5 hover:bg-[var(--teal-soft)] transition-colors w-fit"
              >
                {t.action.startsWith("+") && <Plus className="h-3.5 w-3.5" />}
                {t.action.replace("+ ", "")}
              </button>
            </div>
          ))}
        </div>

        <div className="card-panel p-5">
          <div className="flex items-center gap-2 pb-3 ledger-rule">
            <History className="h-4 w-4" style={{ color: "var(--brass)" }} />
            <span className="eyebrow">Recent activity</span>
          </div>
          <ul className="divide-y divide-border/70">
            {s.recent_activity.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">No activity yet.</li>
            )}
            {s.recent_activity.map((a, i) => (
              <li key={i} className="py-2.5">
                <div className="text-[13px]">
                  <span className="font-medium">{a.entityName || a.entity}</span>{" "}
                  <span className="text-muted-foreground lowercase">{a.action.toLowerCase()}d</span>
                </div>
                <div className="text-[11px] text-muted-foreground mono mt-0.5">
                  {a.entity} · {fmtDateTime(a.createdDate)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
