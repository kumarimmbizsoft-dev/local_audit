from sqlalchemy.orm import Session
from app.models.bank_account import BankAccount
from app.models.ledger import Ledger
from app.models.ledger_group import LedgerGroup
from app.schemas.bank_account import BankAccountCreate, BankAccountUpdate
from app.schemas.response import Status
from typing import List, Optional, Tuple, Any, Dict
from uuid import UUID
import re

IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


class BankAccountService:
    @staticmethod
    def _to_dict(db: Session, b: BankAccount) -> Dict[str, Any]:
        ledger = db.query(Ledger).filter(Ledger.id == b.ledger_id).first() if b.ledger_id else None
        return {
            "id": str(b.id),
            "account_type": b.account_type,
            "bank_name": b.bank_name,
            "account_holder_name": b.account_holder_name,
            "account_number": b.account_number,
            "ifsc_code": b.ifsc_code,
            "branch": b.branch,
            "upi_id": b.upi_id,
            "ledger_id": str(b.ledger_id) if b.ledger_id else None,
            "ledger_name": ledger.name if ledger else None,
            "opening_balance": float(ledger.opening_balance) if ledger and ledger.opening_balance else 0,
            "active": b.active,
            "created_date": b.created_date.isoformat() if b.created_date else None,
            "modified_date": b.modified_date.isoformat() if b.modified_date else None,
        }

    @staticmethod
    def validate_ifsc(ifsc: str) -> Dict[str, Any]:
        ifsc = (ifsc or "").strip().upper()
        ok = bool(IFSC_RE.match(ifsc))
        return {"ifsc": ifsc, "valid": ok,
                "message": "Valid IFSC" if ok else "IFSC format is invalid (AAAA0XXXXXX)"}

    @staticmethod
    def get_all(db: Session, company_id: Optional[UUID] = None) -> Tuple[List[Dict[str, Any]], str, str]:
        if company_id is None:
            return ([], Status.SUCCESS, "No company selected")
        rows = (
            db.query(BankAccount)
            .join(Ledger, Ledger.id == BankAccount.ledger_id)
            .filter(Ledger.company_id == company_id, BankAccount.active == "Y")
            .all()
        )
        return ([BankAccountService._to_dict(db, b) for b in rows], Status.SUCCESS,
                "Bank & cash accounts fetched successfully")

    @staticmethod
    def _group_for(db: Session, account_type: str) -> Optional[LedgerGroup]:
        name = "Cash-in-hand" if account_type == "CASH" else "Bank Accounts"
        return db.query(LedgerGroup).filter(
            LedgerGroup.name == name, LedgerGroup.active == "Y"
        ).first()

    @staticmethod
    def create(db: Session, payload: BankAccountCreate) -> Tuple[Optional[Dict[str, Any]], str, str]:
        if payload.ifsc_code:
            v = BankAccountService.validate_ifsc(payload.ifsc_code)
            if not v["valid"]:
                return (None, Status.ERROR, v["message"])
        data = payload.model_dump(exclude_unset=True)
        opening = data.pop("opening_balance", None)
        opening_date = data.pop("opening_balance_date", None)
        b = BankAccount(**data)

        # Auto-create the linked ledger when none is provided.
        if not b.ledger_id:
            grp = BankAccountService._group_for(db, b.account_type or "BANK")
            ledger = Ledger(
                name=b.bank_name or ("Cash" if b.account_type == "CASH" else "Bank"),
                ledger_group_id=grp.id if grp else None,
                category="cash" if b.account_type == "CASH" else "bank",
                balance_type="DR",
                opening_balance=opening,
                opening_balance_date=opening_date,
                is_bank="Y" if b.account_type != "CASH" else "N",
                is_cash="Y" if b.account_type == "CASH" else "N",
                active="Y",
            )
            db.add(ledger)
            db.flush()
            b.ledger_id = ledger.id
        db.add(b)
        db.commit()
        db.refresh(b)
        return (BankAccountService._to_dict(db, b), Status.SUCCESS,
                "Account created successfully")

    @staticmethod
    def update(db: Session, bid: UUID, payload: BankAccountUpdate) -> Tuple[Optional[Dict[str, Any]], str, str]:
        b = db.query(BankAccount).filter(BankAccount.id == bid).first()
        if not b:
            return (None, Status.ERROR, "Account not found")
        if payload.ifsc_code:
            v = BankAccountService.validate_ifsc(payload.ifsc_code)
            if not v["valid"]:
                return (None, Status.ERROR, v["message"])
        data = payload.model_dump(exclude_unset=True)
        opening = data.pop("opening_balance", None)
        opening_date = data.pop("opening_balance_date", None)
        for k, v2 in data.items():
            setattr(b, k, v2)
        if b.ledger_id:
            ledger = db.query(Ledger).filter(Ledger.id == b.ledger_id).first()
            if ledger:
                if b.bank_name:
                    ledger.name = b.bank_name
                if opening is not None:
                    ledger.opening_balance = opening
                if opening_date is not None:
                    ledger.opening_balance_date = opening_date
        db.commit()
        db.refresh(b)
        return (BankAccountService._to_dict(db, b), Status.SUCCESS,
                "Account updated successfully")

    @staticmethod
    def delete(db: Session, bid: UUID) -> Tuple[bool, str, str]:
        b = db.query(BankAccount).filter(BankAccount.id == bid).first()
        if not b:
            return (False, Status.ERROR, "Account not found")
        b.active = "N"
        if b.ledger_id:
            ledger = db.query(Ledger).filter(Ledger.id == b.ledger_id).first()
            if ledger:
                ledger.active = "N"
        db.commit()
        return (True, Status.SUCCESS, "Account removed successfully")
