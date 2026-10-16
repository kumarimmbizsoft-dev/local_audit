from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.company_context import get_company_id
from app.core.database import get_db
from app.core.deps import get_current_user, require_permission
from app.core.feature_codes import FEATURE_REPORT
from app.schemas.response import AppResponse, Status
from app.services.report_service import ReportService

router = APIRouter(prefix="/api/reports", tags=["Reports"])


def _ok(data, message="Report generated"):
    return JSONResponse(
        content=AppResponse(status=Status.SUCCESS, message=message, result=data).model_dump()
    )


@router.get("/trial-balance")
def trial_balance(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.trial_balance(db, from_date, to_date, company_id), "Trial balance")


@router.get("/profit-loss")
def profit_loss(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.profit_and_loss(db, from_date, to_date, company_id), "Profit & Loss")


@router.get("/balance-sheet")
def balance_sheet(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.balance_sheet(db, from_date, to_date, company_id), "Balance sheet")


@router.get("/cash-book")
def cash_book(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.cash_book(db, from_date, to_date, company_id), "Cash book")


@router.get("/bank-book")
def bank_book(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.bank_book(db, from_date, to_date, company_id), "Bank book")


@router.get("/ledger/{ledger_id}")
def ledger_statement(
    ledger_id: UUID,
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.ledger_statement(db, ledger_id, from_date, to_date, company_id), "Ledger statement")


@router.get("/day-book")
def day_book(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    company_id: Optional[UUID] = Depends(get_company_id),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_REPORT, "view")),
):
    return _ok(ReportService.day_book(db, from_date, to_date, company_id), "Day book")
