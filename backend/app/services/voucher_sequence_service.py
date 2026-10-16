from sqlalchemy.orm import Session
from app.models.voucher_sequence import VoucherSequence
from app.models.voucher_type import VoucherType
from app.schemas.response import Status
from typing import List, Tuple, Optional
import uuid


class VoucherSequenceService:
    @staticmethod
    def get_all(
        db: Session, company_id: Optional[uuid.UUID] = None
    ) -> Tuple[List[dict], str, str]:
        if company_id is None:
            return ([], Status.SUCCESS, "No company selected")

        # Ensure any active Voucher Types have a corresponding sequence
        try:
            active_types = (
                db.query(VoucherType)
                .filter(VoucherType.company_id == company_id, VoucherType.active == "Y")
                .all()
            )
            existing_seq_types = {
                s[0]
                for s in db.query(VoucherSequence.voucher_type)
                .filter(VoucherSequence.company_id == company_id)
                .all()
            }
            new_added = False
            for vt in active_types:
                # Custom voucher types are keyed by their name
                key = vt.name if str(vt.is_system) == "N" else str(vt.base_voucher_type)
                if key not in existing_seq_types:
                    prefix = (vt.abbreviation or vt.name[:3] or "VC").strip().upper()
                    db.add(
                        VoucherSequence(
                            company_id=company_id,
                            voucher_type=key,
                            prefix=prefix,
                            last_number=0,
                            number_width=4,
                            active="Y",
                            created_by="system",
                        )
                    )
                    existing_seq_types.add(key)
                    new_added = True
            if new_added:
                db.commit()
        except Exception:
            db.rollback()

        sequences = (
            db.query(VoucherSequence)
            .filter(
                VoucherSequence.company_id == company_id,
                VoucherSequence.active == "Y",
            )
            .order_by(VoucherSequence.voucher_type)
            .all()
        )
        data = [VoucherSequenceService._to_dict(s) for s in sequences]
        return (data, Status.SUCCESS, "Voucher sequences fetched successfully")

    @staticmethod
    def bulk_save(
        db: Session, sequences_list: List[dict], company_id: Optional[uuid.UUID] = None
    ) -> Tuple[bool, str, str]:
        if not sequences_list:
            return (False, "FAILED", "No data to save")
        if company_id is None:
            return (False, "FAILED", "No company selected")

        try:
            for item in sequences_list:
                item_id = item.get("id")
                if item_id:
                    try:
                        existing = (
                            db.query(VoucherSequence)
                            .filter(
                                VoucherSequence.id == uuid.UUID(item_id),
                                VoucherSequence.company_id == company_id,
                            )
                            .first()
                        )
                        if existing:
                            existing.prefix = item.get("prefix", existing.prefix)
                            existing.last_number = item.get(
                                "lastNumber", existing.last_number
                            )
                            existing.number_width = item.get(
                                "numberWidth", existing.number_width
                            )
                            existing.active = item.get("active", existing.active)
                            existing.modified_by = item.get("modifiedBy")
                    except ValueError:
                        pass
                else:
                    db_sequence = VoucherSequence(
                        company_id=company_id,
                        voucher_type=item.get("voucherType", ""),
                        prefix=item.get("prefix", ""),
                        last_number=item.get("lastNumber", 0),
                        number_width=item.get("numberWidth", 4),
                        active=item.get("active", "Y"),
                        created_by=item.get("createdBy"),
                    )
                    db.add(db_sequence)

            db.commit()
            return (True, Status.SUCCESS, "Data Saved Successfully")
        except Exception as e:
            db.rollback()
            return (False, "FAILED", str(e))

    @staticmethod
    def _to_dict(sequence: VoucherSequence) -> dict:
        return {
            "id": str(sequence.id),
            "voucherType": sequence.voucher_type,
            "prefix": sequence.prefix,
            "lastNumber": sequence.last_number,
            "numberWidth": sequence.number_width,
            "active": sequence.active,
            "createdBy": sequence.created_by,
            "modifiedBy": sequence.modified_by,
            "createdDate": sequence.created_date.isoformat()
            if sequence.created_date
            else None,
            "modifiedDate": sequence.modified_date.isoformat()
            if sequence.modified_date
            else None,
        }
