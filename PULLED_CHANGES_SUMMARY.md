# ImmBiz Books — Pulled Code Changes & Complete Code Specification
**Git Pull Range:** `8a6c0a2..d097fd4`  
**Branch:** `speed-stage`  
**Fast-Forward Summary:** 23 files changed, 2,338 insertions(+), 561 deletions(-)  
**Command:** `git pull origin speed-stage`

---

## 1. Executive Summary

This fast-forward update from `8a6c0a2` to `d097fd4` brings in comprehensive feature implementations and client review refinements across two core pillars:
1. **The Master Module:** Dynamic quick-type ledger categorization (Bank, Cash, Customer, Vendor, Both), automated dual-role party creation with multi-ledger routing, Chart of Accounts Main Category (`M`) management, group-scoped duplicate name validation, bank account holder name persistence, and company financial year context.
2. **The Voucher Module:** Dependent two-tier voucher dropdowns, automatic voucher numbering sequence replication, Line 1 Party/Bank locking with real-time balance auto-tallying, dynamic payment terms due date calculation, unrestricted DR/CR account selection, and high-contrast keyboard combobox navigation.

---

## 2. Commit Log

| Commit | Author | Date | Summary |
|:---|:---|:---|:---|
| **`3b76b92`** | sivasankaran | 2026-10-13 | `feat(master-module): implement changes based on client review` |
| **`b172e9a`** | kumarimmbizsoft-dev | 2026-10-13 | `Update version from tr-8 to tr-9` |
| **`45c2aa6`** | sivasankaran | 2026-10-14 | `Create md file for master module changes` (`Master_changes_11_10_26.md`) |
| **`392123f`** | sivasankaran | 2026-10-14 | `Merge branch 'speed-stage' into speed-stage` |
| **`d98691a`** | sivasankaran | 2026-10-14 | `feat(vouchers): implement changes based on client review 11_10_26` |
| **`d097fd4`** | kumarimmbizsoft-dev | 2026-10-14 | `Update README.md` |

---

## 3. Code Implementations: Master Module

### A. Quick Type Selection & Dual-Role ("Both") Party Sync
**File:** [`frontend-react/src/pages/Ledgers.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/Ledgers.tsx)

#### 1. Mutually Exclusive Quick Type Radios
Replaced independent checkboxes with 5 toggleable radio buttons that adapt form sections in real time:
```tsx
{/* Quick Type Selection */}
<div className="flex flex-wrap items-center gap-6 py-2 px-3 rounded-md bg-muted/40 border border-border/60">
  {(["BANK", "CASH", "CUSTOMER", "VENDOR", "BOTH"] as const).map((t) => (
    <label key={t} className="flex items-center gap-2 cursor-pointer text-sm font-medium">
      <input
        type="radio"
        name="quick_ledger_type"
        className="h-4 w-4 text-[var(--teal)] focus:ring-[var(--teal)]"
        checked={quickType === t}
        onClick={() => {
          // Clicking an active radio deselects it, reverting to GENERAL
          if (quickType === t) {
            setQuickType("GENERAL");
          } else {
            selectQuickType(t);
          }
        }}
        onChange={() => {}}
      />
      <span>{t === "BOTH" ? "Both (Customer & Vendor)" : t.charAt(0) + t.slice(1).toLowerCase()}</span>
    </label>
  ))}
</div>
```

#### 2. Dual-Role Party Creation & Dual Ledger Generation
When saving a party with `quickType === "BOTH"`, the system automatically provisions two linked ledgers (Debtor in *Sundry Debtors* and Creditor in *Sundry Creditors*) and synchronizes a unified `/api/parties` record with `key_group: "B"`:
```tsx
if (quickType === "BOTH") {
  // 1. Create / Update Debtor Ledger under Sundry Debtors
  const debtorPayload = {
    ...basePayload,
    name: form.name.trim(),
    ledger_group_id: sundryDebtorsGroup.id,
    balance_type: "DR",
    category: "customer",
  };
  const debtorRes = await api.post("/ledgers", debtorPayload);
  const debtorLedgerId = envelopeResult(debtorRes)?.id;

  // 2. Create / Update Creditor Ledger under Sundry Creditors
  const creditorPayload = {
    ...basePayload,
    name: form.name.trim(),
    ledger_group_id: sundryCreditorsGroup.id,
    balance_type: "CR",
    category: "vendor",
  };
  const creditorRes = await api.post("/ledgers", creditorPayload);

  // 3. Sync Unified Party Profile with key_group = 'B'
  await api.post("/parties", {
    company_id: company.id,
    key_group: "B", // Both Customer & Vendor
    ledger_id: debtorLedgerId,
    name_contact_info: {
      company_name: form.name.trim(),
      display_name: form.name.trim(),
      first_name: form.contact_person,
      email: form.email,
      mobile: form.mobile,
      gst_in: form.gstin,
      pan: form.pan,
    },
    billing_address: form.billing_address,
    shipping_address: form.shipping_same_as_billing ? form.billing_address : form.shipping_address,
    credit_limit: form.credit_limit || null,
    payment_terms: form.payment_terms || null,
  });
}
```

---

### B. Dynamic Dual-Role Voucher Routing
**File:** [`frontend-react/src/pages/TradeVoucher.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/TradeVoucher.tsx)

