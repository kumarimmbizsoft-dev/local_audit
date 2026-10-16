import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Download, Upload, Lock, Unlock, Receipt, Settings, X, UserPlus, ListPlus } from "lucide-react";
import { api, envelopeOk, envelopeMessage, envelopeResult } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useCompany } from "../auth/CompanyContext";
import { useToast } from "../components/toast";
import { money } from "../lib/format";
import { quickGstinHint, type Hint } from "../lib/gst";
import { downloadCSV } from "../lib/csv";
import { useHotkeys } from "../lib/hotkeys";
import { ActivityDrawer } from "../components/ActivityDrawer";
import { ImportDialog } from "../components/ImportDialog";
import {
  Button,
  DatePicker,
  Field,
  Input,
  Select,
  Textarea,
  PageHeader,
  Panel,
  SearchBox,
  TableWrap,
  Th,
  Td,
  EmptyRow,
  Money,
  Badge,
  Modal,
  RowActions,
  Drawer,
  ConfirmDialog,
  Spinner,
  ValidationHint,
} from "../components/ui";

interface Ledger {
  id: string;
  name: string;
  ledger_group_id: string | null;
  category: string | null;
  balance_type: string | null;
  opening_balance: number | null;
  opening_balance_date: string | null;
  description: string | null;
  gstin: string | null;
  gst_type: string | null;
  default_gst_rate: number | null;
  hsn_sac: string | null;
  address: string | null;
  contact_person: string | null;
  email: string | null;
  mobile: string | null;
  credit_limit: number | null;
  payment_terms: string | null;
  default_narration: string | null;
  tags: string | null;
  cost_center_id: string | null;
  is_bank?: string | null;
  is_cash?: string | null;
  is_frozen: string;
  active: string;
  is_system: string;
}
interface Group {
  id: string;
  name: string;
  code?: string | null;
  parent_id: string | null;
  key_group: string | null;
  balance_type: string | null;
}
interface Activity {
  voucherNo: string;
  voucherDate: string;
  voucherType: string;
  debitAmount: number;
  creditAmount: number;
  voucherStatus: string;
}
interface CostCenter {
  id: string;
  name: string;
}
interface CustomFieldDef {
  id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  options: string[] | null;
  is_required: string;
}

const GST_CATEGORIES = new Set(["customer", "vendor", "income", "expense", "tax"]);

interface BulkRow {
  name: string;
  opening_balance: string;
  balance_type: string;
}

interface FormState {
  id: string | null;
  name: string;
  primaryId: string;
  mainId: string;
  groupId: string;
  balance_type: string;
  opening_balance: string;
  opening_balance_date: string;
  description: string;
  gstin: string;
  gst_type: string;
  default_gst_rate: string;
  hsn_sac: string;
  address: string;
  contact_person: string;
  email: string;
  mobile: string;
  credit_limit: string;
  payment_terms: string;
  default_narration: string;
  tags: string;
  cost_center_id: string;
  custom_fields: Record<string, string>;
  bank_name: string;
  account_holder_name: string;
  account_number: string;
  ifsc_code: string;
  branch_name: string;
  pan: string;
  b_line1: string;
  b_line2: string;
  b_city: string;
  b_state: string;
  b_pincode: string;
  s_line1: string;
  s_line2: string;
  s_city: string;
  s_state: string;
  s_pincode: string;
  same_as_billing: boolean;
}

const emptyForm = (): FormState => ({
  id: null,
  name: "",
  primaryId: "",
  mainId: "",
  groupId: "",
  balance_type: "",
  opening_balance: "",
  opening_balance_date: "",
  description: "",
  gstin: "",
  gst_type: "",
  default_gst_rate: "",
  hsn_sac: "",
  address: "",
  contact_person: "",
  email: "",
  mobile: "",
  credit_limit: "",
  payment_terms: "",
  default_narration: "",
  tags: "",
  cost_center_id: "",
  custom_fields: {},
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  ifsc_code: "",
  branch_name: "",
  pan: "",
  b_line1: "",
  b_line2: "",
  b_city: "",
  b_state: "",
  b_pincode: "",
  s_line1: "",
  s_line2: "",
  s_city: "",
  s_state: "",
  s_pincode: "",
  same_as_billing: true,
});

const defaultBulkRows = (): BulkRow[] => [
  { name: "", opening_balance: "", balance_type: "" },
  { name: "", opening_balance: "", balance_type: "" },
  { name: "", opening_balance: "", balance_type: "" },
];

