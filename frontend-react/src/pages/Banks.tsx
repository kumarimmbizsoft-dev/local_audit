import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Landmark, Wallet } from "lucide-react";
import { api, envelopeOk, envelopeMessage, envelopeResult } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/toast";
import { IFSC_RE } from "../lib/gst";
import { ActivityDrawer } from "../components/ActivityDrawer";
import {
  Button, DatePicker, Field, Input, Select, PageHeader, Panel, SearchBox, TableWrap, Th, Td,
  EmptyRow, Money, Badge, RowActions, Drawer, ConfirmDialog, Spinner, ValidationHint,
} from "../components/ui";

interface Account {
  id: string;
  account_type: string;
  bank_name: string | null;
  account_holder_name?: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  branch: string | null;
  upi_id: string | null;
  ledger_id: string | null;
  ledger_name: string | null;
  opening_balance: number;
  active: string;
}

const empty = () => ({
  id: null as string | null,
  account_type: "BANK",
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  ifsc_code: "",
  branch: "",
  upi_id: "",
  opening_balance: "",
  opening_balance_date: "",
});

export function Banks() {
  const { can } = useAuth();
  const { toast } = useToast();
  const loc = useLocation();
  const canWrite = can("BANK_CASH", "write");
  const canDelete = can("BANK_CASH", "delete");

  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState(empty());
  const [submitted, setSubmitted] = useState(false);
  const [toDelete, setToDelete] = useState<Account | null>(null);
  const [auditFor, setAuditFor] = useState<Account | null>(null);

  async function load() {
    setLoading(true);
    const r = await api.get("/bank-accounts");
    setRows(envelopeResult<Account[]>(r) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if ((loc.state as any)?.openNew && canWrite) openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      rows.filter((b) =>
        `${b.bank_name || ""} ${b.account_number || ""} ${b.ifsc_code || ""}`.toLowerCase().includes(q.toLowerCase())
      ),
    [rows, q]
  );

  const ifscHint =
    form.ifsc_code && form.account_type === "BANK"
      ? IFSC_RE.test(form.ifsc_code.toUpperCase())
        ? { level: "ok" as const, message: "Valid IFSC format" }
        : { level: "error" as const, message: "IFSC must match AAAA0XXXXXX" }
      : null;

  function openNew() {
    setForm(empty());
    setSubmitted(false);
    setDrawer(true);
  }
  function openEdit(b: Account) {
    setForm({
      id: b.id,
      account_type: b.account_type,
      bank_name: b.bank_name || "",
      account_holder_name: (b as any).account_holder_name || "",
      account_number: b.account_number || "",
      ifsc_code: b.ifsc_code || "",
      branch: b.branch || "",
      upi_id: b.upi_id || "",
      opening_balance: b.opening_balance != null ? String(b.opening_balance) : "",
      opening_balance_date: "",
    });
    setSubmitted(false);
    setDrawer(true);
  }

  async function save() {
    setSubmitted(true);
    if (!form.bank_name.trim()) return;
    if (ifscHint?.level === "error") return;
    const payload: any = {
      account_type: form.account_type,
      bank_name: form.bank_name.trim(),
      account_holder_name: form.account_holder_name ? form.account_holder_name.trim() : null,
      account_number: form.account_number || null,
      ifsc_code: form.ifsc_code ? form.ifsc_code.toUpperCase() : null,
      branch: form.branch || null,
      upi_id: form.upi_id || null,
      opening_balance: form.opening_balance ? Number(form.opening_balance) : null,
      opening_balance_date: form.opening_balance_date || null,
      active: "Y",
    };
    const r = form.id ? await api.put(`/bank-accounts/${form.id}`, payload) : await api.post("/bank-accounts", payload);
    if (!envelopeOk(r)) {
      toast({ title: "Could not save", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({ title: form.id ? "Account updated" : "Account created", desc: `${form.bank_name} · linked ledger ready`, tone: "success" });
    setDrawer(false);
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await api.del(`/bank-accounts/${toDelete.id}`);
    if (!envelopeOk(r)) {
      toast({ title: "Could not remove", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({ title: "Account removed", tone: "success" });
    load();
  }

  const banks = filtered.filter((b) => b.account_type !== "CASH");
  const cash = filtered.filter((b) => b.account_type === "CASH");

  return (
    <PageHeader
      title="Bank & Cash Master"
      sub="Accounts feeding the Bank Book, Cash Book and reconciliation — each links to a ledger"
      actions={
        canWrite && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            New account
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        {[
          { l: "Bank accounts", v: banks.length, icon: Landmark },
          { l: "Cash accounts", v: cash.length, icon: Wallet },
          { l: "Combined opening balance", v: null as any },
        ].map((c) => (
          <div key={c.l} className="card-panel px-5 py-3.5">
            <div className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">{c.l}</div>
            <div className="fig text-[22px] mt-0.5">
              {c.v ?? <Money v={filtered.reduce((s, b) => s + (b.opening_balance || 0), 0)} />}
            </div>
          </div>
        ))}
      </div>

      <Panel pad={false} title={`${filtered.length} accounts`} right={<SearchBox value={q} onChange={setQ} placeholder="Search bank, account no, IFSC" />}>
        {loading ? (
          <Spinner />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th className="w-20">Type</Th>
                <Th>Account number</Th>
                <Th>IFSC</Th>
                <Th>Branch</Th>
                <Th>Linked ledger</Th>
                <Th right>Opening</Th>
                <Th className="w-44" right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <EmptyRow colSpan={8} text="No bank or cash accounts yet." />}
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-muted/40">
                  <Td className="font-medium">{b.bank_name || "—"}</Td>
                  <Td>
                    <Badge tone={b.account_type === "CASH" ? "warn" : "ok"}>{b.account_type}</Badge>
                  </Td>
                  <Td className="mono">{b.account_number || "—"}</Td>
                  <Td className="mono">{b.ifsc_code || "—"}</Td>
                  <Td className="text-muted-foreground">{b.branch || "—"}</Td>
                  <Td className="text-muted-foreground">{b.ledger_name || "—"}</Td>
                  <Td right><Money v={b.opening_balance || 0} /></Td>
                  <Td>
                    <RowActions
                      canEdit={canWrite}
                      canDelete={canDelete}
                      onActivity={() => setAuditFor(b)}
                      onEdit={() => openEdit(b)}
                      onDelete={() => setToDelete(b)}
                    />
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
        title={form.id ? "Edit account" : "New bank / cash account"}
        desc="Creating an account auto-creates its ledger under Bank Accounts / Cash-in-hand."
        footer={
          <>
            <Button variant="outline" onClick={() => setDrawer(false)}>Cancel</Button>
            <Button onClick={save}>{form.id ? "Save changes" : "Create account"}</Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Account type">
            <Select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
              <option value="BANK">Bank</option>
              <option value="CASH">Cash</option>
            </Select>
          </Field>
          <Field label={form.account_type === "CASH" ? "Cash ledger name" : "Bank & account name"} required error={submitted && !form.bank_name.trim() ? "Required" : undefined}>
            <Input autoFocus value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder={form.account_type === "CASH" ? "Petty Cash" : "HDFC Bank – 5521"} />
          </Field>
          {form.account_type === "BANK" && (
            <>
              <Field label="Account holder name">
                <Input value={form.account_holder_name} onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })} placeholder="e.g. My Business Pvt Ltd" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Account number">
                  <Input className="mono" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
                </Field>
                <Field label="IFSC" hint={<ValidationHint level={ifscHint?.level} message={ifscHint?.message} />}>
                  <Input className="mono uppercase" maxLength={11} value={form.ifsc_code} onChange={(e) => setForm({ ...form, ifsc_code: e.target.value.toUpperCase() })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Branch">
                  <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                </Field>
                <Field label="UPI ID">
                  <Input className="mono" value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} />
                </Field>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening balance">
              <Input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
            </Field>
            <Field label="As on date">
              <DatePicker value={form.opening_balance_date} onChange={(val) => setForm({ ...form, opening_balance_date: val })} />
            </Field>
          </div>
        </div>
      </Drawer>

      <ActivityDrawer
        open={!!auditFor}
        onClose={() => setAuditFor(null)}
        entity="bank_account"
        entityId={auditFor?.id || null}
        title={auditFor?.bank_name || ""}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Remove “${toDelete?.bank_name}”?`}
        desc="The linked ledger is also deactivated; posted vouchers keep their history."
        confirmLabel="Remove"
        onConfirm={confirmDelete}
      />
    </PageHeader>
  );
}