Automatically routes dual-role parties to the Debtor ledger in Sales and dynamically resolves to the partner Creditor ledger in Purchase:
```tsx
function buildDetails(): { ok: boolean; details?: any[]; error?: string } {
  const party = partyOptions.find((p) => p.id === form.party_id);
  if (!party?.ledger_id) return { ok: false, error: `${partyWord} has no linked ledger` };
  
  const partyName = (
    party.name_contact_info?.company_name ||
    party.name_contact_info?.display_name ||
    party.name_contact_info?.first_name ||
    ""
  ).trim().toLowerCase();

  let effectiveLedgerId = party.ledger_id;

  // If party is dual-role ('B') and transaction is Purchase, resolve to Creditor ledger
  if (!isSales && party.key_group === "B") {
    const creditorLedger = ledgers.find(
      (l) => l.name.trim().toLowerCase() === partyName && 
             (l.category === "vendor" || (l as any).balance_type === "CR")
    );
    if (creditorLedger) {
      effectiveLedgerId = creditorLedger.id;
    }
  }

  const rows: Array<{ ledger_id: string; debit_amount: number; credit_amount: number; remarks?: string | null }> = [];
  if (isSales) {
    rows.push({ ledger_id: effectiveLedgerId, debit_amount: totals.grand, credit_amount: 0, remarks: form.invoice_no || null });
    // ... revenue and tax accounts
  } else {
    // ... expense and input tax accounts
    rows.push({ ledger_id: effectiveLedgerId, debit_amount: 0, credit_amount: totals.grand, remarks: form.invoice_no || null });
  }
  return { ok: true, details: rows };
}
```

---

### C. Main Category (`key_group = 'M'`) Creation in Chart of Accounts
**File:** [`frontend-react/src/pages/LedgerGroups.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/LedgerGroups.tsx)

Added explicit button, state tracking, and drawer handling for Main Categories under root Primary groups:
```tsx
// State initialization supporting key_group M or S
const [form, setForm] = useState<{
  id: string | null;
  name: string;
  parent_id: string;
  balance_type: string;
  key_group: "M" | "S";
}>({
  id: null,
  name: "",
  parent_id: "",
  balance_type: "",
  key_group: "S",
});

function openNewMain() {
  setForm({ id: null, name: "", parent_id: "", balance_type: "", key_group: "M" });
  setSubmitted(false);
  setDrawer(true);
}

// In Drawer submission:
const payload: any = {
  name: form.name.trim(),
  parent_id: form.parent_id,
  balance_type: form.balance_type, // Explicit DR / CR selection
  active: "Y",
};
if (!form.id) {
  payload.key_group = form.key_group; // "M" for Main, "S" for Sub
}
```

---

### D. Group-Scoped Ledger Name Uniqueness
**Files:** [`backend/app/services/ledger_service.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/services/ledger_service.py), [`backend/app/routers/ledger.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/routers/ledger.py), [`backend/app/schemas/ledger.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/schemas/ledger.py)

Ledger duplicate name validation is now scoped by `ledger_group_id` rather than company-wide:
```python
# In LedgerService.validate()
if name and name.strip():
    q = db.query(Ledger).filter(
        func.lower(Ledger.name) == name.strip().lower(),
        Ledger.active == "Y",
    )
    if company_id is not None:
        q = q.filter(Ledger.company_id == company_id)
    if exclude_id:
        q = q.filter(Ledger.id != exclude_id)
    # Scope uniqueness check to the target ledger group
    if ledger_group_id:
        q = q.filter(Ledger.ledger_group_id == ledger_group_id)
    dup = q.first()
    if dup:
        out["name"] = {
            "level": "error",
            "message": f"A ledger named '{dup.name}' already exists in this group",
            "duplicate_id": str(dup.id),
        }
```

---

