import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Scale,
  TrendingUp,
  Landmark,
  Wallet,
  BookText,
  Download,
  Printer,
  GripVertical,
} from "lucide-react";
import { api, envelopeResult } from "../lib/api";
import { useCompany } from "../auth/CompanyContext";
import { money, fmtDate } from "../lib/format";
import { downloadCSV } from "../lib/csv";
import {
  PageHeader,
  Panel,
  Button,
  DatePicker,
  TableWrap,
  Th,
  Td,
  EmptyRow,
  Badge,
  Spinner,
  Drawer,
  Money,
} from "../components/ui";

type ReportKey =
  | "trial-balance"
  | "profit-loss"
  | "balance-sheet"
  | "cash-book"
  | "bank-book"
  | "day-book";

const REPORTS: { key: ReportKey; label: string; icon: any; range: "asOn" | "period" }[] = [
  { key: "trial-balance", label: "Trial Balance", icon: Scale, range: "period" },
  { key: "profit-loss", label: "Profit & Loss", icon: TrendingUp, range: "period" },
  { key: "balance-sheet", label: "Balance Sheet", icon: Landmark, range: "period" },
  { key: "cash-book", label: "Cash Book", icon: Wallet, range: "period" },
  { key: "bank-book", label: "Bank Book", icon: Landmark, range: "period" },
  { key: "day-book", label: "Day Book", icon: BookText, range: "period" },
];

