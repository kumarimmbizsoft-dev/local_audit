from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.lov import Lov
from app.models.voucher_header import VoucherHeader
from app.models.voucher_sequence import VoucherSequence
from app.models.voucher_type import VoucherType
from app.schemas.response import Status
from app.schemas.voucher_type import VoucherTypeCreate, VoucherTypeUpdate

BASE_VOUCHER_TYPE_GROUP = "VOUCHER_BASE_TYPE"


class VoucherTypeService:
    @staticmethod
    def _to_dict(voucher_type: VoucherType) -> Dict[str, Any]:
        return {
            "id": str(voucher_type.id),
            "company_id": str(voucher_type.company_id),
            "name": voucher_type.name,
            "base_voucher_type": voucher_type.base_voucher_type,
            "abbreviation": voucher_type.abbreviation,
            "active": voucher_type.active,
            "is_system": voucher_type.is_system,
            "created_by": voucher_type.created_by,
            "modified_by": voucher_type.modified_by,
            "created_date": voucher_type.created_date.isoformat()
            if voucher_type.created_date is not None
            else None,
            "modified_date": voucher_type.modified_date.isoformat()
            if voucher_type.modified_date is not None
            else None,
        }

    @staticmethod
    def _query_company(db: Session, company_id: UUID):
        return db.query(VoucherType).filter(VoucherType.company_id == company_id)

    @staticmethod
    def _base_exists(db: Session, code: str) -> bool:
        clean_code = (code or "").strip().upper()
        if not clean_code:
            return False
        return db.query(
            db.query(Lov.id)
            .filter(
                Lov.key_grp == BASE_VOUCHER_TYPE_GROUP,
                Lov.key_value == clean_code,
                Lov.active == "Y",
            )
            .exists()
        ).scalar()

    @staticmethod
    def _duplicate_name(
        db: Session,
        company_id: UUID,
        name: str,
        exclude_id: Optional[UUID] = None,
    ) -> bool:
        clean_name = (name or "").strip().lower()
        if not clean_name:
            return False
        query = db.query(VoucherType.id).filter(
            VoucherType.company_id == company_id,
            func.lower(VoucherType.name) == clean_name,
        )
        if exclude_id is not None:
            query = query.filter(VoucherType.id != exclude_id)
        return db.query(query.exists()).scalar()

    @staticmethod
    def get_base_options(db: Session) -> Tuple[List[Dict[str, Any]], str, str]:
        rows = (
            db.query(Lov.id, Lov.key_txt, Lov.key_value)
            .filter(
                Lov.key_grp == BASE_VOUCHER_TYPE_GROUP,
                Lov.active == "Y",
            )
            .order_by(Lov.display_order, Lov.key_txt)
            .all()
        )
        data = [
            {"id": str(row[0]), "name": row[1], "code": row[2]}
            for row in rows
        ]
        return (data, Status.SUCCESS, "Base voucher types fetched successfully")

    @staticmethod
    def get_all(
        db: Session,
        company_id: Optional[UUID],
        include_inactive: bool = True,
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        if company_id is None:
            return ([], Status.ERROR, "Select a company to view voucher types")
        query = VoucherTypeService._query_company(db, company_id)
        if not include_inactive:
            query = query.filter(VoucherType.active == "Y")
        rows = query.order_by(
            VoucherType.is_system.desc(),
            func.lower(VoucherType.name),
        ).all()
        return (
            [VoucherTypeService._to_dict(row) for row in rows],
            Status.SUCCESS,
            "Voucher types fetched successfully",
        )

    @staticmethod
    def get_active(
        db: Session,
        company_id: Optional[UUID],
        base_voucher_type: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        if company_id is None:
            return ([], Status.ERROR, "Select a company to view voucher types")
        query = (
            db.query(
                VoucherType.id,
                VoucherType.name,
                VoucherType.base_voucher_type,
                VoucherType.abbreviation,
                VoucherType.is_system,
            )
            .filter(
                VoucherType.company_id == company_id,
                VoucherType.active == "Y",
            )
        )
        if base_voucher_type:
            clean_base = base_voucher_type.strip().upper()
            query = query.filter(VoucherType.base_voucher_type == clean_base)

        rows = query.order_by(
            VoucherType.is_system.desc(),
            func.lower(VoucherType.name),
        ).all()
        data = [
            {
                "id": str(row[0]),
                "name": row[1],
                "base_voucher_type": row[2],
                "abbreviation": row[3],
                "is_system": row[4],
            }
            for row in rows
        ]
        return (data, Status.SUCCESS, "Active voucher types fetched successfully")

    @staticmethod
    def get_by_id(
        db: Session, voucher_type_id: UUID, company_id: Optional[UUID]
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if company_id is None:
            return (None, Status.ERROR, "Select a company to view voucher types")
        row = (
            VoucherTypeService._query_company(db, company_id)
            .filter(VoucherType.id == voucher_type_id)
            .first()
        )
        if not row:
            return (None, Status.ERROR, "Voucher type not found")
        return (
            VoucherTypeService._to_dict(row),
            Status.SUCCESS,
            "Voucher type fetched successfully",
        )

    @staticmethod
    def create(
        db: Session,
        payload: VoucherTypeCreate,
        company_id: Optional[UUID],
        actor: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if company_id is None:
            return (None, Status.ERROR, "Select a company to create a voucher type")
        clean_name = payload.name.strip()
        clean_base = payload.base_voucher_type.strip().upper()
        if not clean_name:
            return (None, Status.ERROR, "Voucher Type name is required")
        if not VoucherTypeService._base_exists(db, clean_base):
            return (None, Status.ERROR, "Select a valid active Base Voucher Type")
        if VoucherTypeService._duplicate_name(db, company_id, clean_name):
            return (None, Status.ERROR, "Voucher Type name already exists")

        row = VoucherType(
            company_id=company_id,
            name=clean_name,
            base_voucher_type=clean_base,
            abbreviation=payload.abbreviation,
            active=payload.active,
            is_system="N",
            created_by=actor,
        )
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
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return (None, Status.ERROR, "Voucher Type name already exists")
        db.refresh(row)
        return (
            VoucherTypeService._to_dict(row),
            Status.SUCCESS,
            "Voucher Type created successfully",
        )

    @staticmethod
    def update(
        db: Session,
        voucher_type_id: UUID,
        payload: VoucherTypeUpdate,
        company_id: Optional[UUID],
        actor: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if company_id is None:
            return (None, Status.ERROR, "Select a company to update a voucher type")
        row = (
            VoucherTypeService._query_company(db, company_id)
            .filter(VoucherType.id == voucher_type_id)
            .first()
        )
        if not row:
            return (None, Status.ERROR, "Voucher type not found")

        changes = payload.model_dump(exclude_unset=True)
        name = changes.get("name", row.name)
        if name is not None:
            name = name.strip()
        current_base = str(row.base_voucher_type)
        base_voucher_type = changes.get("base_voucher_type", current_base)
        if base_voucher_type is not None:
            base_voucher_type = base_voucher_type.strip().upper()

        if not name:
            return (None, Status.ERROR, "Voucher Type name is required")
        if not base_voucher_type or not VoucherTypeService._base_exists(
            db, base_voucher_type
        ):
            return (None, Status.ERROR, "Select a valid active Base Voucher Type")
        if VoucherTypeService._duplicate_name(
            db, company_id, name, exclude_id=voucher_type_id
        ):
            return (None, Status.ERROR, "Voucher Type name already exists")
        if (
            str(row.is_system) == "Y"
            and "base_voucher_type" in changes
            and base_voucher_type != current_base
        ):
            return (
                None,
                Status.ERROR,
                "Base Voucher Type cannot be changed for a system record",
            )
        if (
            "base_voucher_type" in changes
            and base_voucher_type != current_base
            and db.query(
                db.query(VoucherHeader.id)
                .filter(VoucherHeader.voucher_type_id == voucher_type_id)
                .exists()
            ).scalar()
        ):
            return (
                None,
                Status.ERROR,
                "Base Voucher Type cannot be changed after transactions exist",
            )

        old_name = row.name
        name_changed = name != old_name
        row.name = name
        row.base_voucher_type = base_voucher_type
        if "abbreviation" in changes:
            row.abbreviation = changes["abbreviation"]
        if "active" in changes:
            row.active = changes["active"]
        row.modified_by = actor

        # Keep sequence in sync with voucher type name and active status
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

        # Synchronize denormalized voucher_type_name for DRAFT vouchers
        if name_changed:
            db.query(VoucherHeader).filter(
                VoucherHeader.company_id == company_id,
                VoucherHeader.voucher_type_id == voucher_type_id,
                VoucherHeader.voucher_status == "DRAFT",
            ).update({"voucher_type_name": name}, synchronize_session=False)

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return (None, Status.ERROR, "Voucher Type name already exists")
        db.refresh(row)
        return (
            VoucherTypeService._to_dict(row),
            Status.SUCCESS,
            "Voucher Type updated successfully",
        )

    @staticmethod
    def set_active(
        db: Session,
        voucher_type_id: UUID,
        active: str,
        company_id: Optional[UUID],
        actor: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if company_id is None:
            return (None, Status.ERROR, "Select a company to update a voucher type")
        row = (
            VoucherTypeService._query_company(db, company_id)
            .filter(VoucherType.id == voucher_type_id)
            .first()
        )
        if not row:
            return (None, Status.ERROR, "Voucher type not found")
        row.active = active
        row.modified_by = actor

        # Keep sequence active status in sync
        seq = db.query(VoucherSequence).filter(
            VoucherSequence.company_id == company_id,
            VoucherSequence.voucher_type == row.name,
        ).first()
        if seq:
            seq.active = active
            seq.modified_by = actor

        db.commit()
        db.refresh(row)
        action = "activated" if active == "Y" else "deactivated"
        return (
            VoucherTypeService._to_dict(row),
            Status.SUCCESS,
            f"Voucher Type {action} successfully",
        )

    @staticmethod
    def resolve_active(
        db: Session, voucher_type_id: UUID, company_id: UUID
    ) -> Optional[VoucherType]:
        return (
            VoucherTypeService._query_company(db, company_id)
            .filter(
                VoucherType.id == voucher_type_id,
                VoucherType.active == "Y",
            )
            .first()
        )

    @staticmethod
    def resolve_active_for_base(
        db: Session, base_voucher_type: str, company_id: UUID
    ) -> Optional[VoucherType]:
        clean_base = (base_voucher_type or "").strip().upper()
        return (
            VoucherTypeService._query_company(db, company_id)
            .filter(
                VoucherType.base_voucher_type == clean_base,
                VoucherType.active == "Y",
            )
            .order_by(VoucherType.is_system.desc(), func.lower(VoucherType.name))
            .first()
        )