### E. Bank Account Holder Name Persistence
**Files:** [`bank_account.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/models/bank_account.py), [`bank_account.py` (schemas)](file:///Users/j/Desktop/GITIMMIBZ/backend/app/schemas/bank_account.py), [`bank_account_service.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/services/bank_account_service.py), [`Banks.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/Banks.tsx)

#### SQLAlchemy Model:
```python
class BankAccount(Base):
    __tablename__ = "bank_account"
    __table_args__ = {"schema": "master"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_type = Column(String(10), default="BANK")  # BANK / CASH
    bank_name = Column(String(100))
    account_holder_name = Column(String(100))  # Added field
    account_number = Column(String(30))
    ifsc_code = Column(String(11))
    branch = Column(String(100))
```

#### Pydantic Schema:
```python
class BankAccountBase(BaseModel):
    account_type: str = "BANK"
    bank_name: Optional[str] = Field(None, max_length=100)
    account_holder_name: Optional[str] = Field(None, max_length=100)  # Added field
    account_number: Optional[str] = Field(None, max_length=30)
    ifsc_code: Optional[str] = Field(None, max_length=11)
    branch: Optional[str] = Field(None, max_length=100)
```

#### UI Drawer in `Banks.tsx`:
```tsx
{form.account_type === "BANK" && (
  <>
    <Field label="Account holder name">
      <Input
        value={form.account_holder_name}
        onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })}
        placeholder="e.g. My Business Pvt Ltd"
      />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Account number">
        <Input className="mono" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
      </Field>
      {/* ... */}
    </div>
  </>
)}
```

---

## 4. Code Implementations: Voucher Module

### A. Two-Tier Dependent Dropdowns
**File:** [`frontend-react/src/pages/AccountingVouchers.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/AccountingVouchers.tsx)

Splits standard classifications and custom user types into two correlated selectors:
```tsx
// Dropdown 1: Base Voucher Type (Standard System Types)
const baseTypes = useMemo(() => {
  return voucherTypes.filter((vt) => str(vt.is_system) === "Y");
}, [voucherTypes]);

// Dropdown 2: Custom Voucher Types filtered by selected Base Type
const customTypesForBase = useMemo(() => {
  if (!form.base_voucher_type) return [];
  return voucherTypes.filter(
    (vt) => str(vt.is_system) === "N" && vt.base_voucher_type === form.base_voucher_type
  );
}, [voucherTypes, form.base_voucher_type]);

// JSX Layout:
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  <Field label="Base Voucher Type" required>
    <StyledSearchableSelect
      value={form.base_voucher_type}
      options={baseTypes.map((b) => ({ id: b.base_voucher_type, name: b.name }))}
      onChange={(val) => {
        setForm((prev) => ({
          ...prev,
          base_voucher_type: val,
          voucher_type_id: "", // Reset custom sub-type
        }));
      }}
    />
  </Field>

  <Field label="Voucher Type (Custom)">
    <StyledSearchableSelect
      value={form.voucher_type_id}
      options={customTypesForBase.map((c) => ({ id: c.id, name: c.name }))}
      disabled={customTypesForBase.length === 0}
      placeholder={customTypesForBase.length === 0 ? "No custom voucher" : "Select custom type..."}
      onChange={(val) => setForm((prev) => ({ ...prev, voucher_type_id: val }))}
    />
  </Field>
</div>
```

---

### B. Numbering Sequence Auto-Replication & Expansion
**Files:** [`voucher_type_service.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/services/voucher_type_service.py), [`voucher_sequence_service.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/services/voucher_sequence_service.py), [`voucher_sequence.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/models/voucher_sequence.py)

#### 1. Auto-Replication on Voucher Type Creation
```python
# In VoucherTypeService.create_voucher_type():
db.add(row)

# Auto-create corresponding voucher sequence for System Settings
seq_prefix = (payload.abbreviation or clean_name[:3] or "VC").strip().upper()
existing_seq = db.query(VoucherSequence).filter(
    VoucherSequence.company_id == company_id,
    VoucherSequence.voucher_type == clean_name,
).first()

if not existing_seq:
    db_seq = VoucherSequence(
        company_id=company_id,
        voucher_type=clean_name,
        prefix=seq_prefix,
        last_number=0,
        number_width=4,
        active=payload.active,
        created_by=actor,
    )
    db.add(db_seq)
```

#### 2. Sequence Synchronization on Rename / Deactivate
```python
# In VoucherTypeService.update_voucher_type():
seq = db.query(VoucherSequence).filter(
    VoucherSequence.company_id == company_id,
    VoucherSequence.voucher_type == old_name,
).first()
if seq:
    if name_changed:
        seq.voucher_type = name
    if "active" in changes:
        seq.active = changes["active"]
    seq.modified_by = actor
```

#### 3. Sequence Column Width Expansion
```python
# In backend/app/models/voucher_sequence.py and init_db.py:
class VoucherSequence(Base):
    # Expanded from VARCHAR(20) to VARCHAR(100)
    voucher_type = Column(String(100), nullable=False)
```

---

### C. Complete Removal of DR / CR Account Restrictions
**File:** [`backend/app/services/voucher_header_service.py`](file:///Users/j/Desktop/GITIMMIBZ/backend/app/services/voucher_header_service.py)

```python
# In VoucherHeaderService.get_account_ledger_options():
# Replaced rigid bank/cash filters with universal active ledger availability:
for row in ledgers:
    item = {
        "id": str(lid),
        "name": lname,
        "ledgerGroup": grp_name,
        "groupName": grp_name,
        "groupPath": group_path or None,
    }
    # Allow any active ledger on both DEBIT and CREDIT
    options["DEBIT"].append(item)
    options["CREDIT"].append(item)
```

---

### D. Line 1 Reservation & Balance Auto-Tally
**File:** [`frontend-react/src/pages/AccountingVouchers.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/AccountingVouchers.tsx)

