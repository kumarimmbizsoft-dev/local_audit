// Shared helpers for the unified Accounting Voucher and specialized voucher
// screens. The backend engine stores every flow as balanced double-entry lines.

import { api, envelopeResult } from "./api";

export interface LedgerLite {
  id: string;
  name: string;
  category?: string | null;
  is_bank?: string;
  is_cash?: string;
  default_narration?: string | null;
  default_gst_rate?: number | null;
  ledger_group_id?: string | null;
  payment_terms?: string | null;
}
export interface PartyLite {
  id: string;
  ledger_id: string | null;
  name_contact_info: any;
  gstin: string | null;
  key_group: string;
  address_info?: any;
  payment_info?: any;
  additional_info?: any;
}
export interface ItemLite {
  id: number;
  item_name: string;
  hsn_sac?: string | null;
  sale_rate?: number | null;
  purchase_rate?: number | null;
  gst_percent?: number | null;
}
export interface CostCenterLite {
  id: string;
  name: string;
}

export interface ConfiguredVoucherType {
  id: string;
  name: string;
  base_voucher_type: string;
  abbreviation?: string | null;
  is_system?: "Y" | "N";
}

export interface AccountingLedgerOption {
  id: string;
  name: string;
  category?: string | null;
  balanceType?: string | null;
  groupName?: string | null;
  groupPath?: string | null;
}

export interface AccountingLedgerOptions {
  voucherTypeId: string;
  voucherTypeName: string;
  baseVoucherType: string;
  debit: AccountingLedgerOption[];
  credit: AccountingLedgerOption[];
}

export interface VoucherRefs {
  ledgers: LedgerLite[];
  parties: PartyLite[];
  items: ItemLite[];
  costCenters: CostCenterLite[];
  gstRates: { rate: number }[];
}

let _voucherRefsCache: { data: VoucherRefs; timestamp: number } | null = null;
let _voucherRefsPromise: Promise<VoucherRefs> | null = null;
const CACHE_TTL_MS = 15000; // 15 seconds

export function invalidateVoucherRefsCache(): void {
  _voucherRefsCache = null;
  _voucherRefsPromise = null;
}

export async function loadVoucherRefs(forceRefresh = false): Promise<VoucherRefs> {
  const now = Date.now();
  if (!forceRefresh && _voucherRefsCache && now - _voucherRefsCache.timestamp < CACHE_TTL_MS) {
    return _voucherRefsCache.data;
  }
  if (!forceRefresh && _voucherRefsPromise) {
    return _voucherRefsPromise;
  }

  _voucherRefsPromise = (async () => {
    try {
      const [lr, cust, vend, ir, cc, gr] = await Promise.all([
        api.get("/ledgers"),
        api.get("/parties?key_group=C"),
        api.get("/parties?key_group=V"),
        api.get("/items"),
        api.get("/cost-centers"),
        api.get("/gst/rates"),
      ]);
      const parties = [
        ...(envelopeResult<PartyLite[]>(cust) || []),
        ...(envelopeResult<PartyLite[]>(vend) || []),
      ];
      // Dedupe "Both" parties that show in both lists.
      const seen = new Set<string>();
      const uniqueParties = parties.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
      const result: VoucherRefs = {
        ledgers: envelopeResult<LedgerLite[]>(lr) || [],
        parties: uniqueParties,
        items: ir.ok && Array.isArray(ir.data) ? ir.data : [],
        costCenters: envelopeResult<CostCenterLite[]>(cc) || [],
        gstRates: envelopeResult<{ rate: number }[]>(gr) || [],
      };
      _voucherRefsCache = { data: result, timestamp: Date.now() };
      return result;
    } finally {
      _voucherRefsPromise = null;
    }
  })();

  return _voucherRefsPromise;
}

export async function loadActiveVoucherTypes(
  baseVoucherType?: string
): Promise<ConfiguredVoucherType[]> {
  const query = baseVoucherType
    ? `?base_voucher_type=${encodeURIComponent(baseVoucherType)}`
    : "";
  const response = await api.get(`/voucher-types/active${query}`);
  return envelopeResult<ConfiguredVoucherType[]>(response) || [];
}

export async function loadAccountingLedgerOptions(
  voucherTypeId: string
): Promise<AccountingLedgerOptions | null> {
  const response = await api.get(
    `/vouchers/ledger-options?voucher_type_id=${encodeURIComponent(voucherTypeId)}`
  );
  return envelopeResult<AccountingLedgerOptions>(response);
}

export function findLedgerByName(ledgers: LedgerLite[], name: string): LedgerLite | undefined {
  const n = name.trim().toLowerCase();
  return ledgers.find((l) => (l.name || "").trim().toLowerCase() === n);
}

export function partyName(p: PartyLite): string {
  const n = p.name_contact_info || {};
  return n.display_name || n.company_name || n.first_name || "—";
}

export function partyState(p: PartyLite): string {
  return (p.address_info?.billing_address?.state || "").trim();
}

export interface GstSplit {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export function gstSplit(taxable: number, rate: number, interState: boolean): GstSplit {
  const tax = round2((taxable * rate) / 100);
  if (interState) return { cgst: 0, sgst: 0, igst: tax, total: tax };
  const half = round2(tax / 2);
  return { cgst: half, sgst: round2(tax - half), igst: 0, total: tax };
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export interface BuiltLine {
  line_no: number;
  ledger_id: string;
  cost_center_id?: string | null;
  debit_amount: number;
  credit_amount: number;
  remarks?: string | null;
}

/** Assign sequential line numbers and drop zero-amount lines. */
export function finalizeLines(
  rows: Array<Omit<BuiltLine, "line_no">>
): BuiltLine[] {
  return rows
    .filter((r) => (r.debit_amount || 0) > 0 || (r.credit_amount || 0) > 0)
    .map((r, i) => ({ ...r, line_no: i + 1 }));
}

export const VOUCHER_LABELS: Record<string, string> = {
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  SALES: "Sales",
  PURCHASE: "Purchase",
  JOURNAL: "Journal",
  CONTRA: "Contra",
};

export function computeDueDate(
  voucherDate: string,
  paymentTerms: string | null | undefined
): string {
  if (!voucherDate) return "";
  if (!paymentTerms) return voucherDate;

  const terms = paymentTerms.toLowerCase().trim();
  const match = terms.match(/(\d+)/);
  if (match) {
    const days = parseInt(match[1], 10);
    if (!isNaN(days) && days > 0) {
      const d = new Date(voucherDate);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }
  }
  return voucherDate;
}
