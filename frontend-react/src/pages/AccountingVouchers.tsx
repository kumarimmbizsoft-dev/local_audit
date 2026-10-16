import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle, ChevronDown, Plus, Trash2, X } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { useCompany } from "../auth/CompanyContext";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyRow,
  Field,
  Input,
  DatePicker,
  Money,
  PageHeader,
  Panel,
  SearchBox,
  Select,
  Spinner,
  TableWrap,
  Td,
  Textarea,
  Th,
} from "../components/ui";
import { AiModeButton, AiFillPanel, type AiDraft } from "../components/AiFill";
import { api, envelopeMessage, envelopeOk, envelopeResult } from "../lib/api";
import { cn, fmtDate, money } from "../lib/format";
import { useHotkeys } from "../lib/hotkeys";
import {
  loadAccountingLedgerOptions,
  loadActiveVoucherTypes,
  loadVoucherRefs,
  computeDueDate,
  round2,
  type AccountingLedgerOption,
  type AccountingLedgerOptions,
  type ConfiguredVoucherType,
  type PartyLite,
  type LedgerLite,
} from "../lib/vouchers";

type EntrySide = "DEBIT" | "CREDIT";

interface VoucherDetail {
  lineNo: number;
  ledgerId: string;
  ledgerName?: string | null;
  debitAmount: number | null;
  creditAmount: number | null;
  remarks: string | null;
}

interface Voucher {
  id: string;
  voucherNo: string;
  voucherTypeId: string | null;
  voucherTypeName: string | null;
  baseVoucherType: string;
  voucherDate: string;
  dueDate?: string | null;
  referenceNo: string | null;
  narration: string | null;
  voucherStatus: string;
  totalDebit: number | null;
  totalCredit: number | null;
  details: VoucherDetail[];
}

interface AccountingLine {
  line_no: number;
  side: EntrySide;
  ledger_id: string;
  ledger_name: string;
  amount: number;
  remarks: string;
}

interface StyledOption {
  id: string;
  name: string;
  sub?: string | null;
  groupName?: string | null;
}

interface StyledSearchableSelectProps {
  value: string;
  selectedName?: string;
  options: StyledOption[];
  disabled?: boolean;
  hasError?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  inputClassName?: string;
  onChange: (selectedId: string, selectedName: string) => void;
}