function fyStart(): string {
  const t = new Date();
  const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  return `${y}-04-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Reports() {
  const loc = useLocation();
  const { companyId, company } = useCompany();
  const [active, setActive] = useState<ReportKey>(
    ((loc.state as any)?.report as ReportKey) || "trial-balance"
  );
  const [fromDate, setFromDate] = useState(fyStart());
  const [toDate, setToDate] = useState(today());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [stmtFor, setStmtFor] = useState<{ id: string; name: string } | null>(null);
  const [stmt, setStmt] = useState<any>(null);
  const [balanceSheetOrder, setBalanceSheetOrder] = useState<{
    liabilities?: any[];
    assets?: any[];
  }>({});

  const def = REPORTS.find((r) => r.key === active)!;

  async function run() {
    setLoading(true);
    const params =
      def.range === "asOn"
        ? `?to_date=${toDate}`
        : `?from_date=${fromDate}&to_date=${toDate}`;
    const r = await api.get(`/reports/${active}${params}`);
    const res = envelopeResult<any>(r);
    setData(res);
    if (active === "balance-sheet" && res) {
      setBalanceSheetOrder({
        liabilities: res.liabilities || [],
        assets: res.assets || [],
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, fromDate, toDate, companyId]);

  async function openStatement(id: string, name: string) {
    setStmtFor({ id, name });
    setStmt(null);
    const r = await api.get(`/reports/ledger/${id}?from_date=${fromDate}&to_date=${toDate}`);
    setStmt(envelopeResult<any>(r));
  }

  function handleBalanceSheetReorder(side: "liabilities" | "assets", items: any[]) {
    setBalanceSheetOrder((prev) => ({
      ...prev,
      [side]: items,
    }));
  }

  function exportPDF() {
    window.print();
  }

  return (
    <PageHeader
      title="Reports"
      sub="Financial statements and books — generated live from posted vouchers"
      actions={
        <div className="flex items-center gap-2 print:hidden">
          {def.range === "period" && (
            <DatePicker className="w-[145px]" value={fromDate} onChange={(val) => setFromDate(val)} />
          )}
          <span className="text-muted-foreground text-sm">
            {def.range === "period" ? "to" : "as on"}
          </span>
          <DatePicker className="w-[145px]" value={toDate} onChange={(val) => setToDate(val)} />
          <div className="flex items-center gap-1.5 ml-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportReport(active, data, def.label, balanceSheetOrder)}
              disabled={!data}
              title="Export CSV with preserved side-by-side structure"
            >
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportPDF}
              disabled={!data}
              title="Export PDF / Print with preserved UI layout"
            >
              <Printer className="h-4 w-4 mr-1.5" />
              PDF
            </Button>
          </div>
        </div>
      }
    >
      {/* Print-only executive report header */}
      <div className="hidden print:block mb-5 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {company?.company_name || "CAAI DEMO SERVICES PVT LTD"}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              ImmBiz Books · Financial Statements
            </p>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold">{def.label.toUpperCase()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {def.range === "period"
                ? `${fmtDate(fromDate)} to ${fmtDate(toDate)}`
                : `As on ${fmtDate(toDate)}`}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[200px_1fr] gap-4 items-start report-print-container">
        <div className="card-panel p-2 print:hidden">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => setActive(r.key)}
              className={
                "w-full flex items-center gap-2.5 rounded-[5px] px-3 py-2 text-[13px] text-left transition-colors " +
                (active === r.key
                  ? "bg-[var(--teal-soft)] text-[var(--teal)] font-semibold"
                  : "hover:bg-muted")
              }
            >
              <r.icon className="h-4 w-4 shrink-0" />
              {r.label}
            </button>
          ))}
        </div>

        <div className="report-print-area">
          {loading || !data ? (
            <Spinner />
          ) : active === "trial-balance" ? (
            <TrialBalanceView data={data} onLedger={openStatement} />
          ) : active === "profit-loss" ? (
            <ProfitLossView data={data} onLedger={openStatement} />
          ) : active === "balance-sheet" ? (
            <BalanceSheetView
              data={data}
              onLedger={openStatement}
              onSelectReport={setActive}
              onReorder={handleBalanceSheetReorder}
            />
          ) : active === "day-book" ? (
            <DayBookView data={data} />
          ) : (
            <CashBankView data={data} label={def.label} onLedger={openStatement} />
          )}
        </div>
      </div>

      <Drawer
        open={!!stmtFor}
        onClose={() => setStmtFor(null)}
        wide
        title={stmtFor ? `Ledger — ${stmtFor.name}` : ""}
        desc={`Transactions from posted vouchers · ${fmtDate(fromDate)} to ${fmtDate(toDate)}`}
      >
        {!stmt ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <Stat l="Opening" v={stmt.openingBalance} />
              <Stat
                l="Total Debits"
                v={(stmt.lines || []).reduce(
                  (s: number, l: any) => s + (Number(l.debit) || 0),
                  0
                )}
              />
              <Stat
                l="Total Credits"
                v={(stmt.lines || []).reduce(
                  (s: number, l: any) => s + (Number(l.credit) || 0),
                  0
                )}
              />
              <Stat l="Closing" v={stmt.closingBalance} />
            </div>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Voucher</Th>
                  <Th>Date</Th>
                  <Th>Narration</Th>
                  <Th right>Debit</Th>
                  <Th right>Credit</Th>
                  <Th right>Balance</Th>
                </tr>
              </thead>
              <tbody>
                {(stmt.lines || []).length === 0 && (
                  <EmptyRow colSpan={6} text="No transactions in this period." />
                )}
                {(stmt.lines || []).map((l: any, i: number) => (
                  <tr key={i}>
                    <Td className="mono font-medium text-[var(--teal)]">{l.voucherNo}</Td>
                    <Td>{fmtDate(l.voucherDate)}</Td>
                    <Td className="max-w-[240px] truncate">
                      <span title={l.narration || undefined}>{l.narration || "—"}</span>
                    </Td>
                    <Td right>{l.debit ? <Money v={l.debit} /> : "—"}</Td>
                    <Td right>{l.credit ? <Money v={l.credit} /> : "—"}</Td>
                    <Td right className="fig font-medium">
                      {money(l.balance)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </Drawer>
    </PageHeader>
  );
}

function Stat({ l, v, plain }: { l: string; v: number; plain?: boolean }) {
  return (
    <div className="rounded-[5px] border border-border bg-muted/30 px-3.5 py-3">
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{l}</div>
      <div className="fig text-lg mt-0.5">{plain ? v : money(v)}</div>
    </div>
  );
}

function TrialBalanceView({
  data,
  onLedger,
}: {
  data: any;
  onLedger: (id: string, name: string) => void;
}) {
  const periodTitle =
    data.fromDate && data.toDate
      ? ` · ${fmtDate(data.fromDate)} – ${fmtDate(data.toDate)}`
      : data.asOn
      ? ` as on ${fmtDate(data.asOn)}`
      : "";

  return (
    <Panel
      pad={false}
      title={`Trial Balance${periodTitle}`}
      right={
        <Badge tone={data.balanced ? "ok" : "bad"}>
          {data.balanced ? "Balanced" : "Out of balance"}
        </Badge>
      }
    >
      <TableWrap>
        <thead>
          <tr>
            <Th>Ledger</Th>
            <Th>Group</Th>
            <Th right>Debit</Th>
            <Th right>Credit</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 && (
            <EmptyRow colSpan={4} text="No balances yet — post some vouchers." />
          )}
          {data.rows.map((r: any) => (
            <tr
              key={r.ledgerId}
              className="hover:bg-muted/40 cursor-pointer transition-colors"
              onClick={() => onLedger(r.ledgerId, r.ledger)}
              title="Click to view ledger transactions"
            >
              <Td className="font-medium text-foreground hover:text-[var(--teal)]">{r.ledger}</Td>
              <Td className="text-muted-foreground text-[12px]">{r.group}</Td>
              <Td right>{r.debit ? <Money v={r.debit} /> : "—"}</Td>
              <Td right>{r.credit ? <Money v={r.credit} /> : "—"}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="ledger-rule-strong bg-muted/40 font-semibold">
            <td
              colSpan={2}
              className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Total
            </td>
            <td className="px-4 py-2.5 text-right fig">{money(data.totalDebit)}</td>
            <td className="px-4 py-2.5 text-right fig">{money(data.totalCredit)}</td>
          </tr>
        </tfoot>
      </TableWrap>
    </Panel>
  );
}

function ProfitLossView({
  data,
  onLedger,
}: {
  data: any;
  onLedger: (id: string, name: string) => void;
}) {
  // Net profit is placed on the expenses side only; Net loss placed on income side only.
  const expenseRows = useMemo(() => {
    const list = [...(data.expense || [])];
    if (data.isProfit) {
      list.push({
        ledgerId: "",
        ledger: "Net Profit",
        group: "Transferred to Capital Account",
        amount: data.netProfit,
        isNet: true,
      });
    }
    return list;
  }, [data.expense, data.isProfit, data.netProfit]);

  const incomeRows = useMemo(() => {
    const list = [...(data.income || [])];
    if (!data.isProfit && Math.abs(data.netProfit) > 0.005) {
      list.push({
        ledgerId: "",
        ledger: "Net Loss",
        group: "Transferred to Capital Account",
        amount: Math.abs(data.netProfit),
        isNet: true,
      });
    }
    return list;
  }, [data.income, data.isProfit, data.netProfit]);

  // Both sides balance out to the balanced total in standard financial reporting
  const balancedTotal = Math.max(data.incomeTotal || 0, data.expenseTotal || 0);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 print:grid-cols-2 print-side-by-side gap-4">
        <Panel pad={false} title="Expenses">
          <TableWrap>
            <thead>
              <tr>
                <Th>Ledger</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {expenseRows.length === 0 && (
                <EmptyRow colSpan={2} text="No expenses in this period." />
              )}
              {expenseRows.map((r: any, i: number) => (
                <tr
                  key={r.ledgerId || r.ledger + i}
                  className={
                    r.isNet
                      ? "bg-emerald-50/70 dark:bg-emerald-950/20 font-semibold text-emerald-900 dark:text-emerald-300"
                      : "hover:bg-muted/40 cursor-pointer transition-colors"
                  }
                  onClick={() => {
                    if (!r.isNet && r.ledgerId) onLedger(r.ledgerId, r.ledger);
                  }}
                  title={r.isNet ? "Net Profit" : "Click to view ledger transactions"}
                >
                  <Td>
                    <div
                      className={
                        "font-medium " +
                        (r.isNet
                          ? "font-semibold text-emerald-900 dark:text-emerald-300"
                          : "hover:text-[var(--teal)]")
                      }
                    >
                      {r.ledger}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{r.group}</div>
                  </Td>
                  <Td right className="fig font-semibold">
                    {money(r.amount)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>

        <Panel pad={false} title="Income">
          <TableWrap>
            <thead>
              <tr>
                <Th>Ledger</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {incomeRows.length === 0 && (
                <EmptyRow colSpan={2} text="No income in this period." />
              )}
              {incomeRows.map((r: any, i: number) => (
                <tr
                  key={r.ledgerId || r.ledger + i}
                  className={
                    r.isNet
                      ? "bg-rose-50/70 dark:bg-rose-950/20 font-semibold text-rose-900 dark:text-rose-300"
                      : "hover:bg-muted/40 cursor-pointer transition-colors"
                  }
                  onClick={() => {
                    if (!r.isNet && r.ledgerId) onLedger(r.ledgerId, r.ledger);
                  }}
                  title={r.isNet ? "Net Loss" : "Click to view ledger transactions"}
                >
                  <Td>
                    <div
                      className={
                        "font-medium " +
                        (r.isNet
                          ? "font-semibold text-rose-900 dark:text-rose-300"
                          : "hover:text-[var(--teal)]")
                      }
                    >
                      {r.ledger}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{r.group}</div>
                  </Td>
                  <Td right className="fig font-semibold">
                    {money(r.amount)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      </div>

      {/* Single horizontal row at the bottom displaying Total Expenses and Total Income side by side */}
      <div className="grid md:grid-cols-2 print:grid-cols-2 print-side-by-side gap-4">
        <div className="card-panel px-5 py-3.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total Expenses
          </span>
          <span className="fig text-base font-semibold">{money(balancedTotal)}</span>
        </div>
        <div className="card-panel px-5 py-3.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total Income
          </span>
          <span className="fig text-base font-semibold">{money(balancedTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function BalanceSheetView({
  data,
  onLedger,
  onSelectReport,
  onReorder,
}: {
  data: any;
  onLedger: (id: string, name: string) => void;
  onSelectReport: (key: ReportKey) => void;
  onReorder: (side: "liabilities" | "assets", items: any[]) => void;
}) {
  const [liabilities, setLiabilities] = useState<any[]>(data.liabilities || []);
  const [assets, setAssets] = useState<any[]>(data.assets || []);

  useEffect(() => {
    setLiabilities(data.liabilities || []);
    setAssets(data.assets || []);
  }, [data]);

  const [dragged, setDragged] = useState<{
    side: "liabilities" | "assets";
    index: number;
  } | null>(null);
  const [overTarget, setOverTarget] = useState<{
    side: "liabilities" | "assets";
    index: number;
  } | null>(null);

  function handleDragStart(side: "liabilities" | "assets", index: number, e: React.DragEvent) {
    setDragged({ side, index });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${side}:${index}`);
  }

  function handleDragOver(side: "liabilities" | "assets", index: number, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!overTarget || overTarget.side !== side || overTarget.index !== index) {
      setOverTarget({ side, index });
    }
  }

  function handleDrop(side: "liabilities" | "assets", targetIndex: number, e: React.DragEvent) {
    e.preventDefault();
    if (!dragged || dragged.side !== side) {
      setDragged(null);
      setOverTarget(null);
      return;
    }
    const fromIndex = dragged.index;
    if (fromIndex === targetIndex) {
      setDragged(null);
      setOverTarget(null);
      return;
    }

    const list = side === "liabilities" ? [...liabilities] : [...assets];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(targetIndex, 0, moved);

    if (side === "liabilities") {
      setLiabilities(list);
      onReorder("liabilities", list);
    } else {
      setAssets(list);
      onReorder("assets", list);
    }
    setDragged(null);
    setOverTarget(null);
  }

  function handleDragEnd() {
    setDragged(null);
    setOverTarget(null);
  }

  function renderTable(side: "liabilities" | "assets", items: any[]) {
    return (
      <TableWrap>
        <thead>
          <tr>
            <Th className="w-8 pl-3 pr-0 print:hidden"></Th>
            <Th>Ledger</Th>
            <Th right>Amount</Th>
          </tr>
        </thead>
        <tbody>
          {(!items || items.length === 0) && (
            <EmptyRow colSpan={3} text="Nothing here yet." />
          )}
          {(items || []).map((r: any, i: number) => {
            const isOver = overTarget?.side === side && overTarget?.index === i;
            const isDragging = dragged?.side === side && dragged?.index === i;
            return (
              <tr
                key={r.ledgerId || r.ledger + i}
                draggable
                onDragStart={(e) => handleDragStart(side, i, e)}
                onDragOver={(e) => handleDragOver(side, i, e)}
                onDrop={(e) => handleDrop(side, i, e)}
                onDragEnd={handleDragEnd}
                className={
                  "group cursor-pointer transition-colors " +
                  (isDragging ? "opacity-40 bg-muted/60 " : "hover:bg-muted/40 ") +
                  (isOver ? "border-t-2 border-[var(--teal)] bg-[var(--teal-soft)]/20 " : "")
                }
                onClick={() => {
                  if (r.ledgerId === "profit-loss") {
                    onSelectReport("profit-loss");
                  } else if (r.ledgerId) {
                    onLedger(r.ledgerId, r.ledger);
                  }
                }}
                title={
                  r.ledgerId === "profit-loss"
                    ? "Click to view Profit & Loss statement · Drag to reorder"
                    : "Click to view ledger transactions · Drag to reorder"
                }
              >
                <td className="w-8 pl-3 pr-0 py-2.5 text-muted-foreground/30 group-hover:text-muted-foreground cursor-grab active:cursor-grabbing print:hidden">
                  <GripVertical className="h-3.5 w-3.5" />
                </td>
                <Td>
                  <div className="font-medium text-foreground group-hover:text-[var(--teal)] transition-colors">
                    {r.ledger}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{r.group}</div>
                </Td>
                <Td right className="fig font-medium">
                  {money(r.amount)}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    );
  }

  return (
    <div className="grid md:grid-cols-2 print:grid-cols-2 print-side-by-side gap-4">
      <Panel
        pad={false}
        title="Liabilities & Capital"
        right={<span className="fig text-sm font-semibold">{money(data.liabilitiesTotal)}</span>}
      >
        {renderTable("liabilities", liabilities)}
      </Panel>
      <Panel
        pad={false}
        title="Assets"
        right={<span className="fig text-sm font-semibold">{money(data.assetsTotal)}</span>}
      >
        {renderTable("assets", assets)}
      </Panel>
      <div className="md:col-span-2">
        <div className="card-panel px-5 py-3 flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">
            {data.fromDate && data.toDate
              ? `Period: ${fmtDate(data.fromDate)} – ${fmtDate(data.toDate)}`
              : data.asOn
              ? `As on ${fmtDate(data.asOn)}`
              : ""}
          </span>
          <Badge tone={data.balanced ? "ok" : "bad"}>
            {data.balanced ? "Balanced" : "Out of balance"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function CashBankView({
  data,
  label,
  onLedger,
}: {
  data: any;
  label: string;
  onLedger: (id: string, name: string) => void;
}) {
  const accounts = data.accounts || [];
  return (
    <div className="space-y-4">
      <div className="card-panel px-5 py-3 flex items-center justify-between text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">
          Opening {money(data.openingTotal)} · Closing{" "}
          <span className="fig">{money(data.closingTotal)}</span>
        </span>
      </div>
      {accounts.length === 0 && (
        <div className="card-panel p-8 text-center text-muted-foreground text-sm">
          No matching accounts found.
        </div>
      )}
      {accounts.map((acc: any) => (
        <Panel
          key={acc.ledgerId}
          pad={false}
          title={
            <button
              className="text-[var(--teal)] hover:underline font-semibold"
              onClick={() => onLedger(acc.ledgerId, acc.ledger)}
              title="Click to view ledger transactions"
            >
              {acc.ledger}
            </button>
          }
          right={
            <span className="text-[12px] text-muted-foreground">
              Closing <span className="fig font-semibold">{money(acc.closingBalance)}</span>
            </span>
          }
        >
          <TableWrap>
            <thead>
              <tr>
                <Th>Voucher</Th>
                <Th>Date</Th>
                <Th>Narration</Th>
                <Th right>Debit</Th>
                <Th right>Credit</Th>
                <Th right>Balance</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-muted/20">
                <Td className="text-muted-foreground text-[12px] font-medium">Opening balance</Td>
                <Td />
                <Td />
                <Td />
                <Td />
                <Td right className="fig">
                  {money(acc.openingBalance)}
                </Td>
              </tr>
              {(acc.lines || []).map((l: any, i: number) => (
                <tr key={i}>
                  <Td className="mono font-medium text-[var(--teal)]">{l.voucherNo}</Td>
                  <Td>{fmtDate(l.voucherDate)}</Td>
                  <Td className="max-w-[220px] truncate">
                    <span title={l.narration || undefined}>{l.narration || "—"}</span>
                  </Td>
                  <Td right>{l.debit ? <Money v={l.debit} /> : "—"}</Td>
                  <Td right>{l.credit ? <Money v={l.credit} /> : "—"}</Td>
                  <Td right className="fig">
                    {money(l.balance)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      ))}
    </div>
  );
}

function DayBookView({ data }: { data: any }) {
  return (
    <Panel
      pad={false}
      title={`Day Book${
        data.fromDate ? ` · ${fmtDate(data.fromDate)} – ${fmtDate(data.toDate)}` : ""
      }`}
      right={<span className="fig text-sm font-semibold">{money(data.total)}</span>}
    >
      <TableWrap>
        <thead>
          <tr>
            <Th>Voucher</Th>
            <Th>Type</Th>
            <Th>Date</Th>
            <Th>Narration</Th>
            <Th right>Amount</Th>
            <Th className="w-24">Status</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 && <EmptyRow colSpan={6} text="No vouchers in this period." />}
          {data.rows.map((r: any) => (
            <tr key={r.id}>
              <Td className="mono font-medium text-[var(--teal)]">{r.voucherNo}</Td>
              <Td>{r.voucherType}</Td>
              <Td>{fmtDate(r.voucherDate)}</Td>
              <Td className="max-w-[260px] truncate">
                <span title={r.narration || undefined}>{r.narration || "—"}</span>
              </Td>
              <Td right>
                <Money v={r.amount} />
              </Td>
              <Td>
                <Badge tone={r.status === "POSTED" ? "ok" : r.status === "DRAFT" ? "warn" : "bad"}>
                  {r.status}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Panel>
  );
}

function exportReport(
  key: ReportKey,
  data: any,
  label: string,
  balanceSheetOrder?: { liabilities?: any[]; assets?: any[] }
) {
  if (!data) return;
  const file = `${label.toLowerCase().replace(/\s+/g, "-")}.csv`;

  if (key === "trial-balance") {
    // Preserve Trial Balance structure
    const rows = [
      ...data.rows.map((r: any) => [r.ledger, r.group, r.debit || "", r.credit || ""]),
      ["TOTAL", "", data.totalDebit, data.totalCredit],
    ];
    downloadCSV(file, ["LEDGER", "GROUP", "DEBIT", "CREDIT"], rows);
  } else if (key === "profit-loss") {
    // Preserve P&L side-by-side structure with Net profit on expenses side / Net loss on income side
    // and horizontal side-by-side total row at the bottom
    const expRows = [...(data.expense || [])];
    if (data.isProfit) {
      expRows.push({ ledger: "Net Profit", group: "Transferred to Capital Account", amount: data.netProfit });
    }
    const incRows = [...(data.income || [])];
    if (!data.isProfit && Math.abs(data.netProfit) > 0.005) {
      incRows.push({ ledger: "Net Loss", group: "Transferred to Capital Account", amount: Math.abs(data.netProfit) });
    }
    const maxLen = Math.max(expRows.length, incRows.length);
    const rows: any[][] = [];
    for (let i = 0; i < maxLen; i++) {
      const e = expRows[i];
      const inc = incRows[i];
      rows.push([
        e ? e.ledger : "",
        e ? e.amount : "",
        "",
        inc ? inc.ledger : "",
        inc ? inc.amount : "",
      ]);
    }
    const balancedTotal = Math.max(data.incomeTotal || 0, data.expenseTotal || 0);
    rows.push(["TOTAL EXPENSES", balancedTotal, "", "TOTAL INCOME", balancedTotal]);
    downloadCSV(file, ["EXPENSES", "AMOUNT", "", "INCOME", "AMOUNT"], rows);
  } else if (key === "balance-sheet") {
    // Preserve side-by-side column arrangements and user's custom drag-and-drop order
    const liabList = balanceSheetOrder?.liabilities || data.liabilities || [];
    const asstList = balanceSheetOrder?.assets || data.assets || [];
    const maxLen = Math.max(liabList.length, asstList.length);
    const rows: any[][] = [];
    for (let i = 0; i < maxLen; i++) {
      const l = liabList[i];
      const a = asstList[i];
      rows.push([
        l ? l.ledger : "",
        l ? l.amount : "",
        "",
        a ? a.ledger : "",
        a ? a.amount : "",
      ]);
    }
    downloadCSV(file, ["LIABILITIES & CAPITAL", "AMOUNT", "", "ASSETS", "AMOUNT"], rows);
  } else if (key === "day-book") {
    downloadCSV(
      file,
      ["VOUCHER", "TYPE", "DATE", "NARRATION", "AMOUNT", "STATUS"],
      data.rows.map((r: any) => [
        r.voucherNo,
        r.voucherType,
        r.voucherDate,
        r.narration,
        r.amount,
        r.status,
      ])
    );
  } else {
    const rows: any[] = [];
    (data.accounts || []).forEach((acc: any) => {
      rows.push([acc.ledger, "Opening balance", "", "", "", acc.openingBalance]);
      (acc.lines || []).forEach((l: any) =>
        rows.push([acc.ledger, l.voucherNo, l.voucherDate, l.debit, l.credit, l.balance])
      );
      rows.push([acc.ledger, "Closing balance", "", "", "", acc.closingBalance]);
    });
    downloadCSV(file, ["ACCOUNT", "VOUCHER", "DATE", "DEBIT", "CREDIT", "BALANCE"], rows);
  }
}