Locks Line 1 to the Party/Bank selected in the header and automatically calculates the balancing amount:
```tsx
function autoBalancePartyLine(lines: AccountingLine[], partyLedgerId: string): AccountingLine[] {
  if (!lines.length || !partyLedgerId) return lines;

  const nextLines = [...lines];
  const line1 = { ...nextLines[0] };
  line1.ledger_id = partyLedgerId;

  // Calculate sum of lines 2 onwards
  let sameSideOtherSum = 0;
  let oppositeSideSum = 0;

  for (let i = 1; i < nextLines.length; i++) {
    const l = nextLines[i];
    const amt = parseFloat(l.amount) || 0;
    if (l.entry_type === line1.entry_type) {
      sameSideOtherSum += amt;
    } else {
      oppositeSideSum += amt;
    }
  }

  // Balancing amount for Line 1
  const balance = Math.max(0, oppositeSideSum - sameSideOtherSum);
  line1.amount = balance > 0 ? balance.toFixed(2) : line1.amount;
  nextLines[0] = line1;

  return nextLines;
}
```

---

### E. Due Date Auto-Calculation from Payment Terms
**File:** [`frontend-react/src/pages/AccountingVouchers.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/AccountingVouchers.tsx)

```tsx
function computeDueDate(baseDateStr: string, paymentTerms: string | number | null | undefined): string {
  if (!baseDateStr) return "";
  if (!paymentTerms) return baseDateStr;

  let days = 0;
  if (typeof paymentTerms === "number") {
    days = paymentTerms;
  } else {
    const match = String(paymentTerms).match(/\d+/);
    if (match) days = parseInt(match[0], 10);
  }

  if (isNaN(days) || days <= 0) return baseDateStr;

  const baseDate = new Date(baseDateStr);
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().split("T")[0];
}
```

---

### F. High-Contrast Keyboard Navigation Combobox
**File:** [`frontend-react/src/pages/AccountingVouchers.tsx`](file:///Users/j/Desktop/GITIMMIBZ/frontend-react/src/pages/AccountingVouchers.tsx)

Replaced low-visibility gray hover with deep teal background (`bg-primary`) and bold white text (`text-primary-foreground font-bold`):
```tsx
<div
  key={opt.id}
  className={cn(
    "flex items-center justify-between px-3 py-2 text-xs cursor-pointer rounded-sm transition-colors",
    index === activeIndex
      ? "bg-primary text-primary-foreground font-bold shadow-sm" // High-contrast active row
      : "hover:bg-accent/70 text-foreground"
  )}
  onClick={() => selectOption(opt)}
>
  <div className="flex flex-col">
    <span className={cn("text-xs font-medium", index === activeIndex ? "text-primary-foreground font-bold" : "")}>
      {opt.name}
    </span>
    {opt.groupName && (
      <span className={cn("text-[10px]", index === activeIndex ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {opt.groupName}
      </span>
    )}
  </div>
  {value === opt.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
</div>
```

---

## 5. Verification & Validation Results

* **TypeScript Compilation:** Passed cleanly via `tsc -b && vite build`.
* **Vite Production Bundler:** Built in `1.95s` producing 43 chunk assets without warnings.
* **Schema Integrity:** Model and schema attributes for `account_holder_name` and `voucher_type` length verified against both Supabase `master` and `demo` tables.