function StyledSearchableSelect({
  value,
  selectedName,
  options,
  disabled,
  hasError,
  placeholder = "Select...",
  allowClear = false,
  inputClassName = "h-9",
  onChange,
}: StyledSearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const resolvedName = useMemo(() => {
    if (selectedName !== undefined) return selectedName;
    const found = options.find((o) => o.id === value);
    return found ? found.name : "";
  }, [selectedName, options, value]);

  // Sync display text with selected name when closed
  useEffect(() => {
    if (!open) {
      setSearch(resolvedName);
      setActiveIndex(-1);
    }
  }, [open, resolvedName]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q === (resolvedName || "").toLowerCase()) {
      return options;
    }
    return options.filter((opt) => {
      const nameMatch = (opt.name || "").toLowerCase().includes(q);
      const sub = opt.sub || opt.groupName || "";
      const subMatch = sub.toLowerCase().includes(q);
      return nameMatch || subMatch;
    });
  }, [options, search, resolvedName]);

  // Auto-scroll the active highlighted item into view
  useEffect(() => {
    if (open && activeIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[activeIndex] as HTMLElement;
      if (activeEl && typeof activeEl.scrollIntoView === "function") {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex, open]);

  const selectOption = (opt: StyledOption) => {
    onChange(opt.id, opt.name);
    setSearch(opt.name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearch("");
    onChange("", "");
    setOpen(true);
    setActiveIndex(0);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-md border border-input bg-transparent px-3 pr-8 text-[13px] shadow-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            hasError && "border-destructive",
            !disabled && "hover:border-accent-foreground/40 cursor-pointer",
            inputClassName
          )}
          value={search}
          onClick={() => {
            if (!disabled && !open) {
              setOpen(true);
              const initialIdx = filtered.findIndex((o) => o.id === value);
              setActiveIndex(initialIdx >= 0 ? initialIdx : (filtered.length > 0 ? 0 : -1));
            }
          }}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              const initialIdx = filtered.findIndex((o) => o.id === value);
              setActiveIndex(initialIdx >= 0 ? initialIdx : (filtered.length > 0 ? 0 : -1));
            }
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) {
                setOpen(true);
                const initialIdx = filtered.findIndex((o) => o.id === value);
                setActiveIndex(initialIdx >= 0 ? initialIdx : (filtered.length > 0 ? 0 : -1));
              } else if (filtered.length > 0) {
                setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) {
                setOpen(true);
                const initialIdx = filtered.findIndex((o) => o.id === value);
                setActiveIndex(initialIdx >= 0 ? initialIdx : (filtered.length > 0 ? filtered.length - 1 : -1));
              } else if (filtered.length > 0) {
                setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
              }
            } else if (e.key === "Enter") {
              if (open && activeIndex >= 0 && activeIndex < filtered.length) {
                e.preventDefault();
                selectOption(filtered[activeIndex]);
              }
            } else if (e.key === "Tab") {
              if (open && activeIndex >= 0 && activeIndex < filtered.length) {
                selectOption(filtered[activeIndex]);
              }
            }
          }}
        />
        <div
          className="absolute right-2.5 flex items-center gap-1 cursor-pointer"
          onClick={() => {
            if (!disabled) {
              setOpen((prev) => !prev);
              const initialIdx = filtered.findIndex((o) => o.id === value);
              setActiveIndex(initialIdx >= 0 ? initialIdx : (filtered.length > 0 ? 0 : -1));
            }
          }}
        >
          {allowClear && value && !disabled && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-0.5"
              onClick={handleClear}
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform pointer-events-none",
              open && "rotate-180"
            )}
          />
        </div>
      </div>

      {open && !disabled && (
        <div
          ref={listRef}
          className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full min-w-[260px] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No options found</div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = opt.id === value;
              const isHighlighted = idx === activeIndex;
              const subText = opt.sub || opt.groupName;
              return (
                <div
                  key={opt.id}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition-colors border-l-4",
                    isHighlighted
                      ? "bg-primary text-primary-foreground font-bold border-l-primary shadow-sm"
                      : isSelected
                      ? "bg-[var(--teal-soft)] text-primary font-semibold border-l-primary"
                      : "border-l-transparent text-foreground hover:bg-muted/70"
                  )}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isSelected && (
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isHighlighted ? "text-primary-foreground" : "text-primary"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "truncate",
                        isHighlighted
                          ? "font-bold text-primary-foreground"
                          : isSelected
                          ? "font-semibold text-primary"
                          : "font-normal"
                      )}
                    >
                      {opt.name}
                    </span>
                  </div>
                  {subText && (
                    <span
                      className={cn(
                        "ml-2 text-[10px] shrink-0 font-medium px-1.5 py-0.5 rounded",
                        isHighlighted
                          ? "bg-primary-foreground/20 text-primary-foreground font-semibold"
                          : isSelected
                          ? "bg-primary/10 text-primary font-medium"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {subText}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

interface SearchableLedgerSelectProps {
  value: string;
  selectedName: string;
  options: AccountingLedgerOption[];
  disabled?: boolean;
  hasError?: boolean;
  placeholder?: string;
  onChange: (selectedId: string, selectedName: string) => void;
}

function SearchableLedgerSelect(props: SearchableLedgerSelectProps) {
  return (
    <StyledSearchableSelect
      {...props}
      inputClassName="h-8"
      allowClear
    />
  );
}

function emptyLine(lineNo: number, side: EntrySide): AccountingLine {
  return {
    line_no: lineNo,
    side,
    ledger_id: "",
    ledger_name: "",
    amount: 0,
    remarks: "",
  };
}

function emptyForm() {
  return {
    id: null as string | null,
    status: "DRAFT",
    voucher_no: "",
    voucher_type_id: "",
    voucher_type_name: "",
    base_voucher_type: "",
    voucher_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    party_id: "",
    reference_no: "",
    reference_date: "",
    narration: "",
    lines: [emptyLine(1, "DEBIT"), emptyLine(2, "CREDIT")],
  };
}

type FormState = ReturnType<typeof emptyForm>;

export function AccountingVouchers() {
  const { can } = useAuth();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const canWrite = can("VOUCHER", "write");
  const canDelete = can("VOUCHER", "delete");

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [voucherTypes, setVoucherTypes] = useState<ConfiguredVoucherType[]>([]);
  const [parties, setParties] = useState<PartyLite[]>([]);
  const [ledgers, setLedgers] = useState<LedgerLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerOptions, setLedgerOptions] = useState<AccountingLedgerOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Voucher | null>(null);
  const [aiMode, setAiMode] = useState(false);

  async function load() {
    setLoading(true);
    const [voucherResponse, activeTypes, refs] = await Promise.all([
      api.get("/vouchers"),
      loadActiveVoucherTypes(),
      loadVoucherRefs(),
    ]);
    setVouchers(envelopeResult<Voucher[]>(voucherResponse) || []);
    setVoucherTypes(activeTypes);
    setParties(refs.parties);
    setLedgers(refs.ledgers);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    let ignore = false;
    if (!drawer || !form.voucher_type_id) {
      setLedgerOptions(null);
      return;
    }
    setOptionsLoading(true);
    loadAccountingLedgerOptions(form.voucher_type_id)
      .then((options) => {
        if (!ignore) setLedgerOptions(options);
      })
      .finally(() => {
        if (!ignore) setOptionsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [drawer, form.voucher_type_id, companyId]);

  useHotkeys(
    useMemo(
      () => ({
        "ctrl+n": () => canWrite && openNew(),
        "ctrl+s": () => drawer && canWrite && saveDraft(),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [canWrite, drawer, form]
    )
  );

  const filtered = vouchers.filter((voucher) => {
    const matchesType = typeFilter === "ALL" || voucher.voucherTypeId === typeFilter;
    const matchesStatus = statusFilter === "ALL" || voucher.voucherStatus === statusFilter;
    const text = `${voucher.voucherNo} ${voucher.voucherTypeName || ""} ${voucher.referenceNo || ""} ${voucher.narration || ""}`;
    return matchesType && matchesStatus && text.toLowerCase().includes(query.toLowerCase());
  });

  const totals = useMemo(() => {
    const debit = round2(
      form.lines
        .filter((line) => line.side === "DEBIT")
        .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    );
    const credit = round2(
      form.lines
        .filter((line) => line.side === "CREDIT")
        .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    );
    return { debit, credit, difference: round2(debit - credit) };
  }, [form.lines]);

  const baseTypes = useMemo(() => {
    return voucherTypes.filter((vt) => vt.is_system === "Y");
  }, [voucherTypes]);

  const customTypesForBase = useMemo(() => {
    if (!form.base_voucher_type) return [];
    const base = form.base_voucher_type.toUpperCase();
    return voucherTypes.filter(
      (vt) => vt.is_system === "N" && vt.base_voucher_type.toUpperCase() === base
    );
  }, [voucherTypes, form.base_voucher_type]);

  const bankCashLedgers = useMemo(() => {
    return ledgers.filter((l) => {
      const cat = (l.category || "").toLowerCase();
      const nm = (l.name || "").toLowerCase();
      return l.is_bank === "Y" || l.is_cash === "Y" || cat === "bank" || cat === "cash" || nm.includes("bank") || nm.includes("cash");
    });
  }, [ledgers]);

  const baseTypeOptions = useMemo(() => {
    return baseTypes.map((type) => ({
      id: type.base_voucher_type,
      name: type.name,
    }));
  }, [baseTypes]);

  const customTypeOptions = useMemo(() => {
    return customTypesForBase.map((type) => ({
      id: type.id,
      name: type.name,
    }));
  }, [customTypesForBase]);

  const partyOptions = useMemo(() => {
    if (isBankCashVoucherType(form.base_voucher_type)) {
      return bankCashLedgers.map((l) => ({
        id: l.id,
        name: l.name,
        sub: l.is_bank === "Y" || (l.category || "").toLowerCase() === "bank" ? "Bank" : "Cash",
      }));
    }
    return parties
      .filter((p) => {
        if (form.base_voucher_type === "SALES" || form.base_voucher_type === "CREDIT_NOTE") return p.key_group === "C";
        if (form.base_voucher_type === "PURCHASE" || form.base_voucher_type === "DEBIT_NOTE") return p.key_group === "V";
        return true;
      })
      .map((p) => {
        const cInfo = p.name_contact_info as any;
        const partyName = cInfo?.name || cInfo?.company_name || cInfo?.first_name || p.id;
        const subLabel = p.gstin ? `GST: ${p.gstin}` : (p.key_group === "C" ? "Customer" : p.key_group === "V" ? "Vendor" : undefined);
        return {
          id: p.id,
          name: String(partyName),
          sub: subLabel,
        };
      });
  }, [form.base_voucher_type, bankCashLedgers, parties]);

  const readOnly = form.status === "CANCELLED";

  function openNew() {
    setForm(emptyForm());
    setSubmitted(false);
    setLedgerOptions(null);
    setDrawer(true);
  }

  function openEdit(voucher: Voucher) {
    const details = voucher.details || [];
    let resolvedPartyId = "";
    const foundParty = parties.find((p) => p.ledger_id && details.some((d) => d.ledgerId === p.ledger_id));
    if (foundParty) {
      resolvedPartyId = foundParty.id;
    } else if (isBankCashVoucherType(voucher.baseVoucherType)) {
      const bankDetail = details.find((d) => d.ledgerId && bankCashLedgers.some((b) => b.id === d.ledgerId));
      if (bankDetail?.ledgerId) {
        resolvedPartyId = bankDetail.ledgerId;
      }
    }
    setForm({
      id: voucher.id,
      status: voucher.voucherStatus,
      voucher_no: voucher.voucherNo,
      voucher_type_id: voucher.voucherTypeId || "",
      voucher_type_name: voucher.voucherTypeName || voucher.baseVoucherType,
      base_voucher_type: voucher.baseVoucherType,
      voucher_date: voucher.voucherDate,
      due_date: voucher.dueDate ? voucher.dueDate.slice(0, 10) : "",
      party_id: resolvedPartyId,
      reference_no: voucher.referenceNo || "",
      reference_date: (voucher as any).referenceDate ? (voucher as any).referenceDate.slice(0, 10) : "",
      narration: voucher.narration || "",
      lines: details.map((detail, index) => {
        const debit = Number(detail.debitAmount) || 0;
        return {
          line_no: detail.lineNo || index + 1,
          side: debit > 0 ? "DEBIT" : "CREDIT",
          ledger_id: detail.ledgerId || "",
          ledger_name: detail.ledgerName || "",
          amount: debit || Number(detail.creditAmount) || 0,
          remarks: detail.remarks || "",
        };
      }),
    });
    setSubmitted(false);
    setDrawer(true);
  }

  function isPartyVoucherType(baseType: string): boolean {
    const bt = (baseType || "").toUpperCase();
    return bt === "SALES" || bt === "PURCHASE" || bt === "CREDIT_NOTE" || bt === "DEBIT_NOTE";
  }

  function isBankCashVoucherType(baseType: string): boolean {
    const bt = (baseType || "").toUpperCase();
    return bt === "PAYMENT" || bt === "RECEIPT" || bt === "CONTRA";
  }

  function getVoucherSides(baseType: string): { topSide: EntrySide; oppositeSide: EntrySide } {
    const bt = (baseType || "").toUpperCase();
    if (bt === "SALES" || bt === "DEBIT_NOTE") {
      return { topSide: "DEBIT", oppositeSide: "CREDIT" };
    }
    if (bt === "PURCHASE" || bt === "CREDIT_NOTE") {
      return { topSide: "CREDIT", oppositeSide: "DEBIT" };
    }
    if (bt === "RECEIPT") {
      return { topSide: "DEBIT", oppositeSide: "CREDIT" };
    }
    if (bt === "PAYMENT" || bt === "CONTRA") {
      return { topSide: "CREDIT", oppositeSide: "DEBIT" };
    }
    return { topSide: "DEBIT", oppositeSide: "CREDIT" };
  }

  function autoBalancePartyLine(currentLines: AccountingLine[], baseType: string, partyId: string): AccountingLine[] {
    if (!partyId) return currentLines;
    const bt = (baseType || "").toUpperCase();

    let targetLedgerId = "";
    let targetLedgerName = "";

    if (isPartyVoucherType(bt)) {
      const party = parties.find((p) => p.id === partyId);
      if (!party || !party.ledger_id) return currentLines;
      targetLedgerId = party.ledger_id;
      const cInfo = party.name_contact_info as any;
      targetLedgerName = cInfo?.display_name || cInfo?.company_name || cInfo?.first_name || cInfo?.name || party.ledger_id;
    } else if (isBankCashVoucherType(bt)) {
      const targetLedger = ledgers.find((l) => l.id === partyId) || parties.find((p) => p.id === partyId || p.ledger_id === partyId);
      if (!targetLedger) return currentLines;
      targetLedgerId = (targetLedger as any).ledger_id || targetLedger.id;
      const cInfo = (targetLedger as any).name_contact_info;
      targetLedgerName = (targetLedger as any).name || cInfo?.display_name || cInfo?.company_name || cInfo?.first_name || cInfo?.name || targetLedgerId;
    } else {
      const party = parties.find((p) => p.id === partyId);
      const targetLedger = ledgers.find((l) => l.id === partyId);
      targetLedgerId = party?.ledger_id || targetLedger?.id || partyId;
      const cInfo = party?.name_contact_info as any;
      targetLedgerName = cInfo?.display_name || cInfo?.company_name || cInfo?.first_name || cInfo?.name || targetLedger?.name || targetLedgerId;
    }

    if (!targetLedgerId) return currentLines;

    const { topSide } = getVoucherSides(bt);
    // Respect user's chosen DR/CR side for line 1 if already set; otherwise default to topSide
    const line1Side: EntrySide = currentLines[0]?.side || topSide;
    const oppSide: EntrySide = line1Side === "DEBIT" ? "CREDIT" : "DEBIT";

    // Lines other than line 1
    let otherLines = currentLines.filter((_, idx) => idx > 0);
    if (otherLines.length === 0) {
      otherLines = [emptyLine(2, oppSide)];
    }

    // Auto-tally: Line 1 amount is automatically computed to balance all other lines
    const oppSum = round2(
      otherLines
        .filter((l) => l.side === oppSide)
        .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    );
    const sameSum = round2(
      otherLines
        .filter((l) => l.side === line1Side)
        .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    );
    const tallyAmount = Math.max(0, round2(oppSum - sameSum));

    const line1: AccountingLine = {
      line_no: 1,
      side: line1Side,
      ledger_id: targetLedgerId,
      ledger_name: targetLedgerName,
      amount: tallyAmount,
      remarks: currentLines[0]?.remarks || "",
    };

    const renumberedOthers = otherLines.map((l, idx) => ({
      ...l,
      line_no: idx + 2,
    }));

    return [line1, ...renumberedOthers];
  }

  function getPartyPaymentTerms(partyId?: string | null, ledgerId?: string | null): string | null {
    if (partyId) {
      const p = parties.find((party) => party.id === partyId || party.ledger_id === partyId);
      const terms =
        p?.payment_info?.terms ||
        p?.additional_info?.terms ||
        (p?.payment_info as any)?.payment_terms ||
        (p as any)?.payment_terms;
      if (terms) return String(terms);
      const targetLedgerId = p?.ledger_id || partyId;
      const l = ledgers.find((ledger) => ledger.id === targetLedgerId);
      if (l?.payment_terms) return String(l.payment_terms);
    }
    if (ledgerId) {
      const l = ledgers.find((ledger) => ledger.id === ledgerId);
      if (l?.payment_terms) return String(l.payment_terms);
      const p = parties.find((party) => party.ledger_id === ledgerId);
      const terms =
        p?.payment_info?.terms ||
        p?.additional_info?.terms ||
        (p?.payment_info as any)?.payment_terms;
      if (terms) return String(terms);
    }
    return null;
  }

  function selectParty(partyId: string) {
    setForm((current) => {
      let newLines = current.lines;
      let newDueDate = current.due_date;
      if (partyId) {
        newLines = autoBalancePartyLine(current.lines, current.base_voucher_type, partyId);
        if (current.base_voucher_type === "SALES" || current.base_voucher_type === "PURCHASE") {
          const terms = getPartyPaymentTerms(partyId);
          if (terms) {
            newDueDate = computeDueDate(current.voucher_date, terms);
          }
        }
      }
      return {
        ...current,
        party_id: partyId,
        due_date: newDueDate,
        lines: newLines,
      };
    });
  }

  function selectBaseVoucherType(baseType: string) {
    const cleanBase = baseType.toUpperCase();
    const systemType = voucherTypes.find(
      (type) => type.is_system === "Y" && type.base_voucher_type.toUpperCase() === cleanBase
    );
    const customTypes = voucherTypes.filter(
      (type) => type.is_system === "N" && type.base_voucher_type.toUpperCase() === cleanBase
    );

    setForm((current) => {
      let updatedLines = current.lines.map((line) => ({
        ...line,
        ledger_id: "",
        ledger_name: "",
      }));
      if (current.party_id && (isPartyVoucherType(cleanBase) || isBankCashVoucherType(cleanBase))) {
        updatedLines = autoBalancePartyLine(updatedLines, cleanBase, current.party_id);
      } else if (isPartyVoucherType(cleanBase) || isBankCashVoucherType(cleanBase)) {
        const { topSide, oppositeSide } = getVoucherSides(cleanBase);
        updatedLines = [emptyLine(1, topSide), emptyLine(2, oppositeSide)];
      }

      let computedDue = current.due_date;
      if (cleanBase === "SALES" || cleanBase === "PURCHASE") {
        if (current.party_id) {
          const terms = getPartyPaymentTerms(current.party_id);
          if (terms) {
            computedDue = computeDueDate(current.voucher_date, terms);
          }
        }
      }

      // Default to the system voucher type for this base category; user can choose custom type in Dropdown 2 if available
      const activeType = systemType || (customTypes.length > 0 ? customTypes[0] : null);

      return {
        ...current,
        base_voucher_type: cleanBase,
        voucher_type_id: activeType?.id || "",
        voucher_type_name: activeType?.name || cleanBase,
        due_date: computedDue,
        lines: updatedLines,
      };
    });
  }

  function selectCustomVoucherType(voucherTypeId: string) {
    const cleanBase = (form.base_voucher_type || "").toUpperCase();
    const systemType = voucherTypes.find(
      (type) => type.is_system === "Y" && type.base_voucher_type.toUpperCase() === cleanBase
    );
    const selected = voucherTypes.find((type) => type.id === voucherTypeId);
    const activeType = selected || systemType;

    setForm((current) => ({
      ...current,
      voucher_type_id: activeType?.id || "",
      voucher_type_name: activeType?.name || current.base_voucher_type,
    }));
  }

  function updateLine(index: number, patch: Partial<AccountingLine>) {
    setForm((current) => {
      const updatedLines = current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line
      );
      const balancedLines = autoBalancePartyLine(
        updatedLines,
        current.base_voucher_type,
        current.party_id
      );
      return {
        ...current,
        lines: balancedLines,
      };
    });
  }

  function addLine() {
    const nextSide: EntrySide = totals.debit <= totals.credit ? "DEBIT" : "CREDIT";
    setForm((current) => {
      const updatedLines = [...current.lines, emptyLine(current.lines.length + 1, nextSide)];
      return {
        ...current,
        lines: autoBalancePartyLine(updatedLines, current.base_voucher_type, current.party_id),
      };
    });
  }

  function removeLine(index: number) {
    setForm((current) => {
      const updatedLines = current.lines
        .filter((_, lineIndex) => lineIndex !== index)
        .map((line, lineIndex) => ({ ...line, line_no: lineIndex + 1 }));
      return {
        ...current,
        lines: autoBalancePartyLine(updatedLines, current.base_voucher_type, current.party_id),
      };
    });
  }

  function fillFormFromAi(draft: AiDraft) {
    const f = draft.fields;
    const grand = Math.round((Number(f.grand_total) || 0) * 100) / 100;
    const ref = (f.invoice_no || "").slice(0, 50);
    setForm((current) => ({
      ...current,
      reference_no: ref,
      voucher_date: f.invoice_date || current.voucher_date,
      narration: (f.narration || "").slice(0, 50),
      lines: [
        { ...emptyLine(1, "DEBIT"), amount: grand, remarks: ref.slice(0, 30) },
        { ...emptyLine(2, "CREDIT"), amount: grand, remarks: ref.slice(0, 30) },
      ],
    }));
  }

  function optionsFor(line: AccountingLine): AccountingLedgerOption[] {
    const options = line.side === "DEBIT" ? ledgerOptions?.debit || [] : ledgerOptions?.credit || [];

    // Collect all Primary Ledger identifiers (IDs and names) to exclude from lines 2+
    const primaryLedgerIds = new Set<string>();
    const primaryLedgerNames = new Set<string>();

    // For any line other than line 1, line 1 is the primary line
    if (line.line_no !== 1) {
      if (form.lines[0]?.ledger_id) {
        primaryLedgerIds.add(form.lines[0].ledger_id.trim().toLowerCase());
      }
      if (form.lines[0]?.ledger_name) {
        primaryLedgerNames.add(form.lines[0].ledger_name.trim().toLowerCase());
      }
    }

    // If Party or Bank/Cash account is chosen in the header, exclude it as well
    if (form.party_id) {
      primaryLedgerIds.add(form.party_id.trim().toLowerCase());

      const p = parties.find((party) => party.id === form.party_id || party.ledger_id === form.party_id);
      if (p?.ledger_id) {
        primaryLedgerIds.add(p.ledger_id.trim().toLowerCase());
      }
      if (p?.id) {
        primaryLedgerIds.add(p.id.trim().toLowerCase());
      }
      const cInfo = p?.name_contact_info as any;
      const pName = cInfo?.display_name || cInfo?.company_name || cInfo?.first_name || cInfo?.name;
      if (pName) {
        primaryLedgerNames.add(String(pName).trim().toLowerCase());
      }

      const l = ledgers.find((ledger) => ledger.id === form.party_id);
      if (l?.id) {
        primaryLedgerIds.add(l.id.trim().toLowerCase());
      }
      if (l?.name) {
        primaryLedgerNames.add(l.name.trim().toLowerCase());
      }
    }

    const used = new Set<string>();
    for (const candidate of form.lines) {
      if (candidate.line_no !== line.line_no && candidate.ledger_id) {
        used.add(candidate.ledger_id.trim().toLowerCase());
      }
    }

    return options.filter((option) => {
      const optId = (option.id || "").trim().toLowerCase();
      const optName = (option.name || "").trim().toLowerCase();

      // If currently selected on this line, keep it
      if (line.ledger_id && optId === line.ledger_id.trim().toLowerCase()) {
        return true;
      }

      // Hide Primary Ledger on lines other than line 1 (or any line if party selected)
      if (line.line_no !== 1 && (primaryLedgerIds.has(optId) || (optName && primaryLedgerNames.has(optName)))) {
        return false;
      }

      // Hide accounts already selected on other lines
      if (used.has(optId)) {
        return false;
      }

      return true;
    });
  }


  function validate(): boolean {
    setSubmitted(true);
    if (!form.voucher_date || !form.base_voucher_type || !form.voucher_type_id) return false;
    if (form.due_date && form.voucher_date && form.due_date < form.voucher_date) {
      toast({ title: "Due date cannot be earlier than voucher date", tone: "error" });
      return false;
    }
    if (form.lines.length < 2) {
      toast({ title: "At least two voucher lines are required", tone: "error" });
      return false;
    }
    if (form.lines.some((line) => !line.ledger_id || !(Number(line.amount) > 0))) {
      toast({ title: "Every line needs an account and amount", tone: "error" });
      return false;
    }
    if (!form.lines.some((line) => line.side === "DEBIT") || !form.lines.some((line) => line.side === "CREDIT")) {
      toast({ title: "Enter at least one debit and one credit line", tone: "error" });
      return false;
    }
    const ledgerIds = form.lines.map((line) => line.ledger_id);
    if (new Set(ledgerIds).size !== ledgerIds.length) {
      toast({ title: "The same ledger cannot be repeated", tone: "error" });
      return false;
    }
    if (totals.debit <= 0 || Math.abs(totals.difference) > 0.009) {
      toast({ title: "Debit and credit totals must be equal", tone: "error" });
      return false;
    }
    return true;
  }

  async function persist(): Promise<string | null> {
    if (!validate()) return null;
    setSaving(true);
    const payload = {
      voucher_type_id: form.voucher_type_id || null,
      voucher_date: form.voucher_date,
      due_date: form.due_date || null,
      reference_no: form.reference_no.trim() || null,
      reference_date: form.reference_date ? form.reference_date.slice(0, 10) : null,
      narration: form.narration.trim() || null,
      details: form.lines.map((line, index) => ({
        line_no: index + 1,
        ledger_id: line.ledger_id,
        debit_amount: line.side === "DEBIT" ? Number(line.amount) : 0,
        credit_amount: line.side === "CREDIT" ? Number(line.amount) : 0,
        remarks: line.remarks.trim() || null,
      })),
    };
    const response = form.id
      ? await api.put(`/vouchers/${form.id}`, payload)
      : await api.post(
        `/vouchers?voucher_type_id=${encodeURIComponent(form.voucher_type_id)}`,
        payload
      );
    setSaving(false);
    if (!envelopeOk(response)) {
      toast({ title: "Could not save voucher", desc: envelopeMessage(response), tone: "error" });
      return null;
    }
    return form.id || envelopeResult<{ id: string }>(response)?.id || null;
  }

  async function revealVoucher(id: string) {
    await load();
    const response = await api.get(`/vouchers/${id}`);
    const voucher = envelopeResult<Voucher>(response);
    if (voucher) openEdit(voucher);
  }

  async function saveDraft() {
    const id = await persist();
    if (!id) return;
    toast({
      title: form.status === "POSTED" ? "Voucher updated successfully" : "Draft saved",
      tone: "success",
    });
    await revealVoucher(id);
  }

  async function saveAndPost() {
    const id = await persist();
    if (!id) return;
    const response = await api.patch(`/vouchers/${id}/post`, {});
    if (!envelopeOk(response)) {
      toast({ title: "Could not post voucher", desc: envelopeMessage(response), tone: "error" });
      return;
    }
    toast({ title: "Voucher posted", tone: "success" });
    await revealVoucher(id);
  }

  async function deleteVoucher() {
    if (!toDelete) return;
    const response = await api.del(`/vouchers/${toDelete.id}`);
    if (!envelopeOk(response)) {
      toast({ title: "Could not delete voucher", desc: envelopeMessage(response), tone: "error" });
      return;
    }
    toast({ title: "Voucher deleted", desc: toDelete.voucherNo, tone: "success" });
    if (form.id === toDelete.id) setDrawer(false);
    load();
  }

  return (
    <PageHeader
      title="Accounting Voucher"
      sub="Account-only voucher entry across every configured Voucher Type"
      actions={
        canWrite && (
          <Button size="sm" onClick={openNew} title="Ctrl+N">
            <Plus className="h-4 w-4" />
            Add Voucher
          </Button>
        )
      }
    >
      <Panel
        pad={false}
        title={`${filtered.length} vouchers`}
        right={
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <Select className="h-9 w-full bg-card sm:w-44" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="ALL">All Voucher Types</option>
              {voucherTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </Select>
            <Select className="h-9 w-full bg-card sm:w-32" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
            <SearchBox value={query} onChange={setQuery} placeholder="Search voucher ID or type" />
          </div>
        }
      >
        {loading ? (
          <Spinner />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th className="w-16">S.No</Th>
                <Th>Voucher ID</Th>
                <Th>Voucher Type</Th>
                <Th>Date</Th>
                <Th right>Amount</Th>
                <Th className="w-28">Status</Th>
                <Th className="w-36" right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <EmptyRow colSpan={7} text="No accounting vouchers found." />}
              {filtered.map((voucher, index) => (
                <tr key={voucher.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => openEdit(voucher)}>
                  <Td className="mono text-muted-foreground">{index + 1}</Td>
                  <Td className="mono font-medium">{voucher.voucherNo}</Td>
                  <Td>{voucher.voucherTypeName || voucher.baseVoucherType}</Td>
                  <Td>{fmtDate(voucher.voucherDate)}</Td>
                  <Td right><Money v={voucher.totalDebit || 0} /></Td>
                  <Td>
                    <Badge tone={voucher.voucherStatus === "POSTED" ? "ok" : voucher.voucherStatus === "DRAFT" ? "warn" : "bad"}>
                      {voucher.voucherStatus}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(event) => { event.stopPropagation(); openEdit(voucher); }}>
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={(event) => { event.stopPropagation(); setToDelete(voucher); }}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </Td>
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
        title={form.id ? `${form.voucher_no} · ${form.voucher_type_name} · ${form.status}` : "Add Accounting Voucher"}
        desc={form.id ? form.reference_no || undefined : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setDrawer(false)}>Close</Button>
            {!readOnly && canWrite && (
              <>
                {form.status === "POSTED" ? (
                  <Button onClick={saveDraft} disabled={saving}>
                    <CheckCircle className="h-4 w-4 mr-1.5" />
                    Save changes
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={saveDraft} disabled={saving}>Save draft</Button>
                    <Button onClick={saveAndPost} disabled={saving}>
                      <CheckCircle className="h-4 w-4 mr-1.5" />
                      Save &amp; post
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        }
      >
        {!readOnly && canWrite && (
          <div className="flex items-center justify-end mb-3">
            <AiModeButton active={aiMode} onToggle={() => setAiMode((v) => !v)} />
          </div>
        )}
        {aiMode && !readOnly && (
          <div className="mb-4">
            <AiFillPanel target="ACCOUNTING" onApply={fillFormFromAi} liveGrandTotal={totals.debit} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {form.id && (
            <Field label="Voucher ID">
              <Input className="mono" disabled value={form.voucher_no} />
            </Field>
          )}
          <Field label="Base Voucher Type" required error={submitted && !form.base_voucher_type ? "Required" : undefined}>
            <StyledSearchableSelect
              value={form.base_voucher_type}
              options={baseTypeOptions}
              disabled={!!form.id}
              hasError={submitted && !form.base_voucher_type}
              placeholder="Select Base Type"
              onChange={(val) => selectBaseVoucherType(val)}
            />
          </Field>
          <Field label="Voucher Type">
            <StyledSearchableSelect
              value={
                customTypesForBase.some((ct) => ct.id === form.voucher_type_id)
                  ? form.voucher_type_id
                  : ""
              }
              options={customTypeOptions}
              disabled={!!form.id || !form.base_voucher_type || customTypesForBase.length === 0}
              placeholder={customTypesForBase.length === 0 ? "No custom voucher" : "Select custom voucher"}
              allowClear={true}
              onChange={(val) => selectCustomVoucherType(val)}
            />
          </Field>
          <Field label="Voucher Date" required error={submitted && !form.voucher_date ? "Required" : undefined}>
            <DatePicker
              disabled={readOnly}
              value={form.voucher_date}
              onChange={(vDate) => {
                let computedDue = form.due_date;
                if (form.base_voucher_type === "SALES" || form.base_voucher_type === "PURCHASE") {
                  const terms = getPartyPaymentTerms(form.party_id, form.lines[0]?.ledger_id);
                  if (terms) {
                    computedDue = computeDueDate(vDate, terms);
                  }
                }
                setForm({ ...form, voucher_date: vDate, due_date: computedDue });
              }}
            />
          </Field>
          <Field label={
            form.base_voucher_type === "SALES" || form.base_voucher_type === "CREDIT_NOTE"
              ? "Party (Customer)"
              : form.base_voucher_type === "PURCHASE" || form.base_voucher_type === "DEBIT_NOTE"
                ? "Party (Vendor)"
                : isBankCashVoucherType(form.base_voucher_type)
                  ? "Bank / Cash Account"
                  : "Party / Account (Optional)"
          }>
            <StyledSearchableSelect
              value={form.party_id}
              options={partyOptions}
              disabled={readOnly}
              placeholder={
                isBankCashVoucherType(form.base_voucher_type)
                  ? "Select Bank / Cash Account"
                  : "Select Party (Optional)"
              }
              allowClear={!isBankCashVoucherType(form.base_voucher_type)}
              onChange={(selectedId) => selectParty(selectedId)}
            />
          </Field>
          {(form.base_voucher_type === "SALES" || form.base_voucher_type === "PURCHASE") && (
            <Field label="Due Date" error={submitted && form.due_date && form.voucher_date && form.due_date < form.voucher_date ? "Earlier than voucher date" : undefined}>
              <DatePicker min={form.voucher_date} disabled={readOnly} value={form.due_date} onChange={(val) => setForm({ ...form, due_date: val })} />
            </Field>
          )}
          <Field label={form.base_voucher_type === "CREDIT_NOTE" || form.base_voucher_type === "DEBIT_NOTE" ? "Original Invoice ID" : "Reference No."}>
            <Input className="mono" maxLength={50} placeholder="Optional (e.g. Inv #, Ref #)" disabled={readOnly} value={form.reference_no} onChange={(event) => setForm({ ...form, reference_no: event.target.value })} />
          </Field>
          {(form.base_voucher_type === "CREDIT_NOTE" || form.base_voucher_type === "DEBIT_NOTE") && (
            <Field label="Original Invoice Date">
              <DatePicker max={form.voucher_date} disabled={readOnly} value={form.reference_date} onChange={(val) => setForm({ ...form, reference_date: val })} />
            </Field>
          )}
        </div>

        <div className="mt-5 rounded-md border border-border overflow-x-auto min-h-[260px]">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr>
                <Th className="w-12">#</Th>
                <Th className="w-28">Side</Th>
                <Th>Ledger Account</Th>
                <Th right className="w-36">Amount</Th>
                <Th className="w-44">Remarks</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, index) => {
                const isPartyReservedLine = index === 0 && !!form.party_id;
                const eligible = optionsFor(line);
                const currentIsEligible = eligible.some((option) => option.id === line.ledger_id);
                return (
                  <tr key={line.line_no} className="align-top">
                    <Td className="mono text-muted-foreground">{index + 1}</Td>
                    <Td>
                      <Select
                        className="h-8"
                        disabled={readOnly}
                        value={line.side}
                        onChange={(event) => {
                          const newSide = event.target.value as EntrySide;
                          if (isPartyReservedLine) {
                            updateLine(index, { side: newSide });
                          } else {
                            updateLine(index, {
                              side: newSide,
                              ledger_id: "",
                              ledger_name: "",
                            });
                          }
                        }}
                      >
                        <option value="DEBIT">Debit</option>
                        <option value="CREDIT">Credit</option>
                      </Select>
                    </Td>
                    <Td>
                      {isPartyReservedLine ? (
                        <Input
                          className="h-8 bg-muted/60 font-medium cursor-not-allowed"
                          disabled
                          readOnly
                          value={line.ledger_name || "Selected Account"}
                        />
                      ) : (
                        <SearchableLedgerSelect
                          value={line.ledger_id}
                          selectedName={line.ledger_name}
                          options={eligible}
                          disabled={readOnly || !form.base_voucher_type || optionsLoading}
                          hasError={submitted && !line.ledger_id}
                          placeholder={optionsLoading ? "Loading accounts..." : "Search account..."}
                          onChange={(selectedId, selectedName) => {
                            let computedDue = form.due_date;
                            if (selectedId && (form.base_voucher_type === "SALES" || form.base_voucher_type === "PURCHASE")) {
                              const terms = getPartyPaymentTerms(null, selectedId);
                              if (terms) {
                                computedDue = computeDueDate(form.voucher_date, terms);
                              }
                            }
                            setForm((f) => {
                              const updatedLines = f.lines.map((l, idx) =>
                                idx === index ? { ...l, ledger_id: selectedId, ledger_name: selectedName } : l
                              );
                              return {
                                ...f,
                                due_date: computedDue,
                                lines: autoBalancePartyLine(updatedLines, f.base_voucher_type, f.party_id),
                              };
                            });
                          }}
                        />
                      )}
                    </Td>
                    <Td right>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className={
                          "h-8 text-right fig " +
                          (submitted && !(Number(line.amount) > 0) ? "border-destructive" : "") +
                          (isPartyReservedLine ? " bg-muted/60 font-semibold cursor-not-allowed" : "")
                        }
                        disabled={readOnly || isPartyReservedLine}
                        readOnly={isPartyReservedLine}
                        value={line.amount || ""}
                        onChange={(event) => updateLine(index, { amount: Number(event.target.value) || 0 })}
                      />
                    </Td>
                    <Td>
                      <Input className="h-8" maxLength={30} disabled={readOnly} value={line.remarks} onChange={(event) => updateLine(index, { remarks: event.target.value })} />
                    </Td>
                    <Td>
                      {!readOnly && !isPartyReservedLine && form.lines.length > 2 && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeLine(index)} title="Remove line">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="ledger-rule-strong bg-muted/40">
                <td colSpan={3} className="px-4 py-2.5 text-right text-[11px] uppercase font-semibold text-muted-foreground">Totals</td>
                <td className="px-4 py-2.5 text-right fig font-medium">Dr {money(totals.debit)} · Cr {money(totals.credit)}</td>
                <td colSpan={2} className="px-4 py-2.5 text-[12px] font-semibold">
                  {Math.abs(totals.difference) > 0.009 ? (
                    <span className="text-destructive">Difference {money(Math.abs(totals.difference))}</span>
                  ) : totals.debit > 0 ? (
                    <span className="text-[var(--teal)]">Balanced</span>
                  ) : (
                    <span className="text-muted-foreground">Enter amounts</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-3" onClick={addLine}>
            <Plus className="h-4 w-4" />
            Add line
          </Button>
        )}

        <Field label="Narration" className="mt-4">
          <Textarea maxLength={50} disabled={readOnly} value={form.narration} onChange={(event) => setForm({ ...form, narration: event.target.value })} />
        </Field>
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.voucherNo}?`}
        desc="The voucher will be deactivated and retained in the audit trail."
        confirmLabel="Delete voucher"
        onConfirm={deleteVoucher}
      />
    </PageHeader>
  );
}