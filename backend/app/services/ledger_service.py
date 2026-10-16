from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func
from app.models.ledger import Ledger
from app.models.ledger_group import LedgerGroup
from app.models.voucher_detail import VoucherDetail
from app.schemas.ledger import (
    LedgerCreate,
    LedgerUpdate,
    LedgerQuickCreate,
    LedgerBulkRequest,
)
from app.schemas.response import Status
from app.services.gst_service import GstService
from typing import List, Optional, Tuple, Any, Dict
from uuid import UUID

# Category -> suggested (sub) ledger group code for auto-suggest.
CATEGORY_CODE_MAP = {
    "bank": "BANK_ACCOUNTS",
    "cash": "CASH_IN_HAND",
    "customer": "SUNDRY_DEBTORS",
    "vendor": "SUNDRY_CREDITORS",
    "income": "SALES_ACCOUNTS",
    "expense": "OFFICE_EXPENSES",
    "tax": "DUTIES_TAXES",
}


class LedgerService:
    @staticmethod
    def _to_dict(ledger: Ledger) -> Dict[str, Any]:
        return {
            "id": str(ledger.id),
            "company_id": str(ledger.company_id) if ledger.company_id else None,
            "name": ledger.name,
            "ledger_group_id": str(ledger.ledger_group_id)
            if ledger.ledger_group_id
            else None,
            "category": ledger.category,
            "balance_type": ledger.balance_type,
            "opening_balance": float(ledger.opening_balance)
            if ledger.opening_balance
            else None,
            "opening_balance_date": ledger.opening_balance_date.isoformat()
            if ledger.opening_balance_date
            else None,
            "description": ledger.description,
            "gstin": ledger.gstin,
            "gst_type": ledger.gst_type,
            "default_gst_rate": float(ledger.default_gst_rate)
            if ledger.default_gst_rate is not None
            else None,
            "hsn_sac": ledger.hsn_sac,
            "address": ledger.address,
            "contact_person": ledger.contact_person,
            "email": ledger.email,
            "mobile": ledger.mobile,
            "credit_limit": float(ledger.credit_limit)
            if ledger.credit_limit is not None
            else None,
            "payment_terms": ledger.payment_terms,
            "default_narration": ledger.default_narration,
            "tags": ledger.tags,
            "cost_center_id": str(ledger.cost_center_id)
            if ledger.cost_center_id
            else None,
            "custom_fields": ledger.custom_fields,
            "is_bank": ledger.is_bank,
            "is_cash": ledger.is_cash,
            "is_frozen": ledger.is_frozen,
            "active": ledger.active,
            "is_system": ledger.is_system,
            "created_by": ledger.created_by,
            "modified_by": ledger.modified_by,
            "created_date": ledger.created_date.isoformat()
            if ledger.created_date
            else None,
            "modified_date": ledger.modified_date.isoformat()
            if ledger.modified_date
            else None,
        }

    @staticmethod
    def get_all(
        db: Session,
        skip: int = 0,
        limit: int = 500,
        search: Optional[str] = None,
        category: Optional[str] = None,
        include_inactive: bool = False,
        company_id: Optional[UUID] = None,
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        if company_id is None:
            return ([], Status.SUCCESS, "No company selected")
        query = db.query(Ledger).filter(Ledger.company_id == company_id)
        if not include_inactive:
            query = query.filter(Ledger.active == "Y")
        if search:
            query = query.filter(Ledger.name.ilike(f"%{search}%"))
        if category:
            query = query.filter(Ledger.category == category)
        ledgers = query.order_by(Ledger.name).offset(skip).limit(limit).all()
        data = [LedgerService._to_dict(l) for l in ledgers]
        return (data, Status.SUCCESS, "Ledgers fetched successfully")

    @staticmethod
    def get_by_id(
        db: Session, ledger_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        ledger = db.query(Ledger).filter(Ledger.id == ledger_id).first()
        if not ledger:
            return (None, Status.ERROR, "Ledger not found")
        return (
            LedgerService._to_dict(ledger),
            Status.SUCCESS,
            "Ledger details fetched successfully",
        )

    @staticmethod
    def validate(
        db: Session,
        name: Optional[str],
        gstin: Optional[str],
        exclude_id: Optional[UUID] = None,
        company_id: Optional[UUID] = None,
        ledger_group_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        """Realtime duplicate + GST + mandatory validations for inline UX."""
        out: Dict[str, Any] = {"name": None, "gstin": None, "suggest_group": None}
        if name is not None:
            q = db.query(Ledger).filter(
                sa_func.lower(Ledger.name) == name.strip().lower(),
                Ledger.active == "Y",
            )
            if company_id is not None:
                q = q.filter(Ledger.company_id == company_id)
            if exclude_id:
                q = q.filter(Ledger.id != exclude_id)
            if ledger_group_id:
                q = q.filter(Ledger.ledger_group_id == ledger_group_id)
            dup = q.first()
            if not name.strip():
                out["name"] = {"level": "error", "message": "Ledger name is required"}
            elif dup:
                out["name"] = {
                    "level": "error",
                    "message": f"A ledger named '{dup.name}' already exists in this group",
                    "duplicate_id": str(dup.id),
                }
            else:
                out["name"] = {"level": "ok", "message": "Name is available"}
        if gstin:
            out["gstin"] = GstService.validate_gstin(gstin)
        return out

    @staticmethod
    def suggest_group(
        db: Session, category: Optional[str], name: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        """Auto-suggest a ledger group from the category (and name keywords)."""
        target_code = CATEGORY_CODE_MAP.get((category or "").lower())
        if not target_code and name:
            lname = name.lower()
            if "bank" in lname:
                target_code = "BANK_ACCOUNTS"
            elif "cash" in lname:
                target_code = "CASH_IN_HAND"
            elif "gst" in lname or "tax" in lname:
                target_code = "DUTIES_TAXES"
            elif "sale" in lname:
                target_code = "SALES_ACCOUNTS"
        if not target_code:
            return None
        grp = (
            db.query(LedgerGroup)
            .filter(LedgerGroup.code == target_code, LedgerGroup.active == "Y")
            .first()
        )
        if not grp:
            return None
        return {"id": str(grp.id), "name": grp.name, "balance_type": grp.balance_type}

    @staticmethod
    def create(
        db: Session, ledger: LedgerCreate, company_id: Optional[UUID] = None
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        q = db.query(Ledger).filter(
            sa_func.lower(Ledger.name) == (ledger.name or "").strip().lower(),
            Ledger.active == "Y",
        )
        if company_id is not None:
            q = q.filter(Ledger.company_id == company_id)
        if ledger.ledger_group_id is not None:
            q = q.filter(Ledger.ledger_group_id == ledger.ledger_group_id)
        dup = q.first()
        if dup:
            return (None, Status.ERROR, "Ledger name must be unique in this group")
        data = ledger.model_dump(exclude_unset=True)
        if company_id is not None:
            data["company_id"] = company_id
        db_ledger = Ledger(**data)
        db.add(db_ledger)
        db.commit()
        db.refresh(db_ledger)
        return (
            LedgerService._to_dict(db_ledger),
            Status.SUCCESS,
            "Ledger created successfully",
        )

    @staticmethod
    def bulk_create(
        db: Session, body: LedgerBulkRequest, company_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """Create many ledgers at once under one sub-category (bulk entry grid).

        Every row shares the same ledger_group_id and optional opening date.
        Rows are validated per-entry (required name + duplicate checks) and
        only valid rows are committed; errors are collected per row so the UI
        can highlight exactly which entries failed.
        """
        group = (
            db.query(LedgerGroup)
            .filter(
                LedgerGroup.id == body.ledger_group_id,
                LedgerGroup.active == "Y",
            )
            .first()
        )
        if not group:
            return {
                "created": 0,
                "failed": 0,
                "errors": [{"row": 0, "message": "Selected sub-category not found"}],
            }

        default_bt = group.balance_type
        created = 0
        errors: List[Dict[str, Any]] = []
        seen: set[str] = set()

        for idx, item in enumerate(body.items, start=1):
            name = (item.name or "").strip()
            if not name:
                errors.append(
                    {"row": idx, "name": "", "message": "Ledger name is required"}
                )
                continue

            lower = name.lower()
            if lower in seen:
                errors.append(
                    {
                        "row": idx,
                        "name": name,
                        "message": f"Duplicate ledger name '{name}' within this batch",
                    }
                )
                continue
            seen.add(lower)

            q = db.query(Ledger).filter(
                sa_func.lower(Ledger.name) == lower, Ledger.active == "Y"
            )
            if company_id is not None:
                q = q.filter(Ledger.company_id == company_id)
            if q.first():
                errors.append(
                    {
                        "row": idx,
                        "name": name,
                        "message": f"A ledger named '{name}' already exists",
                    }
                )
                continue

            db.add(
                Ledger(
                    name=name,
                    ledger_group_id=body.ledger_group_id,
                    balance_type=item.balance_type or default_bt or None,
                    opening_balance=item.opening_balance
                    if item.opening_balance is not None
                    else 0,
                    opening_balance_date=body.opening_balance_date,
                    company_id=company_id,
                    active="Y",
                )
            )
            created += 1

        db.commit()
        return {"created": created, "failed": len(errors), "errors": errors}

    @staticmethod
    def quick_create(
        db: Session, data: LedgerQuickCreate, company_id: Optional[UUID] = None
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        """Minimal creation from the voucher screen (name + category)."""
        group_id = data.ledger_group_id
        balance_type = None
        if not group_id:
            suggestion = LedgerService.suggest_group(db, data.category, data.name)
            if suggestion:
                group_id = UUID(suggestion["id"])
                balance_type = suggestion["balance_type"]
        payload = LedgerCreate(
            name=data.name,
            category=data.category,
            ledger_group_id=group_id,
            balance_type=balance_type,
            active="Y",
        )
        return LedgerService.create(db, payload, company_id=company_id)

    @staticmethod
    def update(
        db: Session, ledger_id: UUID, ledger: LedgerUpdate
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        db_ledger = db.query(Ledger).filter(Ledger.id == ledger_id).first()
        if not db_ledger:
            return (None, Status.ERROR, "Ledger not found")
        if db_ledger.is_frozen == "Y":
            return (None, Status.ERROR, "Ledger is frozen for audit; unfreeze it first")

        for key, value in ledger.model_dump(exclude_unset=True).items():
            setattr(db_ledger, key, value)

        db.commit()
        db.refresh(db_ledger)
        return (
            LedgerService._to_dict(db_ledger),
            Status.SUCCESS,
            "Ledger updated successfully",
        )

    @staticmethod
    def update_active(
        db: Session, ledger_id: UUID, active: str
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if active not in ["Y", "N"]:
            return (None, Status.ERROR, "Invalid active value. Use 'Y' or 'N'")

        db_ledger = db.query(Ledger).filter(Ledger.id == ledger_id).first()
        if not db_ledger:
            return (None, Status.ERROR, "Ledger not found")

        db_ledger.active = active
        db.commit()
        db.refresh(db_ledger)
        return (
            LedgerService._to_dict(db_ledger),
            Status.SUCCESS,
            "Status updated successfully",
        )

    @staticmethod
    def set_frozen(
        db: Session, ledger_id: UUID, frozen: str
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        """Freeze/block a ledger for audit-locked periods (or unfreeze it)."""
        if frozen not in ("Y", "N"):
            return (None, Status.ERROR, "Invalid value. Use 'Y' or 'N'")
        db_ledger = db.query(Ledger).filter(Ledger.id == ledger_id).first()
        if not db_ledger:
            return (None, Status.ERROR, "Ledger not found")
        db_ledger.is_frozen = frozen
        db.commit()
        db.refresh(db_ledger)
        msg = "Ledger frozen for audit" if frozen == "Y" else "Ledger unfrozen"
        return (LedgerService._to_dict(db_ledger), Status.SUCCESS, msg)

    @staticmethod
    def delete(db: Session, ledger_id: UUID) -> Tuple[bool, str, str]:
        db_ledger = db.query(Ledger).filter(Ledger.id == ledger_id).first()
        if not db_ledger:
            return (False, Status.ERROR, "Ledger not found")
        # Integrity rule: ledgers referenced by vouchers are never hard-deleted;
        # soft delete keeps history intact.
        db_ledger.active = "N"
        db.commit()
        return (True, Status.SUCCESS, "Ledger removed successfully")

    @staticmethod
    def merge(
        db: Session, source_id: UUID, target_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        """Merge duplicate ledgers: repoint voucher lines then deactivate source."""
        if source_id == target_id:
            return (None, Status.ERROR, "Source and target must differ")
        src = db.query(Ledger).filter(Ledger.id == source_id).first()
        tgt = db.query(Ledger).filter(Ledger.id == target_id).first()
        if not src or not tgt:
            return (None, Status.ERROR, "Ledger not found")
        moved = (
            db.query(VoucherDetail)
            .filter(VoucherDetail.ledger_id == source_id)
            .update({"ledger_id": target_id})
        )
        src.active = "N"
        src.description = (
            (src.description or "") + f" [merged into {tgt.name}]"
        ).strip()

        # Explicit merge audit entry (in addition to the auto-captured update).
        import json as _json
        import uuid as _uuid
        import datetime as _dt
        from app.core.audit import current_actor
        from app.models.audit_log import AuditLog

        db.add(
            AuditLog(
                id=_uuid.uuid4(),
                entity="ledger",
                entity_id=str(source_id),
                entity_name=src.name[:100] if src.name else "",
                action="MERGE",
                changes=_json.dumps(
                    {
                        "merged_into": {"old": None, "new": tgt.name},
                        "target_id": {"old": None, "new": str(target_id)},
                        "moved_lines": {"old": None, "new": moved},
                    }
                ),
                actor=str(current_actor.get()) if current_actor.get() else None,
                created_date=_dt.datetime.utcnow(),
            )
        )
        db.commit()
        return (
            {"moved_lines": moved, "target": LedgerService._to_dict(tgt)},
            Status.SUCCESS,
            f"Merged '{src.name}' into '{tgt.name}' ({moved} voucher lines repointed)",
        )
