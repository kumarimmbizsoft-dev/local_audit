import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Trash2, CheckCircle, Sparkles, Calendar, FileText, Building2, Layers, Info, Receipt, Printer } from "lucide-react";
import { api, envelopeOk, envelopeMessage, envelopeResult } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useCompany } from "../auth/CompanyContext";
import { useToast } from "../components/toast";
import { money, fmtDate } from "../lib/format";
import { useHotkeys } from "../lib/hotkeys";
import { QuickCreateParty, QuickCreateItem } from "../components/QuickCreate";
import { AiModeButton, AiFillPanel, type AiDraft } from "../components/AiFill";
import { InvoiceTemplate } from "../components/InvoiceTemplate";
import {
  loadVoucherRefs,
  loadActiveVoucherTypes,
  findLedgerByName,
  partyName,
  gstSplit,
  round2,
  finalizeLines,
  computeDueDate,
  type ConfiguredVoucherType,
  type LedgerLite,
  type PartyLite,
  type ItemLite,
} from "../lib/vouchers";
import {
  Button,
  DatePicker,
  Field,
  Input,
  Select,
  Checkbox,
  PageHeader,
  Panel,
  SearchBox,
  TableWrap,
  Th,
  Td,
  EmptyRow,
  Money,
  Badge,
  Drawer,
  ConfirmDialog,
  Spinner,
} from "../components/ui";

interface Voucher {
  id: string;
  voucherNo: string;
  voucherTypeId: string | null;
  voucherTypeName: string | null;
  voucherDate: string;
  dueDate?: string | null;
  referenceNo: string | null;
  narration: string | null;
  voucherStatus: string;
  totalDebit: number | null;
  totalCredit?: number | null;
  details: any[];
}

interface TradeVoucherProps {
  kind: "SALES" | "PURCHASE";
}

interface FormLine {
  item_id?: string;
  description: string;
  hsn: string;
  qty: number;
  rate: number;
  gst_rate: number;
}

interface FormT {
  id?: string | null;
  status?: string;
  voucher_type_id: string;
  voucher_type_name: string;
  voucher_date: string;
  due_date: string;
  party_id: string;
  invoice_no: string;
  place_of_supply: string;
  inter_state: boolean;
  lines: FormLine[];
  narration?: string;
}

function emptyLine(): FormLine {
  return { description: "", hsn: "", qty: 1, rate: 0, gst_rate: 18 };
}

function emptyForm(): FormT {
  return {
    id: null,
    status: "DRAFT",
    voucher_type_id: "",
    voucher_type_name: "",
    voucher_date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10),
    party_id: "",
    invoice_no: "",
    place_of_supply: "",
    inter_state: false,
    narration: "",
    lines: [emptyLine()],
  };
}

