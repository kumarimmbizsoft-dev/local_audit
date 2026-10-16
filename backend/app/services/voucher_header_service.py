from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.voucher_header import VoucherHeader
from app.models.voucher_detail import VoucherDetail
from app.models.ledger import Ledger
from app.models.ledger_group import LedgerGroup
from app.models.voucher_sequence import VoucherSequence
from app.models.system_setting import SystemSetting
from app.models.voucher_type import VoucherType
from app.models.user_master import UserMaster
from app.schemas.voucher_header import VoucherHeaderCreate, VoucherHeaderUpdate
from app.schemas.response import Status
from app.services.voucher_type_service import VoucherTypeService
from typing import List, Optional, Tuple, Any, Dict
from uuid import UUID
from decimal import Decimal
from datetime import date

PERIOD_LOCK_SETTING = "BOOKS_LOCKED_UPTO"

# Default numbering prefixes when a sequence row is auto-created on first use.
VOUCHER_PREFIXES = {
    "JOURNAL": "JV",
    "SALES": "SV",
    "PURCHASE": "PV",
    "RECEIPT": "RV",
    "PAYMENT": "PMT",
    "CONTRA": "CV",
    "DEBIT_NOTE": "DN",
    "CREDIT_NOTE": "CN",
}


class VoucherHeaderService:
    @staticmethod
    def _invalidate_dashboard_cache(company_id: Optional[UUID]) -> None:
        # Imported lazily to keep the voucher service independent of dashboard
        # query implementation details at application startup.
        from app.services.dashboard_service import DashboardService

        DashboardService.invalidate_cache(company_id)

    @staticmethod
    def _compute_and_validate_totals(details) -> Tuple[Decimal, Decimal]:
        if not details or len(details) < 2:
            raise ValueError("At least two voucher lines are required")

        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for line in details:
            debit = Decimal(str(line.debit_amount or 0))
            credit = Decimal(str(line.credit_amount or 0))
            if debit < 0 or credit < 0:
                raise ValueError("Amounts cannot be negative")
            if debit > 0 and credit > 0:
                raise ValueError(
                    f"Line {line.line_no}: a line cannot have both debit and credit"
                )
            if debit == 0 and credit == 0:
                raise ValueError(
                    f"Line {line.line_no}: enter a debit or a credit amount"
                )
            total_debit += debit
            total_credit += credit

        if total_debit != total_credit:
            raise ValueError(
                f"Voucher is not balanced: total debit {total_debit} does not "
                f"equal total credit {total_credit}"
            )
        if total_debit == 0:
            raise ValueError("Voucher total cannot be zero")
        return total_debit, total_credit

    @staticmethod
    def _validate_ledgers(
        db: Session, details, company_id: Optional[UUID]
    ) -> None:
        if company_id is None:
            raise ValueError("Select a company before entering voucher lines")
        ledger_ids = [line.ledger_id for line in details]
        if len(set(ledger_ids)) != len(ledger_ids):
            raise ValueError("The same ledger cannot be repeated in a voucher")

        active_ids = {
            row[0]
            for row in db.query(Ledger.id)
            .filter(
                Ledger.id.in_(ledger_ids),
                Ledger.company_id == company_id,
                Ledger.active == "Y",
            )
            .all()
        }
        if active_ids != set(ledger_ids):
            raise ValueError(
                "Every selected ledger must be active and belong to the selected company"
            )

    @staticmethod
    def _has_ancestor_group_code(
        db: Session, group_id: Optional[UUID], target_code: str, group_map: Optional[Dict[Any, LedgerGroup]] = None
    ) -> bool:
        if not group_id:
            return False
        cur_id = group_id
        seen = set()
        while cur_id and cur_id not in seen:
            seen.add(cur_id)
            if group_map is not None:
                group = group_map.get(cur_id)
            else:
                group = db.query(LedgerGroup).filter(LedgerGroup.id == cur_id).first()
            if not group:
                break
            if group.code == target_code:
                return True
            cur_id = group.parent_id
        return False

    @staticmethod
    def _ledger_matches_rule(
        db: Session,
        group_id: Optional[UUID],
        base_voucher_type: str,
        side: str,
        category: str,
        group_path: str,
        balance_type: str,
        is_bank: str,
        is_cash: str,
        ledger_name: str,
        custom_type_name: Optional[str] = None,
        group_map: Optional[Dict[Any, LedgerGroup]] = None,
    ) -> bool:
        base = base_voucher_type.upper()
        entry_side = side.upper()
        category = (category or "").lower()
        path = (group_path or "").lower()
        balance = (balance_type or "").upper()
        name = (ledger_name or "").lower()
        c_name = (custom_type_name or "").lower()

        cash_bank = (
            is_bank == "Y"
            or is_cash == "Y"
            or category in {"bank", "cash"}
            or VoucherHeaderService._has_ancestor_group_code(db, group_id, "BANK_ACCOUNTS", group_map)
            or VoucherHeaderService._has_ancestor_group_code(db, group_id, "CASH_IN_HAND", group_map)
        )
        debtor = category == "customer" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "SUNDRY_DEBTORS", group_map)
        creditor = category == "vendor" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "SUNDRY_CREDITORS", group_map)
        sales = category == "income" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "SALES_ACCOUNTS", group_map)
        purchase = category == "expense" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "PURCHASE_ACCOUNTS", group_map)
        income = category == "income" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "INCOME", group_map)
        expense = category == "expense" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "EXPENSES", group_map)
        liability = VoucherHeaderService._has_ancestor_group_code(db, group_id, "LIABILITIES", group_map)
        tax = category == "tax" or VoucherHeaderService._has_ancestor_group_code(db, group_id, "DUTIES_TAXES", group_map)
        output_tax = tax and (balance == "CR" or "output" in name)
        input_tax = tax and (balance == "DR" or "input" in name)

        if base == "SALES":
            if "cash" in c_name:
                return cash_bank if entry_side == "DEBIT" else (sales or output_tax or tax or income)
            if "credit" in c_name:
                return debtor if entry_side == "DEBIT" else (sales or output_tax or tax or income)
            return (debtor or cash_bank) if entry_side == "DEBIT" else (sales or output_tax or tax or income)

        if base == "PURCHASE":
            if "cash" in c_name:
                return (purchase or input_tax or tax or expense) if entry_side == "DEBIT" else cash_bank
            if "credit" in c_name:
                return (purchase or input_tax or tax or expense) if entry_side == "DEBIT" else creditor
            return (purchase or input_tax or tax or expense) if entry_side == "DEBIT" else (creditor or cash_bank)

        if base == "RECEIPT":
            return cash_bank if entry_side == "DEBIT" else (debtor or income or sales or liability or True)

        if base == "PAYMENT":
            return (expense or creditor or purchase or liability or True) if entry_side == "DEBIT" else cash_bank

        if base == "CONTRA":
            return cash_bank

        if base == "JOURNAL":
            return True

        if base in ("DEBIT_NOTE", "CREDIT_NOTE"):
            return True

        return True

    @staticmethod
    def get_account_ledger_options(
        db: Session,
        voucher_type_id: UUID,
        company_id: Optional[UUID],
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if company_id is None:
            return (None, Status.ERROR, "Select a company to load ledger options")
        selected_type = VoucherTypeService.resolve_active(
            db, voucher_type_id, company_id
        )
        if selected_type is None:
            return (None, Status.ERROR, "Select a valid active Voucher Type")

        rows = (
            db.query(
                Ledger.id,
                Ledger.name,
                Ledger.category,
                Ledger.balance_type,
                Ledger.is_bank,
                Ledger.is_cash,
                LedgerGroup.name.label("group_name"),
                LedgerGroup.hierarchy_path,
                Ledger.ledger_group_id,
            )
            .outerjoin(LedgerGroup, LedgerGroup.id == Ledger.ledger_group_id)
            .filter(
                Ledger.company_id == company_id,
                Ledger.active == "Y",
            )
            .order_by(Ledger.name)
            .all()
        )
        all_groups = db.query(LedgerGroup).filter(LedgerGroup.active == "Y").all()
        group_map = {g.id: g for g in all_groups}
        base_voucher_type = str(selected_type.base_voucher_type)
        custom_type_name = str(selected_type.name)
        options = {"DEBIT": [], "CREDIT": []}
        for lid, lname, lcat, lbal, is_b, is_c, grp_name, grp_path, lg_id in rows:
            group_path = str(grp_path or grp_name or "")
            item = {
                "id": str(lid),
                "name": lname,
                "category": lcat,
                "balanceType": lbal,
                "groupName": grp_name,
                "groupPath": group_path or None,
            }
            # Allow any active ledger on both DEBIT and CREDIT
            options["DEBIT"].append(item)
            options["CREDIT"].append(item)

        return (
            {
                "voucherTypeId": str(selected_type.id),
                "voucherTypeName": selected_type.name,
                "baseVoucherType": base_voucher_type,
                "debit": options["DEBIT"],
                "credit": options["CREDIT"],
            },
            Status.SUCCESS,
            "Accounting ledger options fetched successfully",
        )

    @staticmethod
    def _assert_period_open(db: Session, voucher_date) -> None:
        if not voucher_date:
            return
        setting = (
            db.query(SystemSetting)
            .filter(SystemSetting.key_name == PERIOD_LOCK_SETTING)
            .first()
        )
        if not setting or not setting.key_value:
            return
        try:
            locked_upto = date.fromisoformat(str(setting.key_value)[:10])
        except ValueError:
            return
        if voucher_date <= locked_upto:
            raise ValueError(
                f"Accounting period is locked up to {locked_upto.isoformat()}; "
                "choose a later date or unlock the period in System Settings"
            )

    @staticmethod
    def _generate_voucher_no(
        db: Session, voucher_type: str, company_id: Optional[UUID] = None
    ) -> str:
        q = db.query(VoucherSequence).filter(
            VoucherSequence.voucher_type == voucher_type,
            VoucherSequence.active == "Y",
        )
        if company_id is not None:
            q = q.filter(VoucherSequence.company_id == company_id)
        sequence = q.with_for_update().first()
        if not sequence:
            # Auto-provision a sequence the first time a voucher type is used for this company
            prefix = VOUCHER_PREFIXES.get(
                voucher_type, (voucher_type[:2].upper() if voucher_type else "VC")
            )
            sequence = VoucherSequence(
                company_id=company_id,
                voucher_type=voucher_type,
                prefix=prefix,
                last_number=0,
                number_width=4,
                active="Y",
            )
            db.add(sequence)
            db.flush()

        sequence.last_number = (sequence.last_number or 0) + 1
        width = sequence.number_width or 4
        voucher_no = f"{sequence.prefix}{str(sequence.last_number).zfill(width)}"
        db.flush()
        return voucher_no

    @staticmethod
    def _to_dict(header: VoucherHeader) -> Dict[str, Any]:
        display_voucher_type = (
            header.voucher_type_name
            if header.voucher_type_name is not None
            else header.voucher_type
        )
        return {
            "id": str(header.id),
            "voucherNo": header.voucher_no,
            "voucherType": display_voucher_type,
            "voucherTypeId": str(header.voucher_type_id)
            if header.voucher_type_id is not None
            else None,
            "voucherTypeName": display_voucher_type,
            "baseVoucherType": header.voucher_type,
            "voucherDate": header.voucher_date.isoformat()
            if header.voucher_date
            else None,
            "dueDate": header.due_date.isoformat()
            if getattr(header, "due_date", None)
            else None,
            "referenceNo": header.reference_no,
            "referenceDate": header.reference_date.isoformat()
            if getattr(header, "reference_date", None)
            else None,
            "narration": header.narration,
            "voucherStatus": header.voucher_status,
            "totalDebit": float(header.total_debit) if header.total_debit else None,
            "totalCredit": float(header.total_credit) if header.total_credit else None,
            "source_document_type": header.source_document_type,
            "source_document_id": str(header.source_document_id) if header.source_document_id is not None else None,
            "active": header.active,
            "createdBy": header.created_by,
            "modifiedBy": header.modified_by,
            "createdDate": header.created_date.isoformat()
            if header.created_date
            else None,
            "modifiedDate": header.modified_date.isoformat()
            if header.modified_date
            else None,
            "details": [
                VoucherHeaderService._detail_to_dict(d) for d in header.details
            ],
        }

    @staticmethod
    def _detail_to_dict(detail: VoucherDetail) -> Dict[str, Any]:
        return {
            "id": str(detail.id),
            "voucherId": str(detail.voucher_id) if detail.voucher_id else None,
            "lineNo": detail.line_no,
            "ledgerId": str(detail.ledger_id) if detail.ledger_id else None,
            "ledgerName": detail.ledger.name if detail.ledger is not None else None,
            "costCenterId": str(detail.cost_center_id) if detail.cost_center_id else None,
            "debitAmount": float(detail.debit_amount) if detail.debit_amount else None,
            "creditAmount": float(detail.credit_amount)
            if detail.credit_amount
            else None,
            "remarks": detail.remarks,
            "active": detail.active,
            "createdBy": detail.created_by,
            "modifiedBy": detail.modified_by,
            "createdDate": detail.created_date.isoformat()
            if detail.created_date
            else None,
            "modifiedDate": detail.modified_date.isoformat()
            if detail.modified_date
            else None,
        }

    @staticmethod
    def get_all(
        db: Session,
        voucher_type: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
        company_id: Optional[UUID] = None,
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        if company_id is None:
            return ([], Status.SUCCESS, "No company selected")
        q = db.query(VoucherHeader).filter(VoucherHeader.company_id == company_id, VoucherHeader.active == "Y")
        if voucher_type:
            q = q.filter(VoucherHeader.voucher_type == voucher_type.upper())
        headers = (
            q.order_by(VoucherHeader.created_date.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        data = [VoucherHeaderService._to_dict(h) for h in headers]
        return (data, Status.SUCCESS, "Vouchers fetched successfully")

    @staticmethod
    def get_ledger_transactions(
        db: Session, ledger_id: UUID, company_id: Optional[UUID] = None
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        query = (
            db.query(VoucherDetail, VoucherHeader)
            .join(VoucherHeader, VoucherHeader.id == VoucherDetail.voucher_id)
            .filter(
                VoucherDetail.ledger_id == ledger_id,
                VoucherDetail.active == "Y",
                VoucherHeader.active == "Y",
                VoucherHeader.voucher_status == "POSTED",
            )
        )
        if company_id is not None:
            query = query.filter(VoucherHeader.company_id == company_id)
        results = query.order_by(
            VoucherHeader.voucher_date.desc(), VoucherHeader.voucher_no
        ).all()
        data = []
        for detail, header in results:
            data.append(
                {
                    "voucherNo": header.voucher_no,
                    "voucherDate": header.voucher_date.isoformat()
                    if header.voucher_date
                    else None,
                    "voucherType": header.voucher_type_name
                    if header.voucher_type_name is not None
                    else header.voucher_type,
                    "baseVoucherType": header.voucher_type,
                    "debitAmount": float(detail.debit_amount)
                    if detail.debit_amount
                    else 0,
                    "creditAmount": float(detail.credit_amount)
                    if detail.credit_amount
                    else 0,
                    "voucherStatus": header.voucher_status,
                }
            )
        return (data, Status.SUCCESS, "Transactions fetched successfully")

    @staticmethod
    def get_by_id(
        db: Session, id: UUID, company_id: Optional[UUID] = None
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        query = db.query(VoucherHeader).filter(
            VoucherHeader.id == id, VoucherHeader.active == "Y"
        )
        if company_id is not None:
            query = query.filter(VoucherHeader.company_id == company_id)
        header = query.first()
        if not header:
            return (None, Status.ERROR, "Voucher not found")
        return (
            VoucherHeaderService._to_dict(header),
            Status.SUCCESS,
            "Voucher details fetched successfully",
        )

    @staticmethod
    def create(
        db: Session,
        data: VoucherHeaderCreate,
        voucher_type: Optional[str],
        actor: Optional[str] = None,
        company_id: Optional[UUID] = None,
        voucher_type_id: Optional[UUID] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        try:
            if company_id is None:
                raise ValueError("Select a company before creating a voucher")
            selected_type: Optional[VoucherType]
            target_type_id = voucher_type_id or data.voucher_type_id
            if target_type_id is not None:
                selected_type = VoucherTypeService.resolve_active(
                    db, target_type_id, company_id
                )
            elif voucher_type:
                selected_type = VoucherTypeService.resolve_active_for_base(
                    db, voucher_type, company_id
                )
            else:
                selected_type = None
            if selected_type is None:
                raise ValueError("Select a valid active Voucher Type")

            base_voucher_type = str(selected_type.base_voucher_type)
            if voucher_type and voucher_type.strip().upper() != base_voucher_type:
                raise ValueError(
                    "Selected Voucher Type does not match the transaction category"
                )
            VoucherHeaderService._assert_period_open(db, data.voucher_date)
            total_debit, total_credit = (
                VoucherHeaderService._compute_and_validate_totals(data.details)
            )
            VoucherHeaderService._validate_ledgers(db, data.details, company_id)
            # Use custom voucher type name if user-created, otherwise base type
            seq_key = (
                str(selected_type.name)
                if selected_type and str(getattr(selected_type, "is_system", "Y")) == "N"
                else base_voucher_type
            )
            voucher_no = VoucherHeaderService._generate_voucher_no(
                db, seq_key, company_id=company_id
            )
        except ValueError as e:
            db.rollback()
            return (None, Status.ERROR, str(e))

        db_header = VoucherHeader(
            company_id=company_id,
            voucher_no=voucher_no,
            voucher_type=base_voucher_type,
            voucher_type_id=selected_type.id,
            voucher_type_name=str(selected_type.name),
            voucher_date=data.voucher_date,
            due_date=data.due_date,
            reference_no=data.reference_no,
            reference_date=data.reference_date,
            narration=data.narration,
            voucher_status="DRAFT",
            total_debit=total_debit,
            total_credit=total_credit,
            active="Y",
            created_by=actor,
            source_document_type=data.source_document_type,
            source_document_id=data.source_document_id,
        )
        db.add(db_header)
        db.flush()

        for line in data.details:
            db_detail = VoucherDetail(
                voucher_id=db_header.id,
                line_no=line.line_no,
                ledger_id=line.ledger_id,
                cost_center_id=line.cost_center_id,
                debit_amount=line.debit_amount,
                credit_amount=line.credit_amount,
                remarks=line.remarks,
                active="Y",
                created_by=actor,
            )
            db.add(db_detail)

        db.commit()
        VoucherHeaderService._invalidate_dashboard_cache(company_id)
        db.refresh(db_header)
        return (
            VoucherHeaderService._to_dict(db_header),
            Status.SUCCESS,
            "Voucher created successfully",
        )

    @staticmethod
    def update(
        db: Session,
        id: UUID,
        data: VoucherHeaderUpdate,
        actor: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        query = db.query(VoucherHeader).filter(
            VoucherHeader.id == id, VoucherHeader.active == "Y"
        )
        if company_id is not None:
            query = query.filter(VoucherHeader.company_id == company_id)
        db_header = query.first()
        if not db_header:
            return (None, Status.ERROR, "Voucher not found")
        if db_header.voucher_status == "CANCELLED":
            return (None, Status.ERROR, "CANCELLED vouchers cannot be edited")

        new_date = data.voucher_date if data.voucher_date is not None else db_header.voucher_date
        new_due_date = data.due_date if "due_date" in data.model_fields_set else db_header.due_date
        try:
            VoucherHeaderService._assert_period_open(db, new_date)
            if new_due_date and new_date and new_due_date < new_date:
                raise ValueError("Due date cannot be earlier than voucher date")
            if "voucher_type_id" in data.model_fields_set and data.voucher_type_id is not None:
                if company_id is None:
                    raise ValueError("Select a company to update voucher")
                new_type = VoucherTypeService.resolve_active(
                    db, data.voucher_type_id, company_id
                )
                if not new_type:
                    raise ValueError("Selected Voucher Type is invalid or inactive")
                if str(new_type.base_voucher_type) != str(db_header.voucher_type):
                    raise ValueError(
                        "Selected Voucher Type does not match the transaction base category"
                    )
                db_header.voucher_type_id = new_type.id
                db_header.voucher_type_name = str(new_type.name)

            if data.details is not None:
                total_debit, total_credit = (
                    VoucherHeaderService._compute_and_validate_totals(data.details)
                )
                VoucherHeaderService._validate_ledgers(
                    db, data.details, company_id
                )
        except ValueError as e:
            db.rollback()
            return (None, Status.ERROR, str(e))

        for field in ["voucher_date", "due_date", "reference_no", "reference_date", "narration", "source_document_type", "source_document_id"]:
            if field in data.model_fields_set:
                setattr(db_header, field, getattr(data, field))
        db_header.modified_by = actor

        if data.details is not None:
            db_header.total_debit = total_debit
            db_header.total_credit = total_credit
            db.query(VoucherDetail).filter(
                VoucherDetail.voucher_id == db_header.id
            ).delete()
            db.flush()
            for line in data.details:
                db_detail = VoucherDetail(
                    voucher_id=db_header.id,
                    line_no=line.line_no,
                    ledger_id=line.ledger_id,
                    cost_center_id=line.cost_center_id,
                    debit_amount=line.debit_amount,
                    credit_amount=line.credit_amount,
                    remarks=line.remarks,
                    active="Y",
                    created_by=db_header.created_by,
                    modified_by=actor,
                )
                db.add(db_detail)

        db.commit()
        VoucherHeaderService._invalidate_dashboard_cache(db_header.company_id)
        db.refresh(db_header)
        return (
            VoucherHeaderService._to_dict(db_header),
            Status.SUCCESS,
            "Voucher updated successfully",
        )

    @staticmethod
    def post_voucher(
        db: Session,
        id: UUID,
        actor: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        query = db.query(VoucherHeader).filter(
            VoucherHeader.id == id, VoucherHeader.active == "Y"
        )
        if company_id is not None:
            query = query.filter(VoucherHeader.company_id == company_id)
        db_header = query.first()
        if not db_header:
            return (None, Status.ERROR, "Voucher not found")
        if db_header.voucher_status != "DRAFT":
            return (None, Status.ERROR, "Only DRAFT vouchers can be posted")

        # Check entitlement limitations (Trial/Demo limits, max 1,000 vouchers, 30 days expiry)
        from app.services.entitlement_service import EntitlementService
        try:
            actor_user = None
            if actor:
                try:
                    actor_user = db.query(UserMaster).filter(UserMaster.id == actor).first()
                except Exception:
                    pass
            EntitlementService.assert_voucher_posting_allowed(
                db, user=actor_user, company_id=db_header.company_id
            )
        except HTTPException as e:
            return (None, Status.ERROR, e.detail)

        details = (
            db.query(VoucherDetail)
            .filter(
                VoucherDetail.voucher_id == db_header.id,
                VoucherDetail.active == "Y",
            )
            .all()
        )
        try:
            VoucherHeaderService._assert_period_open(db, db_header.voucher_date)
            total_debit, total_credit = (
                VoucherHeaderService._compute_and_validate_totals(details)
            )
            VoucherHeaderService._validate_ledgers(
                db, details, db_header.company_id
            )
        except ValueError as e:
            return (None, Status.ERROR, str(e))

        db_header.total_debit = total_debit
        db_header.total_credit = total_credit
        db_header.voucher_status = "POSTED"
        db_header.modified_by = actor
        db.commit()
        VoucherHeaderService._invalidate_dashboard_cache(db_header.company_id)
        db.refresh(db_header)
        return (
            VoucherHeaderService._to_dict(db_header),
            Status.SUCCESS,
            "Voucher posted successfully",
        )

    @staticmethod
    def cancel_voucher(
        db: Session,
        id: UUID,
        actor: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        query = db.query(VoucherHeader).filter(
            VoucherHeader.id == id, VoucherHeader.active == "Y"
        )
        if company_id is not None:
            query = query.filter(VoucherHeader.company_id == company_id)
        db_header = query.first()
        if not db_header:
            return (None, Status.ERROR, "Voucher not found")
        if db_header.voucher_status == "CANCELLED":
            return (None, Status.ERROR, "Voucher is already cancelled")

        try:
            VoucherHeaderService._assert_period_open(db, db_header.voucher_date)
        except ValueError as e:
            return (None, Status.ERROR, str(e))

        db_header.voucher_status = "CANCELLED"
        db_header.modified_by = actor
        db.commit()
        VoucherHeaderService._invalidate_dashboard_cache(db_header.company_id)
        db.refresh(db_header)
        return (
            VoucherHeaderService._to_dict(db_header),
            Status.SUCCESS,
            "Voucher cancelled successfully",
        )

    @staticmethod
    def delete_voucher(
        db: Session,
        id: UUID,
        actor: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        query = db.query(VoucherHeader).filter(
            VoucherHeader.id == id, VoucherHeader.active == "Y"
        )
        if company_id is not None:
            query = query.filter(VoucherHeader.company_id == company_id)
        db_header = query.first()
        if not db_header:
            return (None, Status.ERROR, "Voucher not found")

        try:
            VoucherHeaderService._assert_period_open(db, db_header.voucher_date)
        except ValueError as error:
            return (None, Status.ERROR, str(error))

        setattr(db_header, "active", "N")
        setattr(db_header, "modified_by", actor)
        db.commit()
        VoucherHeaderService._invalidate_dashboard_cache(db_header.company_id)
        db.refresh(db_header)
        return (
            VoucherHeaderService._to_dict(db_header),
            Status.SUCCESS,
            "Voucher deleted successfully",
        )

    @staticmethod
    def get_purchase_bills(
        db: Session,
        company_id: UUID
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        bills = (
            db.query(VoucherHeader)
            .filter(
                VoucherHeader.company_id == company_id,
                VoucherHeader.voucher_type == "PURCHASE",
                VoucherHeader.voucher_status == "POSTED",
                VoucherHeader.active == "Y",
            )
            .order_by(VoucherHeader.voucher_date.desc(), VoucherHeader.voucher_no.desc())
            .all()
        )
        
        result = []
        for bill in bills:
            supplier_detail = None
            for detail in bill.details:
                if detail.active == "Y" and detail.credit_amount and detail.credit_amount > 0:
                    if detail.ledger and detail.ledger.name.lower() != "round off":
                        supplier_detail = detail
                        break
            
            if not supplier_detail:
                continue
                
            bill_total = supplier_detail.credit_amount
            
            previously_paid = db.query(func.coalesce(func.sum(VoucherHeader.total_debit), 0))\
                .filter(
                    VoucherHeader.source_document_type == "PURCHASE",
                    VoucherHeader.source_document_id == bill.id,
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y"
                ).scalar()
            
            result.append({
                "id": str(bill.id),
                "voucher_no": bill.voucher_no,
                "voucher_date": bill.voucher_date.isoformat() if bill.voucher_date else None,
                "reference_no": bill.reference_no,
                "supplier_ledger_id": str(supplier_detail.ledger_id),
                "supplier_name": supplier_detail.ledger.name,
                "bill_total": float(bill_total),
                "previously_paid": float(previously_paid),
                "balance_due": float(bill_total - previously_paid)
            })
            
        return (result, Status.SUCCESS, "Purchase bills fetched successfully")

    @staticmethod
    def get_sales_invoices(
        db: Session,
        company_id: UUID
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        invoices = (
            db.query(VoucherHeader)
            .filter(
                VoucherHeader.company_id == company_id,
                VoucherHeader.voucher_type == "SALES",
                VoucherHeader.voucher_status == "POSTED",
                VoucherHeader.active == "Y",
            )
            .order_by(VoucherHeader.voucher_date.desc(), VoucherHeader.voucher_no.desc())
            .all()
        )
        
        result = []
        for inv in invoices:
            customer_detail = None
            for detail in inv.details:
                if detail.active == "Y" and detail.debit_amount and detail.debit_amount > 0:
                    if detail.ledger and detail.ledger.name.lower() != "round off":
                        customer_detail = detail
                        break
            
            if not customer_detail:
                continue
                
            invoice_total = customer_detail.debit_amount
            
            previously_received = db.query(func.coalesce(func.sum(VoucherHeader.total_debit), 0))\
                .filter(
                    VoucherHeader.source_document_type == "SALES",
                    VoucherHeader.source_document_id == inv.id,
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y"
                ).scalar()
            
            result.append({
                "id": str(inv.id),
                "voucher_no": inv.voucher_no,
                "voucher_date": inv.voucher_date.isoformat() if inv.voucher_date else None,
                "reference_no": inv.reference_no,
                "customer_ledger_id": str(customer_detail.ledger_id),
                "customer_name": customer_detail.ledger.name,
                "invoice_total": float(invoice_total),
                "previously_received": float(previously_received),
                "balance_due": float(invoice_total - previously_received)
            })
            
        return (result, Status.SUCCESS, "Sales invoices fetched successfully")
