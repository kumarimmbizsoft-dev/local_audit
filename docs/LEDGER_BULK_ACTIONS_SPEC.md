# Ledger Master — Bulk Actions & Multi-Selection Feature Specification

> **Status:** Paused / Future Implementation  
> **Target Page:** [Ledgers.tsx](file:///c:/Users/Ranra/Siva_imm/Open_Code/Git/audit1/frontend-react/src/pages/Ledgers.tsx)  
> **Created Date:** 2026-10-13  
> **Purpose:** Detailed documentation of the multi-selection checkbox column and bulk action toolbar for discussion with the client before re-enabling.

---

## 1. Overview & Business Value

In the **Ledger Master** (`/app/ledgers`), users manage hundreds or thousands of accounts. The multi-select checkbox feature allows accountants to perform batch operations on multiple accounts at once instead of opening and editing them one by one.

### Key Use Cases
1. **Fiscal Year-End Clean Up:** Deactivating obsolete or zero-activity accounts in bulk.
2. **Chart of Accounts Restructuring:** Moving multiple expense or asset ledgers from one sub-category to another.
3. **Duplicate Resolution:** Merging duplicate party or general ledgers created mistakenly by different users into a single master account, automatically re-pointing transaction history.
4. **Batch Deletion:** Removing unneeded draft/new ledgers that have no voucher activity.

---

## 2. Feature Breakdown

### A. Table Selection UI
* **Checkbox Column:** A dedicated narrow column (`Th className="w-8"`) positioned immediately before the **NAME** column.
* **Row Checkbox:** Each ledger row contains an individual checkbox (`Checkbox checked={selected.has(l.id)}`).
* **Header Select-All (Planned):** A master checkbox in the table header to select/deselect all currently visible (or filtered) rows.
* **Selection Counter:** Displays how many ledgers are currently selected (e.g., `5 selected`).

---

### B. Bulk Action Toolbar (Appears when `selected.size > 0`)

When one or more ledgers are selected, an action banner slides in above the table with the following tools:

| Action | API Endpoint | Description |
| :--- | :--- | :--- |
| **Activate** | `POST /api/import/bulk-status` | Marks selected ledgers as `active = 'Y'`. |
| **Deactivate** | `POST /api/import/bulk-status` | Marks selected ledgers as `active = 'N'`. Preserves voucher history. |
| **Bulk move to sub-category…** | `POST /api/import/bulk-category` | Dropdown of sub-categories (`key_group = 'S'`). Reassigns `ledger_group_id` for all selected accounts in one transaction. |
| **Merge into…** | `POST /api/ledgers/merge` | *(Available when exactly 1 ledger is selected)* Opens a modal to select a target ledger. Re-points all historical voucher entries to the target ledger and deactivates the source ledger. |
| **Delete** | `POST /api/import/bulk-delete` | Batch soft-deactivates selected ledgers. Automatically protects system and frozen accounts. |
| **Clear** | Client-side | Clears the selection set. |

---

## 3. Backend Endpoints Available

The backend services for these operations are already implemented:

1. **Bulk Status Change:**
   ```json
   POST /api/import/bulk-status
   {
     "entity": "LEDGER",
     "ids": ["uuid-1", "uuid-2"],
     "active": "Y" | "N"
   }
   ```

2. **Bulk Category Reassignment:**
   ```json
   POST /api/import/bulk-category
   {
     "ids": ["uuid-1", "uuid-2"],
     "ledger_group_id": "group-uuid"
   }
   ```

3. **Ledger Merge:**
   ```json
   POST /api/ledgers/merge
   {
     "source_id": "source-uuid",
     "target_id": "target-uuid"
   }
   ```

4. **Bulk Deletion:**
   ```json
   POST /api/import/bulk-delete
   {
     "entity": "LEDGER",
     "ids": ["uuid-1", "uuid-2"]
   }
   ```

---

## 4. UI Implementation Blueprint (For Quick Re-enabling)

When the client approves the feature, reinstate the following in [Ledgers.tsx](file:///c:/Users/Ranra/Siva_imm/Open_Code/Git/audit1/frontend-react/src/pages/Ledgers.tsx):

### 1. State
```tsx
const [selected, setSelected] = useState<Set<string>>(new Set());
const [mergeOpen, setMergeOpen] = useState(false);
const [mergeTarget, setMergeTarget] = useState("");

function toggleSelect(id: string, checked: boolean) {
  setSelected((s) => {
    const n = new Set(s);
    checked ? n.add(id) : n.delete(id);
    return n;
  });
}
```

### 2. Toolbar Component
```tsx
{selected.size > 0 && (
  <div className="card-panel mb-4 px-4 py-2.5 flex items-center gap-3 flex-wrap fade-up">
    <span className="text-[13px] font-semibold">{selected.size} selected</span>
    <Button size="sm" variant="outline" onClick={() => bulkStatus("Y")}>Activate</Button>
    <Button size="sm" variant="outline" onClick={() => bulkStatus("N")}>Deactivate</Button>
    <Select className="h-8 w-52" defaultValue="" onChange={(e) => bulkCategory(e.target.value)}>
      <option value="">Bulk move to sub-category…</option>
      {groups.filter((g) => g.key_group === "S").map((g) => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
    </Select>
    {selected.size === 1 && canDelete && (
      <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
        <GitMerge className="h-3.5 w-3.5 mr-1" />
        Merge into…
      </Button>
    )}
    {canDelete && (
      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:text-destructive" onClick={bulkDelete}>
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        Delete
      </Button>
    )}
    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
  </div>
)}
```

### 3. Table Column & Row Checkbox
* In `<thead>`: `<Th className="w-8" />`
* In `<tbody>`:
  ```tsx
  <Td>
    <Checkbox checked={selected.has(l.id)} onChange={(e) => toggleSelect(l.id, e.target.checked)} />
  </Td>
  ```
