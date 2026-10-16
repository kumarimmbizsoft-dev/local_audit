import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api, envelopeOk, envelopeMessage, envelopeResult } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/toast";
import { ActivityDrawer } from "../components/ActivityDrawer";
import {
  Button,
  Field,
  Input,
  Select,
  PageHeader,
  Panel,
  SearchBox,
  TableWrap,
  Th,
  Td,
  EmptyRow,
  Badge,
  RowActions,
  Drawer,
  ConfirmDialog,
  Spinner,
} from "../components/ui";

interface Group {
  id: string;
  name: string;
  parent_id: string | null;
  key_group: string | null;
  balance_type: string | null;
  hierarchy_path?: string | null;
  is_system: string;
}

type Tab = "P" | "M" | "S";

export function LedgerGroups() {
  const { can } = useAuth();
  const { toast } = useToast();
  const canWrite = can("LEDGER_GROUP", "write");
  const canDelete = can("LEDGER_GROUP", "delete");

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("S");
  const [q, setQ] = useState("");

  const [drawer, setDrawer] = useState(false);
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
  const [submitted, setSubmitted] = useState(false);
  const [toDelete, setToDelete] = useState<Group | null>(null);
  const [auditFor, setAuditFor] = useState<Group | null>(null);

  async function load() {
    setLoading(true);
    const r = await api.get("/ledger-groups");
    setGroups(envelopeResult<Group[]>(r) || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const mains = groups.filter((g) => g.key_group === "M");
  const primaries = groups.filter((g) => g.key_group === "P");
  const rows = groups
    .filter((g) => g.key_group === tab)
    .filter((g) => `${g.name} ${byId.get(g.parent_id || "")?.name || ""}`.toLowerCase().includes(q.toLowerCase()));

  const editingGroup = form.id ? groups.find((g) => g.id === form.id) : null;
  const isMain = form.id ? editingGroup?.key_group === "M" : form.key_group === "M";
  const parentOptions = isMain ? primaries : mains;
  const parentLabel = isMain ? "Primary category" : "Main category";

  function openNewSub() {
    setForm({ id: null, name: "", parent_id: "", balance_type: "", key_group: "S" });
    setSubmitted(false);
    setDrawer(true);
  }

  function openNewMain() {
    setForm({ id: null, name: "", parent_id: "", balance_type: "", key_group: "M" });
    setSubmitted(false);
    setDrawer(true);
  }

  function openEdit(g: Group) {
    setForm({
      id: g.id,
      name: g.name,
      parent_id: g.parent_id || "",
      balance_type: g.balance_type || "",
      key_group: (g.key_group as "M" | "S") || "S",
    });
    setSubmitted(false);
    setDrawer(true);
  }

  async function save() {
    setSubmitted(true);
    if (!form.name.trim() || !form.parent_id || !["DR", "CR"].includes(form.balance_type)) return;
    const payload: any = {
      name: form.name.trim(),
      parent_id: form.parent_id,
      balance_type: form.balance_type,
      active: "Y",
    };
    if (!form.id) {
      payload.key_group = form.key_group;
    }
    const r = form.id
      ? await api.put(`/ledger-groups/${form.id}`, payload)
      : await api.post("/ledger-groups", payload);
    if (!envelopeOk(r)) {
      toast({ title: "Could not save", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({
      title: form.id
        ? (isMain ? "Main category updated" : "Sub-category updated")
        : (isMain ? "Main category created" : "Sub-category created"),
      tone: "success",
    });
    setDrawer(false);
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await api.del(`/ledger-groups/${toDelete.id}`);
    if (!envelopeOk(r)) {
      toast({ title: "Could not delete", desc: envelopeMessage(r), tone: "error" });
      return;
    }
    toast({ title: "Deleted", tone: "success" });
    load();
  }

  return (
    <PageHeader
      title="Ledger Groups"
      sub="Primary, main and sub-categories that structure the chart of accounts"
    >
      <Panel
        pad={false}
        title="Chart structure"
        right={<SearchBox value={q} onChange={setQ} placeholder="Search groups" />}
      >
        <div className="px-5 pt-3 flex items-center gap-2">
          {(["P", "M", "S"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-1.5 rounded-md text-sm font-medium " +
                (tab === t ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")
              }
            >
              {t === "P" ? "Primary" : t === "M" ? "Main" : "Sub-categories"}
            </button>
          ))}
          {tab === "M" && canWrite && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={openNewMain}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add main category
            </Button>
          )}
          {tab === "S" && canWrite && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={openNewSub}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add sub-category
            </Button>
          )}
        </div>
        <div className="p-5 pt-3">
          {loading ? (
            <Spinner />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Name</Th>
                  {tab !== "P" && <Th>Belongs to</Th>}
                  <Th className="w-32">Normal balance</Th>
                  {tab !== "P" && (
                    <Th className="w-44" right>
                      Actions
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <EmptyRow colSpan={tab === "S" ? 4 : tab === "P" ? 2 : 3} />}
                {rows.map((g) => (
                  <tr key={g.id} className="hover:bg-muted/40">
                    <Td className="font-medium">
                      {g.name}
                      {g.is_system === "Y" && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">system</span>
                      )}
                      {g.hierarchy_path && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{g.hierarchy_path}</div>
                      )}
                    </Td>
                    {tab !== "P" && <Td className="text-muted-foreground">{byId.get(g.parent_id || "")?.name || "—"}</Td>}
                    <Td>
                      <Badge tone={g.balance_type === "DR" ? "ok" : "warn"}>{g.balance_type}</Badge>
                    </Td>
                    {tab !== "P" && (
                      <Td>
                        <RowActions
                          canEdit={canWrite}
                          canDelete={canDelete && g.is_system !== "Y"}
                          onActivity={() => setAuditFor(g)}
                          onEdit={() => openEdit(g)}
                          onDelete={() => setToDelete(g)}
                        />
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </Panel>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title={form.id ? (isMain ? "Edit main category" : "Edit sub-category") : (isMain ? "New main category" : "New sub-category")}
        footer={
          <>
            <Button variant="outline" onClick={() => setDrawer(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{form.id ? "Save changes" : "Create"}</Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Name" required error={submitted && !form.name.trim() ? "Name is required." : undefined}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={parentLabel} required error={submitted && !form.parent_id ? `Choose a ${parentLabel.toLowerCase()}.` : undefined}>
            <Select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
              <option value="">Select</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Normal balance"
            required
            error={submitted && !["DR", "CR"].includes(form.balance_type) ? "Select DR or CR." : undefined}
          >
            <Select value={form.balance_type} onChange={(e) => setForm({ ...form, balance_type: e.target.value })}>
              <option value="">Select</option>
              <option value="DR">DR</option>
              <option value="CR">CR</option>
            </Select>
          </Field>
        </div>
      </Drawer>

      <ActivityDrawer
        open={!!auditFor}
        onClose={() => setAuditFor(null)}
        entity="ledger_group"
        entityId={auditFor?.id || null}
        title={auditFor?.name || ""}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete “${toDelete?.name}”?`}
        onConfirm={confirmDelete}
      />
    </PageHeader>
  );
}