export function Ledgers() {
  const { can } = useAuth();
  const { company } = useCompany();
  const fyStart = company?.financial_year_start ? company.financial_year_start.slice(0, 10) : "";
  const { toast } = useToast();
  const loc = useLocation();
  const nav = useNavigate();
  const canWrite = can("LEDGER", "write");
  const canDelete = can("LEDGER", "delete");
  const canViewActivity = can("VOUCHER", "view");

  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const [gstRates, setGstRates] = useState<{ rate: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState((loc.state as any)?.search || "");
  const [gstFilter, setGstFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const searchRef = useRef<HTMLInputElement>(null);

  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameHint, setNameHint] = useState<Hint | null>(null);
  const [gstinHint, setGstinHint] = useState<Hint | null>(null);
  const [groupSuggestion, setGroupSuggestion] = useState<{ id: string; name: string; balance_type: string } | null>(null);
  type QuickLedgerType = "BANK" | "CASH" | "CUSTOMER" | "VENDOR" | "BOTH" | "";
  const [quickType, setQuickType] = useState<QuickLedgerType>("");

  const [toDelete, setToDelete] = useState<Ledger | null>(null);
  const [activityFor, setActivityFor] = useState<Ledger | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [auditFor, setAuditFor] = useState<Ledger | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkQuickType, setBulkQuickType] = useState<QuickLedgerType>("");
  const [bulkPrimary, setBulkPrimary] = useState("");
  const [bulkMain, setBulkMain] = useState("");
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkDate, setBulkDate] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(defaultBulkRows());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSubmitted, setBulkSubmitted] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    const inc = statusFilter === "all" ? "?include_inactive=true" : "";
    const [lr, gr, cc, cf, rr] = await Promise.all([
      api.get(`/ledgers${inc}`),
      api.get("/ledger-groups"),
      api.get("/cost-centers"),
      api.get("/custom-fields?module=LEDGER"),
      api.get("/gst/rates"),
    ]);
    setLedgers(envelopeResult<Ledger[]>(lr) || []);
    setGroups(envelopeResult<Group[]>(gr) || []);
    setCostCenters(envelopeResult<CostCenter[]>(cc) || []);
    setCustomDefs(envelopeResult<CustomFieldDef[]>(cf) || []);
    setGstRates(envelopeResult<{ rate: number }[]>(rr) || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if ((loc.state as any)?.openNew && canWrite) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHotkeys(
    useMemo(
      () => ({
        "ctrl+n": () => canWrite && openCreate(),
        "ctrl+s": () => (drawer ? save(false) : bulkOpen && saveBulk()),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [drawer, bulkOpen, bulkRows, bulkGroup, bulkDate, canWrite]
    )
  );

  // Live duplicate + GSTIN validation via POST /ledgers/validate (debounced).
  useEffect(() => {
    if (!drawer) return;
    const g = quickGstinHint(form.gstin);
    if (g && g.level !== "ok") setGstinHint(g);
    const t = setTimeout(async () => {
      if (!form.name.trim() && !form.gstin) return;
      const r = await api.post("/ledgers/validate", {
        id: form.id,
        name: form.name || null,
        gstin: form.gstin || null,
        ledger_group_id: form.groupId || null,
      });
      const res = envelopeResult<any>(r);
      if (res?.name) setNameHint(res.name);
      if (res?.gstin)
        setGstinHint({
          level: res.gstin.level === "ok" ? "ok" : res.gstin.level,
          message: res.gstin.message,
        });
      else if (!form.gstin) setGstinHint(null);
    }, 350);
    return () => clearTimeout(t);
  }, [form.name, form.gstin, form.groupId, form.id, drawer]);

  // Auto-suggest group from ledger name.
  useEffect(() => {
    if (!drawer || form.groupId) return;
    if (form.name.length < 4) return;
    const t = setTimeout(async () => {
      const r = await api.get(
        `/ledgers/suggest-group?name=${encodeURIComponent(form.name)}`
      );
      setGroupSuggestion(envelopeResult<any>(r));
    }, 350);
    return () => clearTimeout(t);
  }, [form.name, form.groupId, drawer]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const groupPath = (id: string | null) => {
    const parts: string[] = [];
    let g = id ? groupById.get(id) : undefined;
    while (g) {
      parts.unshift(g.name);
      g = g.parent_id ? groupById.get(g.parent_id) : undefined;
    }
    return parts.join(" › ") || "—";
  };

  const getCategoryAndFlags = (groupId: string | null) => {
    if (!groupId) return { category: null, is_bank: "N", is_cash: "N" };
    let cur = groupById.get(groupId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const code = (cur.code || "").toUpperCase();
      const name = (cur.name || "").toLowerCase();
      if (code === "BANK_ACCOUNTS" || code === "BANK_OD" || code === "BANK_OCC" || name.includes("bank")) {
        return { category: "bank", is_bank: "Y", is_cash: "N" };
      }
      if (code === "CASH_IN_HAND" || name.includes("cash")) {
        return { category: "cash", is_bank: "N", is_cash: "Y" };
      }
      cur = cur.parent_id ? groupById.get(cur.parent_id) : undefined;
    }
    return { category: null, is_bank: "N", is_cash: "N" };
  };

  function selectQuickType(type: "BANK" | "CASH" | "CUSTOMER" | "VENDOR" | "BOTH") {
    if (quickType === type) {
      setQuickType("");
      setForm((prev) => ({
        ...prev,
        primaryId: "",
        mainId: "",
        groupId: "",
        balance_type: "",
      }));
      return;
    }

    const sub = groups.find((g) => {
      if (g.key_group !== "S") return false;
      const c = (g.code || "").toUpperCase();
      const n = (g.name || "").toLowerCase().trim();
      if (type === "BANK") return c === "BANK_ACCOUNTS" || n === "bank accounts" || n.startsWith("bank account");
      if (type === "CASH") return c === "CASH_IN_HAND" || n === "cash-in-hand" || n.includes("cash");
      if (type === "CUSTOMER" || type === "BOTH") return c === "SUNDRY_DEBTORS" || n === "sundry debtors" || n.includes("debtor");
      if (type === "VENDOR") return c === "SUNDRY_CREDITORS" || n === "sundry creditors" || n.includes("creditor");
      return false;
    });

    if (sub) {
      const main = sub.parent_id ? groupById.get(sub.parent_id) : undefined;
      const primary = main?.parent_id ? groupById.get(main.parent_id) : undefined;

      setQuickType(type);
      setForm((prev) => ({
        ...prev,
        primaryId: type === "BOTH" ? "" : (primary?.id || ""),
        mainId: type === "BOTH" ? "" : (main?.id || ""),
        groupId: type === "BOTH" ? "" : sub.id,
        balance_type: type === "VENDOR" ? "CR" : (type === "CUSTOMER" || type === "BOTH") ? "DR" : (sub.balance_type || "DR"),
      }));
    } else {
      setQuickType(type);
    }
  }

  // Deduplicate groups by (key_group, name, parent_id) to avoid duplicate dropdown options
  const uniqueGroups = useMemo(() => {
    const seen = new Set<string>();
    return groups.filter((g) => {
      const key = `${g.key_group}_${(g.name || "").trim().toLowerCase()}_${g.parent_id || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [groups]);

  const primaries = uniqueGroups.filter((g) => g.key_group === "P");
  const mains = uniqueGroups.filter((g) => g.key_group === "M" && g.parent_id === form.primaryId);
  const subs = uniqueGroups.filter((g) => g.key_group === "S" && g.parent_id === form.mainId);

  const bulkPrimaries = uniqueGroups.filter((g) => g.key_group === "P");
  const bulkMains = uniqueGroups.filter((g) => g.key_group === "M" && g.parent_id === bulkPrimary);
  const bulkSubs = uniqueGroups.filter((g) => g.key_group === "S" && g.parent_id === bulkMain);

  const gstStatusOf = (l: Ledger): string => {
    if (l.gstin) return "REGISTERED";
    if (l.gst_type === "UNREGISTERED") return "UNREGISTERED";
    if (l.gst_type === "COMPOSITION") return "COMPOSITION";
    if (l.gst_type === "EXEMPT") return "EXEMPT";
    if (l.category && GST_CATEGORIES.has(l.category)) return "MISSING";
    return "NA";
  };

  const filtered = useMemo(
    () =>
      ledgers.filter(
        (l) =>
          (gstFilter === "ALL" || gstStatusOf(l) === gstFilter) &&
          `${l.name} ${l.gstin || ""}`.toLowerCase().includes(q.toLowerCase())
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ledgers, q, gstFilter]
  );

  const showGst = true;

  function openNew() {
    setForm({ ...emptyForm(), opening_balance_date: fyStart });
    setQuickType("");
    setSubmitted(false);
    setNameHint(null);
    setGstinHint(null);
    setGroupSuggestion(null);
    setDrawer(true);
  }
  function openCreate() {
    setChooserOpen(true);
  }
  function openBulkNew() {
    setBulkQuickType("");
    setBulkPrimary("");
    setBulkMain("");
    setBulkGroup("");
    setBulkDate(fyStart);
    setBulkRows(defaultBulkRows());
    setBulkErrors({});
    setBulkSubmitted(false);
    setBulkSaving(false);
    setBulkOpen(true);
  }
  function selectBulkQuickType(type: "BANK" | "CASH" | "CUSTOMER" | "VENDOR") {
    if (bulkQuickType === type) {
      setBulkQuickType("");
      setBulkPrimary("");
      setBulkMain("");
      setBulkGroup("");
      setBulkErrors({});
      return;
    }

    const sub = groups.find((g) => {
      if (g.key_group !== "S") return false;
      const c = (g.code || "").toUpperCase();
      const n = (g.name || "").toLowerCase().trim();
      if (type === "BANK") return c === "BANK_ACCOUNTS" || n === "bank accounts" || n.startsWith("bank account");
      if (type === "CASH") return c === "CASH_IN_HAND" || n === "cash-in-hand" || n.includes("cash");
      if (type === "CUSTOMER") return c === "SUNDRY_DEBTORS" || n === "sundry debtors" || n.includes("debtor");
      if (type === "VENDOR") return c === "SUNDRY_CREDITORS" || n === "sundry creditors" || n.includes("creditor");
      return false;
    });

    if (sub) {
      const main = sub.parent_id ? groupById.get(sub.parent_id) : undefined;
      const primary = main?.parent_id ? groupById.get(main.parent_id) : undefined;

      setBulkQuickType(type);
      setBulkPrimary(primary?.id || "");
      setBulkMain(main?.id || "");
      selectBulkGroup(sub.id);
    } else {
      setBulkQuickType(type);
    }
  }
  function setBulkRow(i: number, patch: Partial<BulkRow>) {
    setBulkRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setBulkErrors((e) => {
      const n = { ...e };
      delete n[i];
      return n;
    });
  }
  function addBulkRow() {
    setBulkRows((rows) => [...rows, { name: "", opening_balance: "", balance_type: "" }]);
  }
  function removeBulkRow(i: number) {
    setBulkRows((rows) => rows.filter((_, idx) => idx !== i));
  }
  function selectBulkGroup(gid: string) {
    setBulkGroup(gid);
    setBulkErrors({});
    const bt = gid ? groupById.get(gid)?.balance_type || "" : "";
    setBulkRows((rows) => rows.map((r) => (r.balance_type ? r : { ...r, balance_type: bt })));
  }
  async function saveBulk() {
    setBulkSubmitted(true);
    if (!bulkGroup) {
      toast({ title: "Sub-category required", desc: "Choose Primary → Main → Sub-category first.", tone: "error" });
      return;
    }
    const filledIdx: number[] = [];
    const items = bulkRows
      .map((r, i) => {
        const name = r.name.trim();
        if (!name) return null;
        filledIdx.push(i);
        return {
          name,
          opening_balance: r.opening_balance ? Number(r.opening_balance) : 0,
          balance_type: r.balance_type || null,
        };
      })
      .filter((x): x is { name: string; opening_balance: number; balance_type: string | null } => x !== null);
    if (items.length === 0) {
      toast({ title: "Nothing to create", desc: "Enter at least one ledger name.", tone: "error" });
      return;
    }
    setBulkSaving(true);
    const r = await api.post("/ledgers/bulk", {
      ledger_group_id: bulkGroup,
      opening_balance_date: bulkDate || null,
      items,
    });
    setBulkSaving(false);
    const res = envelopeResult<{ created: number; failed: number; errors: { row: number; name?: string; message: string }[] }>(r);
    if (!res) {
      toast({ title: "Could not create", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    load();
    if (res.failed === 0) {
      toast({ title: `Created ${res.created} ledger(s)`, desc: "Done.", tone: "success" });
      setBulkOpen(false);
      setBulkErrors({});
      return;
    }
    const kept: BulkRow[] = [];
    const errMap: Record<number, string> = {};
    res.errors.forEach((e) => {
      const orig = filledIdx[e.row - 1];
      if (orig === undefined) return;
      const pos = kept.length;
      kept.push(bulkRows[orig]);
      errMap[pos] = e.message;
    });
    setBulkRows(kept.length ? kept : defaultBulkRows());
    setBulkErrors(errMap);
    toast({
      title: `Created ${res.created}, ${res.failed} failed`,
      desc: "Fix the highlighted rows and save again.",
      tone: res.created > 0 ? "info" : "error",
    });
  }
  function openEdit(l: Ledger) {
    const sub = l.ledger_group_id ? groupById.get(l.ledger_group_id) : undefined;
    const main = sub?.parent_id ? groupById.get(sub.parent_id) : undefined;
    const primary = main?.parent_id ? groupById.get(main.parent_id) : undefined;

    const subCode = (sub?.code || "").toUpperCase();
    const subName = (sub?.name || "").toLowerCase();
    let initialType: QuickLedgerType = "";
    if (l.is_bank === "Y" || subCode === "BANK_ACCOUNTS" || subName.includes("bank")) initialType = "BANK";
    else if (l.is_cash === "Y" || subCode === "CASH_IN_HAND" || subName.includes("cash")) initialType = "CASH";
    else if (subCode === "SUNDRY_DEBTORS" || subName.includes("debtor") || l.category === "customer") {
      const hasVendorPartner = ledgers.some(
        (other) =>
          other.id !== l.id &&
          other.name.trim().toLowerCase() === l.name.trim().toLowerCase() &&
          (other.category === "vendor" || groupById.get(other.ledger_group_id || "")?.code === "SUNDRY_CREDITORS")
      );
      initialType = hasVendorPartner ? "BOTH" : "CUSTOMER";
    } else if (subCode === "SUNDRY_CREDITORS" || subName.includes("creditor") || l.category === "vendor") {
      const hasCustomerPartner = ledgers.some(
        (other) =>
          other.id !== l.id &&
          other.name.trim().toLowerCase() === l.name.trim().toLowerCase() &&
          (other.category === "customer" || groupById.get(other.ledger_group_id || "")?.code === "SUNDRY_DEBTORS")
      );
      initialType = hasCustomerPartner ? "BOTH" : "VENDOR";
    }
    setQuickType(initialType);

    setForm({
      id: l.id,
      name: l.name,
      primaryId: primary?.id ?? "",
      mainId: main?.id ?? "",
      groupId: sub?.id ?? "",
      balance_type: l.balance_type ?? "",
      opening_balance: l.opening_balance != null ? String(l.opening_balance) : "",
      opening_balance_date: l.opening_balance_date ?? "",
      description: l.description ?? "",
      gstin: l.gstin ?? "",
      gst_type: l.gst_type ?? "",
      default_gst_rate: l.default_gst_rate != null ? String(l.default_gst_rate) : "",
      hsn_sac: l.hsn_sac ?? "",
      address: l.address ?? "",
      contact_person: l.contact_person ?? "",
      email: l.email ?? "",
      mobile: l.mobile ?? "",
      credit_limit: l.credit_limit != null ? String(l.credit_limit) : "",
      payment_terms: l.payment_terms ?? "",
      default_narration: l.default_narration ?? "",
      tags: l.tags ?? "",
      cost_center_id: l.cost_center_id ?? "",
      custom_fields: ((l as any).custom_fields as Record<string, string>) || {},
      bank_name: "",
      account_holder_name: l.name,
      account_number: "",
      ifsc_code: "",
      branch_name: "",
      pan: "",
      b_line1: "",
      b_line2: "",
      b_city: "",
      b_state: "",
      b_pincode: "",
      s_line1: "",
      s_line2: "",
      s_city: "",
      s_state: "",
      s_pincode: "",
      same_as_billing: true,
    });

    if (initialType === "BANK") {
      api.get("/api/bank-accounts").then((r) => {
        const accounts = envelopeResult<any[]>(r) || [];
        const match = accounts.find((a) => a.ledger_id === l.id);
        if (match) {
          setForm((prev) => ({
            ...prev,
            account_number: match.account_number || "",
            account_holder_name: match.account_holder_name || "",
            ifsc_code: match.ifsc_code || "",
            branch_name: match.branch || "",
            bank_name: match.bank_name || "",
          }));
        }
      });
    } else if (initialType === "CUSTOMER" || initialType === "VENDOR" || initialType === "BOTH") {
      api.get(`/parties`).then((r) => {
        const parties = envelopeResult<any[]>(r) || [];
        const match = parties.find(
          (p) =>
            p.ledger_id === l.id ||
            (p.name_contact_info?.company_name || "").toLowerCase() === l.name.toLowerCase()
        );
        if (match) {
          const b = match.address_info?.billing_address || {};
          const s = match.address_info?.shipping_address || {};
          setForm((prev) => ({
            ...prev,
            pan: match.pan || prev.pan,
            b_line1: b.address_line1 || "",
            b_line2: b.address_line2 || "",
            b_city: b.city || "",
            b_state: b.state || "",
            b_pincode: b.pincode || "",
            s_line1: s.address_line1 || "",
            s_line2: s.address_line2 || "",
            s_city: s.city || "",
            s_state: s.state || "",
            s_pincode: s.pincode || "",
            same_as_billing: match.address_info?.same_as_billing ?? true,
          }));
        }
      });
    }
    setSubmitted(false);
    setNameHint(null);
    setGstinHint(null);
    setGroupSuggestion(null);
    setDrawer(true);
  }

  async function save(andNew: boolean) {
    setSubmitted(true);
    if (!form.name.trim()) return;
    if (nameHint?.level === "error" && !form.id) return;
    setSaving(true);

    const formattedBilling = [form.b_line1, form.b_line2, form.b_city, form.b_state, form.b_pincode]
      .filter(Boolean)
      .join(", ");
    const finalAddress = formattedBilling || form.address || null;

    if (quickType === "BOTH") {
      const debtorSub = groups.find((g) => {
        if (g.key_group !== "S") return false;
        const c = (g.code || "").toUpperCase();
        const n = (g.name || "").toLowerCase().trim();
        return c === "SUNDRY_DEBTORS" || n === "sundry debtors" || n.includes("debtor");
      });
      const creditorSub = groups.find((g) => {
        if (g.key_group !== "S") return false;
        const c = (g.code || "").toUpperCase();
        const n = (g.name || "").toLowerCase().trim();
        return c === "SUNDRY_CREDITORS" || n === "sundry creditors" || n.includes("creditor");
      });

      const debtorBal = form.balance_type === "CR" ? 0 : form.opening_balance ? Number(form.opening_balance) : 0;
      const creditorBal = form.balance_type === "CR" ? (form.opening_balance ? Number(form.opening_balance) : 0) : 0;

      const basePayload = {
        name: form.name.trim(),
        opening_balance_date: form.opening_balance_date || null,
        description: form.description || null,
        gstin: form.gstin ? form.gstin.toUpperCase() : null,
        gst_type: form.gst_type || null,
        default_gst_rate: form.default_gst_rate ? Number(form.default_gst_rate) : null,
        hsn_sac: form.hsn_sac || null,
        address: finalAddress,
        contact_person: form.contact_person || null,
        email: form.email || null,
        mobile: form.mobile || null,
        credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
        payment_terms: form.payment_terms || null,
        active: "Y",
      };

      const dPayload = {
        ...basePayload,
        category: "customer",
        is_bank: "N",
        is_cash: "N",
        ledger_group_id: debtorSub?.id || null,
        balance_type: "DR",
        opening_balance: debtorBal,
      };

      const cPayload = {
        ...basePayload,
        category: "vendor",
        is_bank: "N",
        is_cash: "N",
        ledger_group_id: creditorSub?.id || null,
        balance_type: "CR",
        opening_balance: creditorBal,
      };

      if (form.id) {
        await api.put(`/ledgers/${form.id}`, form.balance_type === "CR" ? cPayload : dPayload);
        const partner = ledgers.find(
          (other) =>
            other.id !== form.id && other.name.trim().toLowerCase() === form.name.trim().toLowerCase()
        );
        if (partner) {
          await api.put(`/ledgers/${partner.id}`, form.balance_type === "CR" ? dPayload : cPayload);
        } else {
          await api.post("/ledgers", form.balance_type === "CR" ? dPayload : cPayload);
        }
      } else {
        await api.post("/ledgers", dPayload);
        await api.post("/ledgers", cPayload);
      }

      // Sync to master.party
      const partyPayload = {
        key_group: "B",
        active: "Y",
        gstin: form.gstin ? form.gstin.toUpperCase() : null,
        pan: form.pan ? form.pan.toUpperCase() : null,
        gst_type: form.gst_type || null,
        name_contact_info: {
          first_name: form.name.trim(),
          company_name: form.name.trim(),
          display_name: form.name.trim(),
          email: form.email || null,
          mobile_number: form.mobile || null,
          contact_persons: form.contact_person
            ? [{ name: form.contact_person, mobile: form.mobile || null, email: form.email || null }]
            : [],
        },
        address_info: {
          billing_address: {
            address_line1: form.b_line1 || null,
            address_line2: form.b_line2 || null,
            city: form.b_city || null,
            state: form.b_state || null,
            country: "India",
            pincode: form.b_pincode || null,
          },
          shipping_address: form.same_as_billing
            ? {
              address_line1: form.b_line1 || null,
              address_line2: form.b_line2 || null,
              city: form.b_city || null,
              state: form.b_state || null,
              country: "India",
              pincode: form.b_pincode || null,
            }
            : {
              address_line1: form.s_line1 || null,
              address_line2: form.s_line2 || null,
              city: form.s_city || null,
              state: form.s_state || null,
              country: "India",
              pincode: form.s_pincode || null,
            },
          same_as_billing: form.same_as_billing,
        },
        payment_info: {
          terms: form.payment_terms || null,
          credit_limit: form.credit_limit ? Number(form.credit_limit) : 0,
        },
        additional_info: {
          opening_bal: form.opening_balance ? Number(form.opening_balance) : 0,
          date: form.opening_balance_date || null,
        },
      };

      const partyRes = await api.get(`/parties?key_group=B`);
      const existingParties = envelopeResult<any[]>(partyRes) || [];
      const matchParty = existingParties.find(
        (p) => (p.name_contact_info?.company_name || "").toLowerCase() === form.name.trim().toLowerCase()
      );
      if (matchParty) {
        await api.put(`/parties/${matchParty.id}`, partyPayload);
      } else {
        await api.post("/parties", partyPayload);
      }

      setSaving(false);
      toast({
        title: form.id ? "Dual Ledger updated" : "Dual Ledger created",
        desc: `${form.name} (Debtor & Creditor)`,
        tone: "success",
      });
      if (andNew) {
        setForm({ ...emptyForm(), opening_balance_date: fyStart });
        setQuickType("");
        setSubmitted(false);
        setNameHint(null);
        setGstinHint(null);
      } else {
        setDrawer(false);
      }
      load();
      return;
    }

    const catFlags = getCategoryAndFlags(form.groupId || null);
    const isBank = quickType === "BANK" ? "Y" : catFlags.is_bank || "N";
    const isCash = quickType === "CASH" ? "Y" : catFlags.is_cash || "N";
    const category =
      quickType === "BANK"
        ? "bank"
        : quickType === "CASH"
          ? "cash"
          : quickType === "CUSTOMER"
            ? "customer"
            : quickType === "VENDOR"
              ? "vendor"
              : catFlags.category;

    const payload = {
      name: form.name.trim(),
      category,
      is_bank: isBank,
      is_cash: isCash,
      ledger_group_id: form.groupId || null,
      balance_type:
        form.balance_type ||
        (form.groupId ? groupById.get(form.groupId)?.balance_type : null) ||
        (quickType === "VENDOR" ? "CR" : "DR"),
      opening_balance: form.opening_balance ? Number(form.opening_balance) : 0,
      opening_balance_date: form.opening_balance_date || null,
      description: form.description || null,
      gstin: form.gstin ? form.gstin.toUpperCase() : null,
      gst_type: form.gst_type || null,
      default_gst_rate: form.default_gst_rate ? Number(form.default_gst_rate) : null,
      hsn_sac: form.hsn_sac || null,
      address: finalAddress,
      contact_person: form.contact_person || null,
      email: form.email || null,
      mobile: form.mobile || null,
      credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
      payment_terms: form.payment_terms || null,
      default_narration: form.default_narration || null,
      tags: form.tags || null,
      cost_center_id: form.cost_center_id || null,
      custom_fields: Object.keys(form.custom_fields).length ? form.custom_fields : null,
      active: "Y",
    };

    const r = form.id ? await api.put(`/ledgers/${form.id}`, payload) : await api.post("/ledgers", payload);
    setSaving(false);
    if (!envelopeOk(r)) {
      toast({ title: "Could not save", desc: envelopeMessage(r), tone: "error" });
      return;
    }

    const createdLedgerId = form.id || envelopeResult<any>(r)?.id;

    // Bank Account Master sync
    if (quickType === "BANK" && form.account_number && createdLedgerId) {
      const bPayload = {
        account_type: "BANK",
        bank_name: form.bank_name || form.name.trim(),
        account_holder_name: form.account_holder_name ? form.account_holder_name.trim() : null,
        account_number: form.account_number.trim(),
        ifsc_code: form.ifsc_code.trim(),
        branch: form.branch_name.trim(),
        ledger_id: createdLedgerId,
      };
      api.get("/bank-accounts").then((bRes) => {
        const accounts = envelopeResult<any[]>(bRes) || [];
        const match = accounts.find((a) => a.ledger_id === createdLedgerId);
        if (match) {
          api.put(`/bank-accounts/${match.id}`, bPayload).catch(() => { });
        } else {
          api.post("/bank-accounts", bPayload).catch(() => { });
        }
      });
    }

    // Party sync for Customer or Vendor
    if ((quickType === "CUSTOMER" || quickType === "VENDOR") && createdLedgerId) {
      const partyKey = quickType === "CUSTOMER" ? "C" : "V";
      const pPayload = {
        key_group: partyKey,
        active: "Y",
        gstin: form.gstin ? form.gstin.toUpperCase() : null,
        pan: form.pan ? form.pan.toUpperCase() : null,
        gst_type: form.gst_type || null,
        name_contact_info: {
          first_name: form.name.trim(),
          company_name: form.name.trim(),
          display_name: form.name.trim(),
          email: form.email || null,
          mobile_number: form.mobile || null,
          contact_persons: form.contact_person
            ? [{ name: form.contact_person, mobile: form.mobile || null, email: form.email || null }]
            : [],
        },
        address_info: {
          billing_address: {
            address_line1: form.b_line1 || null,
            address_line2: form.b_line2 || null,
            city: form.b_city || null,
            state: form.b_state || null,
            country: "India",
            pincode: form.b_pincode || null,
          },
          shipping_address: form.same_as_billing
            ? {
              address_line1: form.b_line1 || null,
              address_line2: form.b_line2 || null,
              city: form.b_city || null,
              state: form.b_state || null,
              country: "India",
              pincode: form.b_pincode || null,
            }
            : {
              address_line1: form.s_line1 || null,
              address_line2: form.s_line2 || null,
              city: form.s_city || null,
              state: form.s_state || null,
              country: "India",
              pincode: form.s_pincode || null,
            },
          same_as_billing: form.same_as_billing,
        },
        payment_info: {
          terms: form.payment_terms || null,
          credit_limit: form.credit_limit ? Number(form.credit_limit) : 0,
        },
        additional_info: {
          opening_bal: form.opening_balance ? Number(form.opening_balance) : 0,
          date: form.opening_balance_date || null,
        },
      };

      api.get(`/parties?key_group=${partyKey}`).then((pRes) => {
        const pList = envelopeResult<any[]>(pRes) || [];
        const match = pList.find(
          (p) =>
            p.ledger_id === createdLedgerId ||
            (p.name_contact_info?.company_name || "").toLowerCase() === form.name.trim().toLowerCase()
        );
        if (match) {
          api.put(`/parties/${match.id}`, pPayload).catch(() => { });
        } else {
          api.post("/parties", pPayload).catch(() => { });
        }
      });
    }

    toast({ title: form.id ? "Ledger updated" : "Ledger created", desc: form.name, tone: "success" });
    if (andNew) {
      setForm({ ...emptyForm(), opening_balance_date: fyStart });
      setQuickType("");
      setSubmitted(false);
      setNameHint(null);
      setGstinHint(null);
    } else {
      setDrawer(false);
    }
    load();
  }

  async function saveAndTransact() {
    const ledgerName = form.name.trim();
    const origId = form.id;
    await save(false);
    nav("/app/journal", {
      state: { openNew: true, ledgerId: origId, ledgerName },
    });
  }

  async function toggleFreeze(l: Ledger) {
    const next = l.is_frozen === "Y" ? "N" : "Y";
    const r = await api.patch(`/ledgers/${l.id}/freeze?frozen=${next}`);
    toast({ title: envelopeMessage(r), tone: envelopeOk(r) ? "success" : "error" });
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await api.del(`/ledgers/${toDelete.id}`);
    if (!envelopeOk(r)) {
      toast({ title: "Could not delete", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({ title: "Ledger deactivated", desc: "History is preserved.", tone: "success" });
    load();
  }

  async function openActivity(l: Ledger) {
    setActivityFor(l);
    setActivity([]);
    const r = await api.get(`/vouchers/ledger/${l.id}`);
    setActivity(envelopeResult<Activity[]>(r) || []);
  }

  function exportCSV() {
    downloadCSV(
      "ledgers.csv",
      ["name", "group", "category", "balance_type", "opening_balance", "gstin", "status"],
      filtered.map((l) => [
        l.name,
        groupPath(l.ledger_group_id),
        l.category || "",
        l.balance_type || "",
        l.opening_balance || 0,
        l.gstin || "",
        l.active === "Y" ? "Active" : "Inactive",
      ])
    );
  }

  const gstStatus = (l: Ledger) => {
    if (l.gstin) return <Badge tone="ok">Registered</Badge>;
    if (l.gst_type === "UNREGISTERED") return <Badge tone="muted">Unregistered</Badge>;
    if (l.gst_type === "COMPOSITION") return <Badge tone="warn">Composition</Badge>;
    if (l.gst_type === "EXEMPT") return <Badge tone="muted">Exempt</Badge>;
    if (l.category && GST_CATEGORIES.has(l.category)) return <Badge tone="warn">Missing</Badge>;
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    <PageHeader
      title="Ledger Master"
      sub="Chart of accounts — every voucher line maps to a ledger"
      actions={
        <>
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1.5" />
              Import
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={openCreate} title="Ctrl+N">
              <Plus className="h-4 w-4 mr-1.5" />
              New ledger
            </Button>
          )}
          <Button size="sm" variant="ghost" title="Master settings (custom fields)" onClick={() => nav("/app/custom-fields")}>
            <Settings className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <Panel
        pad={false}
        title={`${filtered.length} ledgers`}
        right={
          <div className="flex items-center gap-2">
            <Select value={gstFilter} onChange={(e) => setGstFilter(e.target.value)} className="h-9 w-36 bg-card">
              <option value="ALL">All GST status</option>
              <option value="REGISTERED">Registered</option>
              <option value="MISSING">Missing</option>
              <option value="UNREGISTERED">Unregistered</option>
              <option value="COMPOSITION">Composition</option>
              <option value="EXEMPT">Exempt</option>
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-9 w-32 bg-card">
              <option value="active">Active only</option>
              <option value="all">All statuses</option>
            </Select>
            <SearchBox value={q} onChange={setQ} placeholder="Search name, GSTIN" inputRef={searchRef} />
          </div>
        }
      >
        {loading ? (
          <Spinner />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Group</Th>
                <Th className="w-24">Type</Th>
                <Th className="w-28">GST status</Th>
                <Th right>Opening balance</Th>
                <Th className="w-24">Status</Th>
                <Th className="w-44" right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <EmptyRow colSpan={7} text="No ledgers match your search." />}
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-muted/40">
                  <Td>
                    {canViewActivity ? (
                      <button
                        className="font-medium text-[var(--teal)] hover:underline underline-offset-2 text-left"
                        onClick={() => openActivity(l)}
                      >
                        {l.name}
                      </button>
                    ) : (
                      <span className="font-medium">{l.name}</span>
                    )}
                    {l.gstin && <div className="mono text-[11px] text-muted-foreground mt-0.5">{l.gstin}</div>}
                  </Td>
                  <Td className="text-muted-foreground">{groupPath(l.ledger_group_id)}</Td>
                  <Td>
                    {l.balance_type ? (
                      <Badge tone={l.balance_type === "DR" ? "ok" : "warn"}>
                        {l.balance_type === "DR" ? "Debit" : "Credit"}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>{gstStatus(l)}</Td>
                  <Td right>
                    <Money v={l.opening_balance || 0} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={l.active === "Y" ? "ok" : "muted"}>{l.active === "Y" ? "Active" : "Inactive"}</Badge>
                      {l.is_frozen === "Y" && (
                        <span title="Frozen for audit" className="hint-warning">
                          <Lock className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      {canWrite && l.is_system !== "Y" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          title={l.is_frozen === "Y" ? "Unfreeze ledger" : "Freeze / block for audit"}
                          onClick={() => toggleFreeze(l)}
                        >
                          {l.is_frozen === "Y" ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <RowActions
                        canEdit={canWrite && l.is_frozen !== "Y"}
                        canDelete={canDelete && l.is_system !== "Y"}
                        onActivity={() => setAuditFor(l)}
                        onEdit={() => openEdit(l)}
                        onDelete={() => setToDelete(l)}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {/* Create / edit drawer with contextual sections */}
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        wide
        title={form.id ? "Edit ledger" : "New ledger"}
        desc="Choose a group, opening balance and optional GST details. Ctrl+S saves."
        footer={
          <>
            <Button variant="outline" onClick={() => setDrawer(false)}>
              Cancel
            </Button>
            {!form.id && (
              <Button variant="secondary" onClick={() => save(true)} disabled={saving}>
                Save & New
              </Button>
            )}
            {canViewActivity && (
              <Button variant="secondary" onClick={saveAndTransact} disabled={saving} title="Save and open a new voucher">
                <Receipt className="h-4 w-4 mr-1.5" />
                Save & Create Transaction
              </Button>
            )}
            <Button onClick={() => save(false)} disabled={saving}>
              {form.id ? "Save changes" : "Create ledger"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {/* Permanent standard header fields - ALWAYS VISIBLE */}
          <div>
            <div className="eyebrow mb-3">Basic info</div>
            <div className="grid md:grid-cols-2 gap-3">
              <Field
                label="Ledger name"
                required
                error={submitted && !form.name.trim() ? "Ledger name is required." : undefined}
                hint={<ValidationHint level={nameHint?.level} message={nameHint?.message} />}
              >
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. HDFC Bank, Tata Steel, Rent Account"
                  autoFocus
                />
              </Field>
            </div>

            {/* 5 Radio Buttons with toggle-to-clear */}
            <div className="flex flex-wrap items-center gap-6 mt-3 pt-2.5 pb-2 border-y border-border/60">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="radio"
                  name="quickLedgerType"
                  className="h-4 w-4 accent-[var(--teal)] cursor-pointer"
                  checked={quickType === "BANK"}
                  onClick={() => selectQuickType("BANK")}
                  onChange={() => { }}
                />
                <span>Bank</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="radio"
                  name="quickLedgerType"
                  className="h-4 w-4 accent-[var(--teal)] cursor-pointer"
                  checked={quickType === "CASH"}
                  onClick={() => selectQuickType("CASH")}
                  onChange={() => { }}
                />
                <span>Cash</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="radio"
                  name="quickLedgerType"
                  className="h-4 w-4 accent-[var(--teal)] cursor-pointer"
                  checked={quickType === "CUSTOMER"}
                  onClick={() => selectQuickType("CUSTOMER")}
                  onChange={() => { }}
                />
                <span>Customer</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="radio"
                  name="quickLedgerType"
                  className="h-4 w-4 accent-[var(--teal)] cursor-pointer"
                  checked={quickType === "VENDOR"}
                  onClick={() => selectQuickType("VENDOR")}
                  onChange={() => { }}
                />
                <span>Vendor</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="radio"
                  name="quickLedgerType"
                  className="h-4 w-4 accent-[var(--teal)] cursor-pointer"
                  checked={quickType === "BOTH"}
                  onClick={() => selectQuickType("BOTH")}
                  onChange={() => { }}
                />
                <span>Both (Customer & Vendor)</span>
              </label>
            </div>


            {/* DYNAMIC HIERARCHY - Shown for all except "BOTH" */}
            {quickType !== "BOTH" && (
              <div className="fade-up space-y-3 pt-1">
                <div className="eyebrow">Group hierarchy</div>
                {quickType === "" && groupSuggestion && !form.groupId && (
                  <button
                    type="button"
                    className="mb-2 text-[12.5px] rounded-[5px] px-2.5 py-1.5 bg-[var(--teal-soft)] text-[var(--teal)] font-medium hover:opacity-80"
                    onClick={() => {
                      const sub = groups.find((g) => g.id === groupSuggestion.id);
                      const main = sub?.parent_id ? groupById.get(sub.parent_id) : undefined;
                      const primary = main?.parent_id ? groupById.get(main.parent_id) : undefined;
                      setForm({
                        ...form,
                        primaryId: primary?.id || "",
                        mainId: main?.id || "",
                        groupId: groupSuggestion.id,
                        balance_type: form.balance_type || groupSuggestion.balance_type,
                      });
                    }}
                  >
                    ✨ Suggested group: {groupSuggestion.name} — click to apply
                  </button>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Primary">
                    <Select
                      value={form.primaryId}
                      onChange={(e) => setForm({ ...form, primaryId: e.target.value, mainId: "", groupId: "" })}
                    >
                      <option value="">Select</option>
                      {primaries.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Main">
                    <Select
                      value={form.mainId}
                      disabled={!form.primaryId}
                      onChange={(e) => setForm({ ...form, mainId: e.target.value, groupId: "" })}
                    >
                      <option value="">Select</option>
                      {mains.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Sub-category">
                    <Select
                      value={form.groupId}
                      disabled={!form.mainId}
                      onChange={(e) => {
                        const selectedSub = groupById.get(e.target.value);
                        setForm({
                          ...form,
                          groupId: e.target.value,
                          balance_type: form.balance_type || selectedSub?.balance_type || "",
                        });
                      }}
                    >
                      <option value="">Select</option>
                      {subs.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>
            )}
            {/* Standard opening balance, balance type & as on date */}
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="Opening balance">
                <Input
                  type="number"
                  value={form.opening_balance}
                  onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                />
              </Field>
              <Field label="Dr / Cr">
                <Select
                  value={form.balance_type}
                  onChange={(e) => setForm({ ...form, balance_type: e.target.value })}
                >
                  <option value="">Select</option>
                  <option value="DR">Debit</option>
                  <option value="CR">Credit</option>
                </Select>
              </Field>
              <Field label="As on date">
                <DatePicker
                  value={form.opening_balance_date || ""}
                  onChange={(val) => setForm({ ...form, opening_balance_date: val })}
                />
              </Field>
            </div>
          </div>

          {/* DYNAMIC SECTION 1: BANK */}
          {quickType === "BANK" && (
            <div className="fade-up space-y-4 pt-2">
              <div className="eyebrow">Bank account details</div>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Bank name">
                  <Input
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                    placeholder="e.g. HDFC Bank, SBI, ICICI"
                  />
                </Field>
                <Field label="Account holder name">
                  <Input
                    value={form.account_holder_name}
                    onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })}
                    placeholder="e.g. My Business Pvt Ltd"
                  />
                </Field>
                <Field label="Bank account number">
                  <Input
                    className="mono"
                    value={form.account_number}
                    onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                    placeholder="e.g. 50200012345678"
                  />
                </Field>
                <Field label="IFSC code">
                  <Input
                    className="mono uppercase"
                    maxLength={11}
                    value={form.ifsc_code}
                    onChange={(e) => setForm({ ...form, ifsc_code: e.target.value.toUpperCase() })}
                    placeholder="e.g. HDFC0001234"
                  />
                </Field>
                <Field label="Branch name" className="md:col-span-2">
                  <Input
                    value={form.branch_name}
                    onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
                    placeholder="e.g. T. Nagar Branch, Chennai"
                  />
                </Field>
              </div>
            </div>
          )}

          {/* DYNAMIC SECTION 2: CASH */}
          {quickType === "CASH" && (
            <div className="fade-up space-y-4 pt-2">
              <div className="eyebrow">Cash details</div>
              <Field label="Description / Narration">
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Petty cash account maintained for daily office expenses"
                />
              </Field>
            </div>
          )}

          {/* DYNAMIC SECTION 3: CUSTOMER / VENDOR / BOTH */}
          {(quickType === "CUSTOMER" || quickType === "VENDOR" || quickType === "BOTH") && (
            <div className="fade-up space-y-5 pt-2">
              {quickType === "BOTH" && (
                <div className="rounded-md border border-[var(--teal)]/40 bg-[var(--teal-soft)]/50 px-3.5 py-2.5 text-xs text-foreground flex items-center gap-2">
                  <span className="font-semibold text-[var(--teal)]">Dual Role Party:</span>
                  <span>
                    Will create linked accounts under <b>Sundry Debtors</b> (receivable) and{" "}
                    <b>Sundry Creditors</b> (payable).
                  </span>
                </div>
              )}

              <div>
                <div className="eyebrow mb-3">GST & Tax</div>
                <div className="grid md:grid-cols-3 gap-3">
                  <Field label="GSTIN" hint={<ValidationHint level={gstinHint?.level} message={gstinHint?.message} />}>
                    <Input
                      className="mono uppercase"
                      maxLength={15}
                      value={form.gstin}
                      onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                      placeholder="33AAAAA0000A1Z5"
                    />
                  </Field>
                  <Field label="GST type">
                    <Select value={form.gst_type} onChange={(e) => setForm({ ...form, gst_type: e.target.value })}>
                      <option value="">Select</option>
                      <option value="REGISTERED">Registered</option>
                      <option value="UNREGISTERED">Unregistered</option>
                      <option value="COMPOSITION">Composition</option>
                      <option value="EXEMPT">Exempt</option>
                    </Select>
                  </Field>
                  <Field label="PAN">
                    <Input
                      className="mono uppercase"
                      maxLength={10}
                      value={form.pan}
                      onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                      placeholder="ABCDE1234F"
                    />
                  </Field>
                </div>
              </div>

              <div>
                <div className="eyebrow mb-3">Contact details</div>
                <div className="grid md:grid-cols-3 gap-3">
                  <Field label="Contact person">
                    <Input
                      value={form.contact_person}
                      onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                    />
                  </Field>
                  <Field label="Mobile">
                    <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </Field>
                </div>
              </div>

              <div>
                <div className="eyebrow mb-3">Billing Address</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Address line 1" className="md:col-span-2">
                    <Input
                      value={form.b_line1}
                      onChange={(e) => setForm({ ...form, b_line1: e.target.value })}
                      placeholder="Building, Street"
                    />
                  </Field>
                  <Field label="Address line 2" className="md:col-span-2">
                    <Input
                      value={form.b_line2}
                      onChange={(e) => setForm({ ...form, b_line2: e.target.value })}
                      placeholder="Area, Landmark"
                    />
                  </Field>
                  <Field label="City">
                    <Input value={form.b_city} onChange={(e) => setForm({ ...form, b_city: e.target.value })} />
                  </Field>
                  <Field label="State">
                    <Input value={form.b_state} onChange={(e) => setForm({ ...form, b_state: e.target.value })} />
                  </Field>
                  <Field label="Pincode">
                    <Input value={form.b_pincode} onChange={(e) => setForm({ ...form, b_pincode: e.target.value })} />
                  </Field>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="eyebrow">Shipping Address</div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded accent-[var(--teal)] cursor-pointer"
                      checked={form.same_as_billing}
                      onChange={(e) => setForm({ ...form, same_as_billing: e.target.checked })}
                    />
                    <span>Same as billing address</span>
                  </label>
                </div>
                {!form.same_as_billing && (
                  <div className="grid md:grid-cols-2 gap-3 fade-up">
                    <Field label="Address line 1" className="md:col-span-2">
                      <Input
                        value={form.s_line1}
                        onChange={(e) => setForm({ ...form, s_line1: e.target.value })}
                        placeholder="Building, Street"
                      />
                    </Field>
                    <Field label="Address line 2" className="md:col-span-2">
                      <Input
                        value={form.s_line2}
                        onChange={(e) => setForm({ ...form, s_line2: e.target.value })}
                        placeholder="Area, Landmark"
                      />
                    </Field>
                    <Field label="City">
                      <Input value={form.s_city} onChange={(e) => setForm({ ...form, s_city: e.target.value })} />
                    </Field>
                    <Field label="State">
                      <Input value={form.s_state} onChange={(e) => setForm({ ...form, s_state: e.target.value })} />
                    </Field>
                    <Field label="Pincode">
                      <Input value={form.s_pincode} onChange={(e) => setForm({ ...form, s_pincode: e.target.value })} />
                    </Field>
                  </div>
                )}
              </div>

              <div>
                <div className="eyebrow mb-3">Credit & Terms</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Credit limit (₹)">
                    <Input
                      type="number"
                      value={form.credit_limit}
                      onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                    />
                  </Field>
                  <Field label="Payment terms">
                    <Select
                      value={form.payment_terms}
                      onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    >
                      <option value="">Select</option>
                      <option>Due on receipt</option>
                      <option>Net 15</option>
                      <option>Net 30</option>
                      <option>Net 45</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* DYNAMIC SECTION 4: GENERAL / UNCHECKED */}
          {quickType === "" && (
            <div className="fade-up space-y-6 pt-2">
              <div>
                <div className="eyebrow mb-3">GST & tax</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Default GST rate">
                    <Select
                      value={form.default_gst_rate}
                      onChange={(e) => setForm({ ...form, default_gst_rate: e.target.value })}
                    >
                      <option value="">Select</option>
                      {gstRates.map((g) => (
                        <option key={g.rate} value={g.rate}>{g.rate}%</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="HSN / SAC">
                    <Input
                      className="mono"
                      value={form.hsn_sac}
                      onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div>
                <div className="eyebrow mb-3">Description & Advanced</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Description" className="md:col-span-2">
                    <Textarea
                      rows={2}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </Field>
                  <Field label="Department / project">
                    <Select
                      value={form.cost_center_id}
                      onChange={(e) => setForm({ ...form, cost_center_id: e.target.value })}
                    >
                      <option value="">None</option>
                      {costCenters.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tags">
                    <Input
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder="e.g. expense, admin"
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>
      </Drawer>

      {/* Bulk create drawer (multiple ledgers under one sub-category) */}
      <Drawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        wide
        title="Create multiple ledgers"
        desc="All rows go under one sub-category. Dr/Cr auto-fills from the sub-category but stays editable per row."
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveBulk} disabled={bulkSaving}>
              {bulkSaving
                ? "Creating…"
                : `Create ${bulkRows.filter((r) => r.name.trim()).length} ledger(s)`}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <div className="eyebrow mb-3">Group</div>
            {/* Quick Type Selection */}
            <div className="flex flex-wrap items-center gap-6 py-2 px-3 mb-3 rounded-md bg-muted/40 border border-border/60">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-[var(--teal)] focus:ring-[var(--teal)]"
                  checked={bulkQuickType === "BANK"}
                  onChange={() => selectBulkQuickType("BANK")}
                />
                <span>Bank</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-[var(--teal)] focus:ring-[var(--teal)]"
                  checked={bulkQuickType === "CASH"}
                  onChange={() => selectBulkQuickType("CASH")}
                />
                <span>Cash</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-[var(--teal)] focus:ring-[var(--teal)]"
                  checked={bulkQuickType === "CUSTOMER"}
                  onChange={() => selectBulkQuickType("CUSTOMER")}
                />
                <span>Customer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-[var(--teal)] focus:ring-[var(--teal)]"
                  checked={bulkQuickType === "VENDOR"}
                  onChange={() => selectBulkQuickType("VENDOR")}
                />
                <span>Vendor</span>
              </label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Primary">
                <Select
                  value={bulkPrimary}
                  onChange={(e) => {
                    setBulkQuickType("");
                    setBulkPrimary(e.target.value);
                    setBulkMain("");
                    setBulkGroup("");
                    setBulkErrors({});
                  }}
                >
                  <option value="">Select</option>
                  {bulkPrimaries.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Main">
                <Select
                  value={bulkMain}
                  disabled={!bulkPrimary}
                  onChange={(e) => {
                    setBulkQuickType("");
                    setBulkMain(e.target.value);
                    setBulkGroup("");
                    setBulkErrors({});
                  }}
                >
                  <option value="">Select</option>
                  {bulkMains.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Sub-category" required error={bulkSubmitted && !bulkGroup ? "Sub-category is required." : undefined}>
                <Select
                  value={bulkGroup}
                  disabled={!bulkMain}
                  onChange={(e) => {
                    setBulkQuickType("");
                    selectBulkGroup(e.target.value);
                  }}
                >
                  <option value="">Select</option>
                  {bulkSubs.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="As on date">
                <DatePicker
                  value={bulkDate}
                  onChange={(val) => setBulkDate(val)}
                />
              </Field>
            </div>
            {bulkGroup && (
              <p className="text-xs text-muted-foreground mt-2">
                Dr/Cr defaults to{" "}
                <b>{groupById.get(bulkGroup)?.balance_type === "DR" ? "Dr" : "Cr"}</b> for this
                sub-category — editable per row.
              </p>
            )}
          </div>

          <div>
            <div className="eyebrow mb-3">Ledgers</div>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="w-12 px-3 py-2 text-xs font-medium text-muted-foreground">S.No</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Name of the ledger</th>
                    <th className="w-36 px-3 py-2 text-xs font-medium text-muted-foreground">Opening Bal</th>
                    <th className="w-28 px-3 py-2 text-xs font-medium text-muted-foreground">Cr/Dr</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Input
                          value={r.name}
                          onChange={(e) => setBulkRow(i, { name: e.target.value })}
                          placeholder="Ledger name"
                          className="h-8"
                        />
                        {bulkErrors[i] && (
                          <p className="text-xs text-destructive mt-1">{bulkErrors[i]}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={r.opening_balance}
                          onChange={(e) => setBulkRow(i, { opening_balance: e.target.value })}
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={r.balance_type}
                          onChange={(e) => setBulkRow(i, { balance_type: e.target.value })}
                          className="h-8"
                        >
                          <option value="">Select</option>
                          <option value="DR">Dr</option>
                          <option value="CR">Cr</option>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        {bulkRows.length > 1 && (
                          <button
                            onClick={() => removeBulkRow(i)}
                            className="text-muted-foreground hover:text-destructive"
                            title="Remove row"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={addBulkRow}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add row
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      {/* Transactions drawer */}
      <Drawer
        open={!!activityFor}
        onClose={() => setActivityFor(null)}
        wide
        title={activityFor ? `Transactions — ${activityFor.name}` : ""}
        desc={activityFor ? groupPath(activityFor.ledger_group_id) : undefined}
      >
        {activityFor && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {canWrite && activityFor.is_frozen !== "Y" && (
                <Button size="sm" variant="outline" onClick={() => { const l = activityFor; setActivityFor(null); openEdit(l); }}>
                  Edit ledger
                </Button>
              )}
              {canWrite && activityFor.is_system !== "Y" && (
                <Button size="sm" variant="outline" onClick={() => toggleFreeze(activityFor)}>
                  {activityFor.is_frozen === "Y" ? <Unlock className="h-3.5 w-3.5 mr-1" /> : <Lock className="h-3.5 w-3.5 mr-1" />}
                  {activityFor.is_frozen === "Y" ? "Unfreeze" : "Freeze"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { const l = activityFor; setActivityFor(null); setAuditFor(l); }}>
                Change history
              </Button>
              {canViewActivity && (
                <Button size="sm" onClick={() => nav("/app/journal", { state: { openNew: true, ledgerId: activityFor.id, ledgerName: activityFor.name } })}>
                  <Receipt className="h-3.5 w-3.5 mr-1" />
                  New transaction
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { l: "Opening balance", v: activityFor.opening_balance || 0 },
                { l: "Total debits", v: activity.reduce((s, a) => s + (Number(a.debitAmount) || 0), 0) },
                { l: "Total credits", v: activity.reduce((s, a) => s + (Number(a.creditAmount) || 0), 0) },
              ].map((s) => (
                <div key={s.l} className="rounded-[5px] border border-border bg-muted/30 px-3.5 py-3">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
                  <div className="fig text-lg mt-0.5">{money(s.v)}</div>
                </div>
              ))}
            </div>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Voucher</Th>
                  <Th>Date</Th>
                  <Th right>Debit</Th>
                  <Th right>Credit</Th>
                  <Th className="w-24">Status</Th>
                </tr>
              </thead>
              <tbody>
                {activity.length === 0 && (
                  <EmptyRow colSpan={5} text="No posted transactions for this ledger." />
                )}
                {activity.map((a, i) => (
                  <tr key={i}>
                    <Td className="mono">{a.voucherNo}</Td>
                    <Td>{a.voucherDate}</Td>
                    <Td right>{a.debitAmount ? <Money v={a.debitAmount} /> : <span className="text-muted-foreground">—</span>}</Td>
                    <Td right>{a.creditAmount ? <Money v={a.creditAmount} /> : <span className="text-muted-foreground">—</span>}</Td>
                    <Td>
                      <Badge tone={a.voucherStatus === "POSTED" ? "ok" : "warn"}>{a.voucherStatus}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </Drawer>

      <ActivityDrawer
        open={!!auditFor}
        onClose={() => setAuditFor(null)}
        entity="ledger"
        entityId={auditFor?.id || null}
        title={auditFor?.name || ""}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entity="LEDGER"
        entityLabel="Ledgers"
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "group", label: "Group" },
          { key: "balance_type", label: "Dr/Cr" },
          { key: "opening_balance", label: "Opening balance" },
          { key: "gstin", label: "GSTIN" },
          { key: "description", label: "Description" },
        ]}
        onImported={load}
      />

      <Modal
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        title="Create ledger"
        desc="How would you like to add ledgers?"
      >
        <div className="grid grid-cols-2 gap-3">
          <button
            className="rounded-lg border border-border p-4 text-left hover:border-[var(--teal)] hover:bg-[var(--teal-soft)] transition-colors group"
            onClick={() => {
              setChooserOpen(false);
              openNew();
            }}
          >
            <UserPlus className="h-5 w-5 mb-2 text-muted-foreground group-hover:text-[var(--teal)]" />
            <div className="text-sm font-semibold">Single</div>
            <p className="text-xs text-muted-foreground mt-1">Add one ledger with full GST, contact & billing details.</p>
          </button>
          <button
            className="rounded-lg border border-border p-4 text-left hover:border-[var(--teal)] hover:bg-[var(--teal-soft)] transition-colors group"
            onClick={() => {
              setChooserOpen(false);
              openBulkNew();
            }}
          >
            <ListPlus className="h-5 w-5 mb-2 text-muted-foreground group-hover:text-[var(--teal)]" />
            <div className="text-sm font-semibold">Multiple</div>
            <p className="text-xs text-muted-foreground mt-1">Add many ledgers at once in a grid, under one sub-category.</p>
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Deactivate “${toDelete?.name}”?`}
        desc="Soft delete: vouchers referencing this ledger keep their history."
        confirmLabel="Deactivate"
        onConfirm={confirmDelete}
      />
    </PageHeader>
  );
}