export function TradeVoucher({ kind }: TradeVoucherProps) {
  const isSales = kind === "SALES";
  const Title = isSales ? "Sales Voucher" : "Purchase Voucher";
  const partyGroup = isSales ? "C" : "V";
  const partyWord = isSales ? "Customer" : "Supplier";

  const { can } = useAuth();
  const { company, companyId } = useCompany();
  const { toast } = useToast();
  const loc = useLocation();
  const navigate = useNavigate();

  const canWrite = can("VOUCHER", "write");
  const canCancel = can("VOUCHER", "delete");
  const canQuickParty = can(isSales ? "CUSTOMER" : "VENDOR", "write");
  const canQuickItem = can("ITEMS", "write");

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [ledgers, setLedgers] = useState<LedgerLite[]>([]);
  const [parties, setParties] = useState<PartyLite[]>([]);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [gstRates, setGstRates] = useState<{ rate: number }[]>([]);
  const [voucherTypes, setVoucherTypes] = useState<ConfiguredVoucherType[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<FormT>(emptyForm());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toCancel, setToCancel] = useState<Voucher | null>(null);
  const [quickParty, setQuickParty] = useState(false);
  const [quickItemFor, setQuickItemFor] = useState<number | null>(null);
  const [viewVoucher, setViewVoucher] = useState<Voucher | null>(null);
  const [viewTab, setViewTab] = useState<"invoice" | "journal">("invoice");
  const [aiMode, setAiMode] = useState(false);

  const partyOptions = useMemo(
    () => parties.filter((p) => p.key_group === partyGroup || p.key_group === "B"),
    [parties, partyGroup]
  );

  // Dropdown options must always include every statutory slab plus whatever
  // the AI fill (or an existing voucher) carries — the GST master alone is
  // not enough, since a missing slab makes the select display a wrong value.
  const rateOptions = useMemo(() => {
    const set = new Set<number>([0, 0.25, 3, 5, 12, 18, 28]);
    for (const g of gstRates) {
      const r = Number(g.rate);
      if (Number.isFinite(r)) set.add(r);
    }
    for (const l of form.lines) {
      const r = Number(l.gst_rate);
      if (Number.isFinite(r)) set.add(r);
    }
    return [...set].sort((a, b) => a - b);
  }, [gstRates, form.lines]);

  async function load() {
    setLoading(true);
    const [vr, refs, configuredTypes, bankRes] = await Promise.all([
      api.get(`/vouchers?voucher_type=${kind}`),
      loadVoucherRefs(),
      loadActiveVoucherTypes(kind),
      api.get("/bank-accounts"),
    ]);
    setVouchers(envelopeResult<Voucher[]>(vr) || []);
    setLedgers(refs.ledgers);
    setParties(refs.parties);
    setItems(refs.items);
    setGstRates(refs.gstRates.length ? refs.gstRates : [{ rate: 0 }, { rate: 5 }, { rate: 12 }, { rate: 18 }, { rate: 28 }]);
    setVoucherTypes(configuredTypes);
    setBankAccounts(envelopeResult<any[]>(bankRes) || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, companyId]);
  useEffect(() => {
    if ((loc.state as any)?.openNew && canWrite) openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHotkeys(
    useMemo(
      () => ({ "ctrl+n": () => canWrite && openNew(), "ctrl+s": () => drawer && saveDraft() }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [drawer, form, canWrite]
    )
  );

  const filtered = vouchers.filter((v) =>
    `${v.voucherNo} ${v.referenceNo || ""} ${v.narration || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  const totals = useMemo(() => {
    let taxable = 0, cgst = 0, sgst = 0, igst = 0;
    for (const l of form.lines) {
      const t = round2((Number(l.qty) || 0) * (Number(l.rate) || 0));
      taxable += t;
      const s = gstSplit(t, Number(l.gst_rate) || 0, form.inter_state);
      cgst += s.cgst; sgst += s.sgst; igst += s.igst;
    }
    taxable = round2(taxable); cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst);
    const raw = round2(taxable + cgst + sgst + igst);
    const grand = Math.round(raw);
    const roundOff = round2(grand - raw);
    return { taxable, cgst, sgst, igst, tax: round2(cgst + sgst + igst), raw, grand, roundOff };
  }, [form.lines, form.inter_state]);

  const readOnly = !!form.id && form.status !== "DRAFT";

  function openNew() {
    setViewVoucher(null);
    const next = emptyForm();
    const defaultType = voucherTypes[0];
    if (defaultType) {
      next.voucher_type_id = defaultType.id;
      next.voucher_type_name = defaultType.name;
    }
    setForm(next);
    setSubmitted(false);
    setDrawer(true);
  }
  function openRow(v: Voucher) {
    setViewVoucher(v);
    setForm({
      ...emptyForm(),
      id: v.id,
      status: v.voucherStatus,
      voucher_type_id: v.voucherTypeId || "",
      voucher_type_name: v.voucherTypeName || "",
      voucher_date: v.voucherDate,
      due_date: v.dueDate ? v.dueDate.slice(0, 10) : v.voucherDate,
      invoice_no: v.referenceNo || "",
      narration: v.narration || "",
    });
    setSubmitted(false);
    setDrawer(true);
  }

  function updateLine(i: number, patch: Partial<FormLine>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  }
  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  }
  function removeLine(i: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));
  }

  function fillFormFromAi(draft: AiDraft) {
    const f = draft.fields;
    // Prefer server-side master match (company-scoped, GSTIN-first).
    const best = (draft.candidates || [])[0];
    let matchedParty =
      best && best.score >= 80 ? partyOptions.find((p) => p.id === best.party_id) : undefined;
    // Frontend fallback: GSTIN then name hint.
    const gstin = (isSales ? f.buyer_gstin : f.seller_gstin || f.buyer_gstin || "").toUpperCase();
    const nameHint = (isSales ? f.buyer_name_hint : f.seller_name_hint || f.buyer_name_hint || "").toLowerCase();
    if (!matchedParty && gstin) {
      matchedParty = partyOptions.find((p) => (p.gstin || "").toUpperCase() === gstin);
    }
    if (!matchedParty && nameHint.length >= 3) {
      matchedParty =
        partyOptions.find((p) => partyName(p).toLowerCase() === nameHint) ||
        partyOptions.find((p) => partyName(p).toLowerCase().includes(nameHint.slice(0, 12)));
    }
    if (!matchedParty) {
      toast({
        title: "Party not matched — select manually",
        desc: gstin || nameHint || "no GSTIN/name found",
        tone: "info",
      });
    }
    setForm((prev) => ({
      ...prev,
      party_id: matchedParty?.id || prev.party_id,
      invoice_no: (f.invoice_no || "").slice(0, 50),
      voucher_date: f.invoice_date || prev.voucher_date,
      due_date: f.due_date || f.invoice_date || prev.due_date,
      place_of_supply: f.place_of_supply || prev.place_of_supply,
      inter_state: !!f.inter_state,
      narration: (f.narration || "").slice(0, 50),
      lines: draft.lines.length
        ? draft.lines.map((l) => {
            const qty = Number(l.qty) > 0 ? Number(l.qty) : 1;
            const gross = qty * (Number(l.rate) || 0) - (Number(l.discount) || 0);
            return {
              description: l.description || "",
              hsn: (l.hsn || "").slice(0, 8),
              qty,
              rate: Math.round((gross / qty) * 100) / 100,
              gst_rate: Number(l.gst_rate) || 0,
            };
          })
        : prev.lines,
    }));
  }

  function need(name: string): LedgerLite | undefined {
    return findLedgerByName(ledgers, name);
  }

  function buildDetails(): { ok: boolean; details?: any[]; error?: string } {
    const party = partyOptions.find((p) => p.id === form.party_id);
    if (!party?.ledger_id) return { ok: false, error: `${partyWord} has no linked ledger` };
    const partyName = (party.name_contact_info?.company_name || party.name_contact_info?.display_name || party.name_contact_info?.first_name || "").trim().toLowerCase();
    let effectiveLedgerId = party.ledger_id;
    if (!isSales && party.key_group === "B") {
      const creditorLedger = ledgers.find((l) => l.name.trim().toLowerCase() === partyName && (l.category === "vendor" || (l as any).balance_type === "CR"));
      if (creditorLedger) {
        effectiveLedgerId = creditorLedger.id;
      }
    }
    const salesAcct = need("Sales Account");
    const purchaseAcct = need("Purchase Account");
    const cgstL = need(isSales ? "Output CGST" : "Input CGST");
    const sgstL = need(isSales ? "Output SGST" : "Input SGST");
    const igstL = need(isSales ? "Output IGST" : "Input IGST");
    const roundL = need("Round Off");
    const revenueLedger = isSales ? salesAcct : purchaseAcct;
    if (!revenueLedger) return { ok: false, error: `Missing system ledger: ${isSales ? "Sales Account" : "Purchase Account"}` };

    const rows: Array<{ ledger_id: string; debit_amount: number; credit_amount: number; remarks?: string | null }> = [];
    if (isSales) {
      rows.push({ ledger_id: effectiveLedgerId, debit_amount: totals.grand, credit_amount: 0, remarks: form.invoice_no || null });
      rows.push({ ledger_id: revenueLedger.id, debit_amount: 0, credit_amount: totals.taxable, remarks: "Taxable value" });
      if (totals.cgst > 0 && cgstL) rows.push({ ledger_id: cgstL.id, debit_amount: 0, credit_amount: totals.cgst, remarks: "CGST" });
      if (totals.sgst > 0 && sgstL) rows.push({ ledger_id: sgstL.id, debit_amount: 0, credit_amount: totals.sgst, remarks: "SGST" });
      if (totals.igst > 0 && igstL) rows.push({ ledger_id: igstL.id, debit_amount: 0, credit_amount: totals.igst, remarks: "IGST" });
    } else {
      rows.push({ ledger_id: revenueLedger.id, debit_amount: totals.taxable, credit_amount: 0, remarks: "Taxable value" });
      if (totals.cgst > 0 && cgstL) rows.push({ ledger_id: cgstL.id, debit_amount: totals.cgst, credit_amount: 0, remarks: "CGST" });
      if (totals.sgst > 0 && sgstL) rows.push({ ledger_id: sgstL.id, debit_amount: totals.sgst, credit_amount: 0, remarks: "SGST" });
      if (totals.igst > 0 && igstL) rows.push({ ledger_id: igstL.id, debit_amount: totals.igst, credit_amount: 0, remarks: "IGST" });
      rows.push({ ledger_id: effectiveLedgerId, debit_amount: 0, credit_amount: totals.grand, remarks: form.invoice_no || null });
    }
    // Absorb sub-rupee rounding into Round Off to keep the voucher balanced.
    const dr = round2(rows.reduce((s, r) => s + r.debit_amount, 0));
    const cr = round2(rows.reduce((s, r) => s + r.credit_amount, 0));
    const diff = round2(dr - cr);
    if (Math.abs(diff) >= 0.01 && roundL) {
      if (diff > 0) rows.push({ ledger_id: roundL.id, debit_amount: 0, credit_amount: diff, remarks: "Round off" });
      else rows.push({ ledger_id: roundL.id, debit_amount: -diff, credit_amount: 0, remarks: "Round off" });
    }
    return { ok: true, details: finalizeLines(rows) };
  }

  function validate(): { ok: boolean; details?: any[] } {
    setSubmitted(true);
    if (!form.voucher_type_id) {
      toast({ title: "Select a Voucher Type", tone: "error" });
      return { ok: false };
    }
    if (!form.voucher_date) return { ok: false };
    if (form.due_date && form.voucher_date && form.due_date < form.voucher_date) {
      toast({ title: "Due date cannot be earlier than voucher date", tone: "error" });
      return { ok: false };
    }
    if (!form.party_id) {
      toast({ title: `Select a ${partyWord.toLowerCase()}`, tone: "error" });
      return { ok: false };
    }
    if (form.lines.every((l) => !((Number(l.qty) || 0) * (Number(l.rate) || 0) > 0))) {
      toast({ title: "Add at least one line with quantity and rate", tone: "error" });
      return { ok: false };
    }
    const built = buildDetails();
    if (!built.ok) {
      toast({ title: "Could not build entry", desc: built.error, tone: "error" });
      return { ok: false };
    }
    return { ok: true, details: built.details };
  }

  async function persist(): Promise<string | null> {
    const v = validate();
    if (!v.ok) return null;
    setSaving(true);
    const lineDesc = form.lines
      .map((l) => l.description || items.find((it) => String(it.id) === l.item_id)?.item_name)
      .filter(Boolean)
      .join(", ");
    const payload = {
      voucher_date: form.voucher_date,
      due_date: form.due_date || null,
      reference_no: (form.invoice_no || "").slice(0, 50) || null,
      narration: (form.narration || lineDesc || "").slice(0, 50) || null,
      details: v.details,
    };
    const r = form.id
      ? await api.put(`/vouchers/${form.id}`, payload)
      : await api.post(
          `/vouchers?voucher_type=${kind}&voucher_type_id=${encodeURIComponent(form.voucher_type_id)}`,
          payload
        );
    setSaving(false);
    if (!envelopeOk(r)) {
      toast({ title: "Could not save", desc: envelopeMessage(r), tone: "error" });
      return null;
    }
    return form.id || (r.data?.result?.id ?? null);
  }

  async function revealVoucher(id: string) {
    await load();
    const r = await api.get(`/vouchers/${id}`);
    const v = envelopeResult<Voucher>(r);
    if (v) openRow(v);
  }

  async function saveDraft() {
    const id = await persist();
    if (!id) return;
    toast({ title: "Draft saved", tone: "success" });
    await revealVoucher(id);
  }
  async function saveAndPost() {
    const id = await persist();
    if (!id) return;
    const r = await api.patch(`/vouchers/${id}/post`, {});
    if (!envelopeOk(r)) {
      toast({ title: "Could not post", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({ title: `${Title} posted`, tone: "success" });
    await revealVoucher(id);
  }
  async function cancelVoucher() {
    if (!toCancel) return;
    const r = await api.patch(`/vouchers/${toCancel.id}/cancel`, {});
    if (!envelopeOk(r)) {
      toast({ title: "Could not cancel", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({ title: "Voucher cancelled", tone: "success" });
    setDrawer(false);
    load();
  }

  return (
    <PageHeader
      title={Title}
      sub={isSales ? "Customer invoices with automatic GST split (CGST/SGST or IGST)" : "Vendor bills with input GST credit"}
      actions={
        canWrite && (
          <Button size="sm" onClick={() => openNew()} title="Ctrl+N">
            <Plus className="h-4 w-4 mr-1.5" />
            New {isSales ? "invoice" : "bill"}
          </Button>
        )
      }
    >
      <Panel pad={false} title={`${filtered.length} ${isSales ? "invoices" : "bills"}`} right={<SearchBox value={q} onChange={setQ} placeholder="Search no, ref, narration" />}>
        {loading ? (
          <Spinner />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Voucher</Th>
                <Th>Voucher Type</Th>
                <Th>Date</Th>
                <Th>Invoice ref</Th>
                <Th>Narration</Th>
                <Th right>Amount</Th>
                <Th className="w-28">Status</Th>
                {company?.maintain_mode === "ACCOUNT_WITH_INVENTORY" && <Th className="w-32">Action</Th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <EmptyRow colSpan={company?.maintain_mode === "ACCOUNT_WITH_INVENTORY" ? 8 : 7} text={`No ${isSales ? "sales" : "purchase"} vouchers yet.`} />}
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => openRow(v)}>
                  <Td className="mono">{v.voucherNo}</Td>
                  <Td>{v.voucherTypeName || (isSales ? "Sales" : "Purchase")}</Td>
                  <Td>{fmtDate(v.voucherDate)}</Td>
                  <Td className="mono text-muted-foreground">{v.referenceNo || "—"}</Td>
                  <Td className="max-w-[280px] truncate">{v.narration || "—"}</Td>
                  <Td right><Money v={v.totalDebit || 0} /></Td>
                  <Td>
                    <Badge tone={v.voucherStatus === "POSTED" ? "ok" : v.voucherStatus === "DRAFT" ? "warn" : "bad"}>
                      {v.voucherStatus}
                    </Badge>
                  </Td>
                  {company?.maintain_mode === "ACCOUNT_WITH_INVENTORY" && (
                    <td className="px-4 py-2.5 border-b border-border/70 align-middle" onClick={(e) => e.stopPropagation()}>
                      {v.voucherStatus === "POSTED" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (isSales) {
                              navigate("/app/receipt", { state: { paySalesInvoiceId: v.id } });
                            } else {
                              navigate("/app/payment", { state: { payPurchaseBillId: v.id } });
                            }
                          }}
                        >
                          {isSales ? "Receive Payment" : "Pay Bill"}
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        wide
        title={form.id ? `${(form.status || "draft").toLowerCase()} ${isSales ? "invoice" : "bill"}` : `New ${isSales ? "sales invoice" : "purchase bill"}`}
        desc={readOnly ? "Posted vouchers are read-only. Cancel to reverse." : "GST splits automatically. Ctrl+S saves a draft."}
        footer={
          <>
            {form.id && form.status !== "CANCELLED" && canCancel && (
              <Button variant="outline" className="mr-auto text-destructive border-destructive/40 hover:text-destructive" onClick={() => setToCancel(vouchers.find((v) => v.id === form.id) || null)}>
                Cancel voucher
              </Button>
            )}
            {form.id && viewVoucher && (
              <Button
                variant="outline"
                onClick={() => {
                  const printContent = document.getElementById("invoice-printable-area");
                  if (!printContent) return;
                  const win = window.open("", "_blank");
                  if (!win) {
                    window.print();
                    return;
                  }
                  win.document.write(`
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <title>${isSales ? "SALES INVOICE" : "PURCHASE INVOICE"} - ${viewVoucher?.voucherNo || "Invoice"}</title>
                        <style>
                          @page { size: A4; margin: 10mm; }
                          body {
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                            color: #111827;
                            background: #ffffff;
                            margin: 0;
                            padding: 0;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                          }
                          table { width: 100%; border-collapse: collapse; }
                          th, td { padding: 4px 6px; box-sizing: border-box; }
                          .table-header th {
                            background-color: #3b0764 !important;
                            color: #ffffff !important;
                            font-weight: 600;
                            text-align: left;
                          }
                        </style>
                      </head>
                      <body>
                        ${printContent.innerHTML}
                        <script>
                          window.onload = function() {
                            window.print();
                            setTimeout(() => { window.close(); }, 500);
                          };
                        </script>
                      </body>
                    </html>
                  `);
                  win.document.close();
                }}
              >
                <Printer className="h-4 w-4 mr-1.5" />
                Download / Print
              </Button>
            )}
            {form.id && form.status === "POSTED" && company?.maintain_mode === "ACCOUNT_WITH_INVENTORY" && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (isSales) {
                    navigate("/app/receipt", { state: { paySalesInvoiceId: form.id } });
                  } else {
                    navigate("/app/payment", { state: { payPurchaseBillId: form.id } });
                  }
                }}
              >
                {isSales ? "Receive Payment" : "Pay Bill"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDrawer(false)}>Close</Button>
            {!readOnly && !form.id && canWrite && (
              <>
                <Button variant="secondary" onClick={saveDraft} disabled={saving}>Save draft</Button>
                <Button onClick={saveAndPost} disabled={saving}>
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  Save &amp; post
                </Button>
              </>
            )}
          </>
        }
      >
        {form.id && viewVoucher ? (
          <div className="space-y-4">
            {/* View switcher tabs */}
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <button
                type="button"
                onClick={() => setViewTab("invoice")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  viewTab === "invoice"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Receipt className="h-3.5 w-3.5" />
                Tax Invoice Template
              </button>
              <button
                type="button"
                onClick={() => setViewTab("journal")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  viewTab === "journal"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Journal Entries
              </button>
            </div>

            {viewTab === "invoice" ? (
              <InvoiceTemplate
                voucher={viewVoucher}
                kind={kind}
                company={company}
                parties={parties}
                ledgers={ledgers}
                items={items}
                bankAccounts={bankAccounts}
              />
            ) : (
              <div className="space-y-6">
                {/* Header Voucher Card */}
                <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="mono font-bold text-lg text-foreground tracking-tight">
                        {viewVoucher.voucherNo}
                      </div>
                      <Badge tone={viewVoucher.voucherStatus === "POSTED" ? "ok" : viewVoucher.voucherStatus === "DRAFT" ? "warn" : "bad"}>
                        {viewVoucher.voucherStatus}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-medium px-2 py-0.5 bg-muted rounded">
                        {viewVoucher.voucherTypeName || (isSales ? "Sales" : "Purchase")}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Total Amount</div>
                      <div className="text-xl font-bold mono" style={{ color: "var(--teal)" }}>
                        {money(viewVoucher.totalDebit || viewVoucher.totalCredit || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px]">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5 mb-1">
                        <Calendar className="h-3.5 w-3.5" /> Date
                      </div>
                      <div className="font-medium text-foreground">{fmtDate(viewVoucher.voucherDate)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5 mb-1">
                        <FileText className="h-3.5 w-3.5" /> Reference / Invoice #
                      </div>
                      <div className="mono font-medium text-foreground">{viewVoucher.referenceNo || "—"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5 mb-1">
                        <Building2 className="h-3.5 w-3.5" /> {partyWord}
                      </div>
                      <div className="font-medium text-foreground truncate">
                        {(() => {
                          const partyLine = (viewVoucher.details || []).find((d) =>
                            isSales
                              ? (d.debitAmount || 0) > 0 && (d.ledgerName || "").toLowerCase() !== "round off"
                              : (d.creditAmount || 0) > 0 && (d.ledgerName || "").toLowerCase() !== "round off"
                          );
                          const ledgerName = partyLine?.ledgerName || ledgers.find((l) => l.id === partyLine?.ledgerId)?.name;
                          return ledgerName || "—";
                        })()}
                      </div>
                    </div>
                  </div>

                  {viewVoucher.narration && (
                    <div className="rounded-md bg-muted/40 p-3 text-[12px] border border-border/50">
                      <span className="font-semibold text-muted-foreground mr-1.5">Narration:</span>
                      <span className="text-foreground italic">{viewVoucher.narration}</span>
                    </div>
                  )}
                </div>

                {/* Accounting Ledger Entries Breakdown */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" /> Accounting Journal Distribution
                    </h4>
                    <span className="text-[11px] text-muted-foreground">Balanced double-entry</span>
                  </div>

                  <div className="rounded-md border border-border overflow-hidden bg-card">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          <Th className="w-10">#</Th>
                          <Th>Ledger Account</Th>
                          <Th>Remarks</Th>
                          <Th right className="w-32">Debit (₹)</Th>
                          <Th right className="w-32">Credit (₹)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(viewVoucher.details || [])
                          .filter((d) => d.active !== "N")
                          .map((d, i) => {
                            const ledgerName = d.ledgerName || ledgers.find((l) => l.id === d.ledgerId)?.name || d.ledgerId;
                            return (
                              <tr key={d.id || i} className="hover:bg-muted/20 border-b border-border/50">
                                <Td className="mono text-muted-foreground">{i + 1}</Td>
                                <Td className="font-medium text-foreground">{ledgerName}</Td>
                                <Td className="text-muted-foreground text-xs">{d.remarks || "—"}</Td>
                                <Td right className="mono fig font-medium">
                                  {(d.debitAmount || 0) > 0 ? money(d.debitAmount) : "—"}
                                </Td>
                                <Td right className="mono fig font-medium">
                                  {(d.creditAmount || 0) > 0 ? money(d.creditAmount) : "—"}
                                </Td>
                              </tr>
                            );
                          })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/60 font-semibold border-t-2 border-border">
                          <td colSpan={3} className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wider text-muted-foreground">
                            Total
                          </td>
                          <td className="px-4 py-2.5 text-right mono fig" style={{ color: "var(--teal)" }}>
                            {money(viewVoucher.totalDebit || 0)}
                          </td>
                          <td className="px-4 py-2.5 text-right mono fig" style={{ color: "var(--teal)" }}>
                            {money(viewVoucher.totalCredit || 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Audit / Compliance Note */}
                <div className="flex items-start gap-2 text-[12px] text-muted-foreground rounded-md bg-muted/20 border border-border/60 p-3">
                  <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    This {isSales ? "invoice" : "bill"} is <strong>{viewVoucher.voucherStatus.toLowerCase()}</strong>.
                    Line-level editing of posted trade vouchers is restricted to protect statutory compliance and the audit trail.
                    {company?.maintain_mode === "ACCOUNT_WITH_INVENTORY" && viewVoucher.voucherStatus === "POSTED" && (
                      <span className="block mt-1 text-foreground font-medium">
                        Use the &ldquo;{isSales ? "Receive Payment" : "Pay Bill"}&rdquo; action below to create a settlement receipt/payment against this {isSales ? "invoice" : "bill"}.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {!readOnly && canWrite && (
              <div className="flex items-center justify-end mb-3">
                <AiModeButton active={aiMode} onToggle={() => setAiMode((v) => !v)} />
              </div>
            )}
            {aiMode && !readOnly && (
              <div className="mb-4">
                <AiFillPanel target={kind} onApply={fillFormFromAi} liveGrandTotal={totals.grand} liveTaxable={totals.taxable} />
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Field label="Voucher No">
                <div className="relative">
                  <Input
                    className="mono bg-muted text-muted-foreground font-medium"
                    readOnly
                    disabled
                    value="Auto-generated"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Badge tone="muted">AUTO</Badge>
                  </span>
                </div>
              </Field>
              <Field label="Voucher Type" required error={submitted && !form.voucher_type_id ? "Required" : undefined}>
                <Select
                  value={form.voucher_type_id}
                  onChange={(e) => {
                    const selected = voucherTypes.find((type) => type.id === e.target.value);
                    setForm({ ...form, voucher_type_id: e.target.value, voucher_type_name: selected?.name || "" });
                  }}
                >
                  <option value="">Select Voucher Type</option>
                  {voucherTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={partyWord} required className="md:col-span-2" error={submitted && !form.party_id ? "Required" : undefined}>
                <div className="flex gap-2">
                  <Select
                    value={form.party_id}
                    onChange={(e) => {
                      const pId = e.target.value;
                      const selectedParty = partyOptions.find((p) => p.id === pId);
                      const terms = selectedParty?.payment_info?.terms;
                      const computedDue = computeDueDate(form.voucher_date, terms);
                      setForm({ ...form, party_id: pId, due_date: computedDue });
                    }}
                  >
                    <option value="">Select {partyWord.toLowerCase()}</option>
                    {partyOptions.map((p) => (
                      <option key={p.id} value={p.id}>{partyName(p)}</option>
                    ))}
                  </Select>
                  {canQuickParty && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setQuickParty(true)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="Invoice / bill no">
                <Input className="mono" placeholder="Optional (e.g. Vendor Bill #)" value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
              </Field>
              <Field label="Voucher Date" required error={submitted && !form.voucher_date ? "Required" : undefined}>
                <DatePicker
                  value={form.voucher_date}
                  onChange={(vDate) => {
                    const selectedParty = partyOptions.find((p) => p.id === form.party_id);
                    const terms = selectedParty?.payment_info?.terms;
                    const computedDue = computeDueDate(vDate, terms);
                    setForm({ ...form, voucher_date: vDate, due_date: computedDue });
                  }}
                />
              </Field>
              <Field label="Due Date" error={submitted && form.due_date && form.voucher_date && form.due_date < form.voucher_date ? "Earlier than voucher date" : undefined}>
                <DatePicker min={form.voucher_date} value={form.due_date} onChange={(val) => setForm({ ...form, due_date: val })} />
              </Field>
              <Field label="Place of supply">
                <Input value={form.place_of_supply} onChange={(e) => setForm({ ...form, place_of_supply: e.target.value })} placeholder="e.g. Tamil Nadu" />
              </Field>
              <Field label="Tax type" className="md:col-span-4">
                <label className="flex items-center gap-2 h-9 text-[13px] cursor-pointer">
                  <Checkbox checked={form.inter_state} onChange={(e) => setForm({ ...form, inter_state: e.target.checked })} />
                  Inter-state supply (IGST). Leave unchecked for intra-state (CGST + SGST).
                </label>
              </Field>
            </div>

            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <Th className="w-10">#</Th>
                    <Th>Item / description</Th>
                    <Th className="w-24">HSN/SAC</Th>
                    <Th right className="w-24">Qty</Th>
                    <Th right className="w-32">Rate</Th>
                    <Th right className="w-28">GST %</Th>
                    <Th right className="w-32">Taxable</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l, i) => {
                    const taxable = round2((Number(l.qty) || 0) * (Number(l.rate) || 0));
                    return (
                      <tr key={i} className="align-top">
                        <Td className="mono text-muted-foreground">{i + 1}</Td>
                        <Td>
                          <div className="flex gap-1.5">
                            <Select
                              className="h-8"
                              value={l.item_id}
                              onChange={(e) => {
                                if (e.target.value === "__create__") { setQuickItemFor(i); return; }
                                const it = items.find((x) => String(x.id) === e.target.value);
                                updateLine(i, {
                                  item_id: e.target.value,
                                  description: it?.item_name || l.description,
                                  hsn: it?.hsn_sac || l.hsn,
                                  rate: (isSales ? it?.sale_rate : it?.purchase_rate) || l.rate,
                                  gst_rate: it?.gst_percent ?? l.gst_rate,
                                });
                              }}
                            >
                              <option value="">Free text</option>
                              {canQuickItem && <option value="__create__">＋ New item…</option>}
                              {items.map((it) => (
                                <option key={it.id} value={String(it.id)}>{it.item_name}</option>
                              ))}
                            </Select>
                          </div>
                          <Input className="h-8 mt-1" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                        </Td>
                        <Td>
                          <Input className="h-8 mono" value={l.hsn} onChange={(e) => updateLine(i, { hsn: e.target.value })} />
                        </Td>
                        <Td right>
                          <Input type="number" className="h-8 text-right fig" value={l.qty || ""} onChange={(e) => updateLine(i, { qty: +e.target.value || 0 })} />
                        </Td>
                        <Td right>
                          <Input type="number" className="h-8 text-right fig" value={l.rate || ""} onChange={(e) => updateLine(i, { rate: +e.target.value || 0 })} />
                        </Td>
                        <Td right>
                          <Select className="h-8" value={String(l.gst_rate)} onChange={(e) => updateLine(i, { gst_rate: +e.target.value })}>
                            {rateOptions.map((r) => (
                              <option key={r} value={r}>{r}%</option>
                            ))}
                          </Select>
                        </Td>
                        <Td right className="fig">{money(taxable)}</Td>
                        <Td>
                          {form.lines.length > 1 && (
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeLine(i)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={addLine}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add line
            </Button>

            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-2 text-[12px] text-muted-foreground">
                <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                {isSales
                  ? "Posts: Dr customer, Cr Sales Account + Output GST, with rounding to Round Off."
                  : "Posts: Dr Purchase Account + Input GST, Cr supplier, with rounding to Round Off."}
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1 text-[13px]">
                <Row l="Taxable value" v={totals.taxable} />
                {!form.inter_state && <Row l="CGST" v={totals.cgst} />}
                {!form.inter_state && <Row l="SGST" v={totals.sgst} />}
                {form.inter_state && <Row l="IGST" v={totals.igst} />}
                {totals.roundOff !== 0 && <Row l="Round off" v={totals.roundOff} />}
                <div className="flex justify-between pt-1.5 ledger-rule font-semibold">
                  <span>Grand total</span>
                  <span className="fig">{money(totals.grand)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </Drawer>

      <QuickCreateParty
        open={quickParty}
        onClose={() => setQuickParty(false)}
        kind={partyGroup as "C" | "V"}
        onCreated={(p) => {
          setParties((ps) => [...ps, p]);
          setForm((f) => ({ ...f, party_id: p.id }));
        }}
      />
      <QuickCreateItem
        open={quickItemFor !== null}
        onClose={() => setQuickItemFor(null)}
        onCreated={(it) => {
          setItems((xs) => [...xs, it]);
          if (quickItemFor !== null)
            updateLine(quickItemFor, {
              item_id: String(it.id),
              description: it.item_name,
              hsn: it.hsn_sac || "",
              gst_rate: it.gst_percent ?? 18,
            });
        }}
      />

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        title={`Cancel ${toCancel?.voucherNo}?`}
        desc="The voucher stays on record as cancelled and no longer affects the books."
        confirmLabel="Cancel voucher"
        onConfirm={cancelVoucher}
      />
    </PageHeader>
  );
}

function Row({ l, v }: { l: string; v: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{l}</span>
      <span className="fig">{money(v)}</span>
    </div>
  );
}
