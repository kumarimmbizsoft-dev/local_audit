"""Financial reporting: Trial Balance, Profit & Loss, Balance Sheet, Cash Book,
Bank Book, Ledger Statement and Day Book.

All figures are derived from POSTED voucher lines (double-entry) plus ledger
opening balances. Sign convention: debit is positive, credit is negative.
"""
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.ledger import Ledger
from app.models.ledger_group import LedgerGroup
from app.models.voucher_detail import VoucherDetail
from app.models.voucher_header import VoucherHeader

# Primary group name -> accounting nature.
NATURE_BY_PRIMARY = {
    "Assets": "ASSET",
    "Liabilities": "LIABILITY",
    "Income": "INCOME",
    "Expenses": "EXPENSE",
}

# Fallback classification from a ledger's own category when it has no group.
NATURE_BY_CATEGORY = {
    "bank": "ASSET",
    "cash": "ASSET",
    "customer": "ASSET",
    "asset": "ASSET",
    "vendor": "LIABILITY",
    "liability": "LIABILITY",
    "tax": "LIABILITY",
    "income": "INCOME",
    "expense": "EXPENSE",
}


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


class ReportService:
    # ---------- classification helpers ----------
    @staticmethod
    def _group_map(db: Session) -> Dict[str, LedgerGroup]:
        return {str(g.id): g for g in db.query(LedgerGroup).all()}

    @staticmethod
    def _primary_group(group: Optional[LedgerGroup], group_map: Dict[str, LedgerGroup]):
        """Walk parent_id up to the primary (key_group == 'P') root group."""
        seen = set()
        cur = group
        while cur is not None and str(cur.id) not in seen:
            seen.add(str(cur.id))
            if cur.key_group == "P" or not cur.parent_id:
                return cur
            cur = group_map.get(str(cur.parent_id))
        return cur

    @staticmethod
    def _nature(ledger: Ledger, group_map: Dict[str, LedgerGroup]) -> str:
        grp = group_map.get(str(ledger.ledger_group_id)) if ledger.ledger_group_id else None
        root = ReportService._primary_group(grp, group_map)
        if root and root.name in NATURE_BY_PRIMARY:
            return NATURE_BY_PRIMARY[root.name]
        return NATURE_BY_CATEGORY.get((ledger.category or "").lower(), "ASSET")

    @staticmethod
    def _group_path(ledger: Ledger, group_map: Dict[str, LedgerGroup]) -> str:
        grp = group_map.get(str(ledger.ledger_group_id)) if ledger.ledger_group_id else None
        return grp.hierarchy_path or grp.name if grp else "Ungrouped"

    @staticmethod
    def _opening_signed(ledger: Ledger) -> float:
        opening = float(ledger.opening_balance or 0)
        return opening if (ledger.balance_type or "DR") == "DR" else -opening

    # ---------- posted movement aggregation ----------
    @staticmethod
    def _movements(
        db: Session,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        company_id: Optional[UUID] = None,
    ):
        from sqlalchemy import or_

        q = (
            db.query(VoucherDetail, VoucherHeader)
            .join(VoucherHeader, VoucherHeader.id == VoucherDetail.voucher_id)
            .filter(
                VoucherDetail.active == "Y",
                VoucherHeader.active == "Y",
                VoucherHeader.voucher_status == "POSTED",
            )
        )
        if company_id:
            q = q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
        if from_date:
            q = q.filter(VoucherHeader.voucher_date >= from_date)
        if to_date:
            q = q.filter(VoucherHeader.voucher_date <= to_date)
        return q.all()

    @staticmethod
    def _get_ledgers(db: Session, company_id: Optional[UUID] = None) -> List[Ledger]:
        from sqlalchemy import or_

        q = db.query(Ledger).filter(Ledger.active == "Y")
        if company_id:
            q = q.filter(or_(Ledger.company_id == company_id, Ledger.company_id.is_(None)))
        return q.all()

    @staticmethod
    def _net_by_ledger(
        db: Session,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        company_id: Optional[UUID] = None,
    ) -> Dict[str, Dict[str, float]]:
        """Return {ledger_id: {debit, credit, net}} of posted movement."""
        out: Dict[str, Dict[str, float]] = {}
        for detail, _header in ReportService._movements(db, from_date, to_date, company_id):
            if not detail.ledger_id:
                continue
            key = str(detail.ledger_id)
            row = out.setdefault(key, {"debit": 0.0, "credit": 0.0, "net": 0.0})
            d = float(detail.debit_amount or 0)
            c = float(detail.credit_amount or 0)
            row["debit"] += d
            row["credit"] += c
            row["net"] += d - c
        return out

    # ---------- Trial Balance ----------
    @staticmethod
    def trial_balance(
        db: Session,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        fd = _parse_date(from_date)
        td = _parse_date(to_date)
        ledgers = ReportService._get_ledgers(db, company_id)
        group_map = ReportService._group_map(db)
        movement = ReportService._net_by_ledger(db, None, td, company_id)

        rows: List[Dict[str, Any]] = []
        total_debit = 0.0
        total_credit = 0.0
        for l in ledgers:
            opening = ReportService._opening_signed(l)
            mv = movement.get(str(l.id), {"net": 0.0})
            closing = opening + mv["net"]
            if abs(closing) < 0.005 and abs(opening) < 0.005 and str(l.id) not in movement:
                continue
            debit = closing if closing >= 0 else 0.0
            credit = -closing if closing < 0 else 0.0
            total_debit += debit
            total_credit += credit
            rows.append({
                "ledgerId": str(l.id),
                "ledger": l.name,
                "group": ReportService._group_path(l, group_map),
                "nature": ReportService._nature(l, group_map),
                "debit": round(debit, 2),
                "credit": round(credit, 2),
            })
        rows.sort(key=lambda r: (r["group"], r["ledger"]))
        return {
            "fromDate": fd.isoformat() if fd else None,
            "toDate": td.isoformat() if td else None,
            "asOn": td.isoformat() if td else None,
            "rows": rows,
            "totalDebit": round(total_debit, 2),
            "totalCredit": round(total_credit, 2),
            "balanced": abs(total_debit - total_credit) < 0.01,
        }

    # ---------- Profit & Loss ----------
    @staticmethod
    def profit_and_loss(
        db: Session,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        fd = _parse_date(from_date)
        td = _parse_date(to_date)
        ledgers = ReportService._get_ledgers(db, company_id)
        group_map = ReportService._group_map(db)
        movement = ReportService._net_by_ledger(db, fd, td, company_id)

        income: List[Dict[str, Any]] = []
        expense: List[Dict[str, Any]] = []
        income_total = 0.0
        expense_total = 0.0
        for l in ledgers:
            nature = ReportService._nature(l, group_map)
            if nature not in ("INCOME", "EXPENSE"):
                continue
            mv = movement.get(str(l.id), {"net": 0.0})
            net = mv["net"]  # debit - credit
            if nature == "INCOME":
                amount = -net  # income has credit (negative) net -> positive income
                if abs(amount) < 0.005:
                    continue
                income_total += amount
                income.append({
                    "ledgerId": str(l.id),
                    "ledger": l.name,
                    "group": ReportService._group_path(l, group_map),
                    "amount": round(amount, 2),
                })
            else:
                amount = net  # expense has debit (positive) net
                if abs(amount) < 0.005:
                    continue
                expense_total += amount
                expense.append({
                    "ledgerId": str(l.id),
                    "ledger": l.name,
                    "group": ReportService._group_path(l, group_map),
                    "amount": round(amount, 2),
                })
        income.sort(key=lambda r: r["ledger"])
        expense.sort(key=lambda r: r["ledger"])
        net_profit = income_total - expense_total
        return {
            "fromDate": fd.isoformat() if fd else None,
            "toDate": td.isoformat() if td else None,
            "income": income,
            "expense": expense,
            "incomeTotal": round(income_total, 2),
            "expenseTotal": round(expense_total, 2),
            "netProfit": round(net_profit, 2),
            "isProfit": net_profit >= 0,
        }

    # ---------- Balance Sheet ----------
    @staticmethod
    def balance_sheet(
        db: Session,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        fd = _parse_date(from_date)
        td = _parse_date(to_date)
        ledgers = ReportService._get_ledgers(db, company_id)
        group_map = ReportService._group_map(db)
        movement = ReportService._net_by_ledger(db, None, td, company_id)

        assets: List[Dict[str, Any]] = []
        liabilities: List[Dict[str, Any]] = []
        assets_total = 0.0
        liabilities_total = 0.0
        income_total = 0.0
        expense_total = 0.0
        for l in ledgers:
            nature = ReportService._nature(l, group_map)
            opening = ReportService._opening_signed(l)
            mv = movement.get(str(l.id), {"net": 0.0})
            closing = opening + mv["net"]
            if nature == "ASSET":
                if abs(closing) < 0.005:
                    continue
                assets_total += closing
                assets.append({
                    "ledgerId": str(l.id),
                    "ledger": l.name,
                    "group": ReportService._group_path(l, group_map),
                    "amount": round(closing, 2),
                })
            elif nature == "LIABILITY":
                amount = -closing  # liabilities carry credit balances
                if abs(amount) < 0.005:
                    continue
                liabilities_total += amount
                liabilities.append({
                    "ledgerId": str(l.id),
                    "ledger": l.name,
                    "group": ReportService._group_path(l, group_map),
                    "amount": round(amount, 2),
                })
            elif nature == "INCOME":
                income_total += -mv["net"]
            elif nature == "EXPENSE":
                expense_total += mv["net"]

        net_profit = income_total - expense_total
        # Current-period profit accrues to the capital (liabilities) side.
        liabilities.append({
            "ledgerId": "profit-loss",
            "ledger": "Profit & Loss (current period)",
            "group": "Capital Account",
            "amount": round(net_profit, 2),
        })
        liabilities_total += net_profit
        assets.sort(key=lambda r: r["ledger"])
        liabilities.sort(key=lambda r: r["ledger"])
        return {
            "fromDate": fd.isoformat() if fd else None,
            "toDate": td.isoformat() if td else None,
            "asOn": td.isoformat() if td else None,
            "assets": assets,
            "liabilities": liabilities,
            "assetsTotal": round(assets_total, 2),
            "liabilitiesTotal": round(liabilities_total, 2),
            "netProfit": round(net_profit, 2),
            "balanced": abs(assets_total - liabilities_total) < 0.01,
        }

    # ---------- Ledger statement (with running balance) ----------
    @staticmethod
    def ledger_statement(
        db: Session,
        ledger_id,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        company_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        from sqlalchemy import or_

        fd = _parse_date(from_date)
        td = _parse_date(to_date)
        ledger = db.query(Ledger).filter(Ledger.id == ledger_id).first()
        if not ledger:
            return {"error": "Ledger not found"}

        opening_signed = ReportService._opening_signed(ledger)
        q = (
            db.query(VoucherDetail, VoucherHeader)
            .join(VoucherHeader, VoucherHeader.id == VoucherDetail.voucher_id)
            .filter(
                VoucherDetail.ledger_id == ledger_id,
                VoucherDetail.active == "Y",
                VoucherHeader.active == "Y",
                VoucherHeader.voucher_status == "POSTED",
            )
        )
        if company_id:
            q = q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
        rows = q.order_by(VoucherHeader.voucher_date, VoucherHeader.voucher_no).all()

        opening = opening_signed
        if fd:
            for detail, header in rows:
                if header.voucher_date and header.voucher_date < fd:
                    opening += float(detail.debit_amount or 0) - float(detail.credit_amount or 0)

        lines: List[Dict[str, Any]] = []
        running = opening
        for detail, header in rows:
            if fd and header.voucher_date and header.voucher_date < fd:
                continue
            if td and header.voucher_date and header.voucher_date > td:
                continue
            debit = float(detail.debit_amount or 0)
            credit = float(detail.credit_amount or 0)
            running += debit - credit
            lines.append({
                "voucherNo": header.voucher_no,
                "voucherType": header.voucher_type_name
                if header.voucher_type_name is not None
                else header.voucher_type,
                "baseVoucherType": header.voucher_type,
                "voucherDate": header.voucher_date.isoformat() if header.voucher_date else None,
                "narration": header.narration,
                "debit": round(debit, 2),
                "credit": round(credit, 2),
                "balance": round(running, 2),
            })
        return {
            "ledgerId": str(ledger.id),
            "ledger": ledger.name,
            "fromDate": fd.isoformat() if fd else None,
            "toDate": td.isoformat() if td else None,
            "openingBalance": round(opening, 2),
            "closingBalance": round(running, 2),
            "lines": lines,
        }

    # ---------- Cash / Bank books ----------
    @staticmethod
    def _cash_bank_book(
        db: Session,
        kind: str,
        from_date: Optional[str],
        to_date: Optional[str],
        company_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        ledgers = ReportService._get_ledgers(db, company_id)
        if kind == "cash":
            selected = [l for l in ledgers if l.is_cash == "Y" or (l.category or "").lower() == "cash"]
        else:
            selected = [l for l in ledgers if l.is_bank == "Y" or (l.category or "").lower() == "bank"]

        accounts = []
        for l in selected:
            stmt = ReportService.ledger_statement(db, l.id, from_date, to_date, company_id)
            accounts.append(stmt)
        total_open = round(sum(a["openingBalance"] for a in accounts), 2)
        total_close = round(sum(a["closingBalance"] for a in accounts), 2)
        return {
            "kind": kind,
            "fromDate": _parse_date(from_date).isoformat() if _parse_date(from_date) else None,
            "toDate": _parse_date(to_date).isoformat() if _parse_date(to_date) else None,
            "accounts": accounts,
            "openingTotal": total_open,
            "closingTotal": total_close,
        }

    @staticmethod
    def cash_book(
        db: Session, from_date=None, to_date=None, company_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        return ReportService._cash_bank_book(db, "cash", from_date, to_date, company_id)

    @staticmethod
    def bank_book(
        db: Session, from_date=None, to_date=None, company_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        return ReportService._cash_bank_book(db, "bank", from_date, to_date, company_id)

    # ---------- Day Book ----------
    @staticmethod
    def day_book(
        db: Session, from_date=None, to_date=None, company_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        from sqlalchemy import or_

        fd = _parse_date(from_date)
        td = _parse_date(to_date)
        q = db.query(VoucherHeader).filter(VoucherHeader.active == "Y")
        if company_id:
            q = q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
        if fd:
            q = q.filter(VoucherHeader.voucher_date >= fd)
        if td:
            q = q.filter(VoucherHeader.voucher_date <= td)
        headers = q.order_by(VoucherHeader.voucher_date.desc(), VoucherHeader.voucher_no).all()
        rows = [{
            "id": str(h.id),
            "voucherNo": h.voucher_no,
            "voucherType": h.voucher_type_name
            if h.voucher_type_name is not None
            else h.voucher_type,
            "baseVoucherType": h.voucher_type,
            "voucherDate": h.voucher_date.isoformat() if h.voucher_date else None,
            "narration": h.narration,
            "referenceNo": h.reference_no,
            "amount": float(h.total_debit or 0),
            "status": h.voucher_status,
        } for h in headers]
        return {
            "fromDate": fd.isoformat() if fd else None,
            "toDate": td.isoformat() if td else None,
            "rows": rows,
            "total": round(sum(r["amount"] for r in rows if r["status"] == "POSTED"), 2),
        }
