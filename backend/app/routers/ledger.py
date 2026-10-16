from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from pydantic import BaseModel
from app.core.database import get_db
from app.core.deps import get_current_user, require_permission
from app.core.company_context import get_company_id
from app.core.feature_codes import FEATURE_LEDGER
from app.schemas.ledger import (
    LedgerCreate,
    LedgerUpdate,
    LedgerValidateRequest,
    LedgerQuickCreate,
    LedgerBulkRequest,
)
from app.schemas.response import AppResponse, Status
from app.services.ledger_service import LedgerService

router = APIRouter(prefix="/api/ledgers", tags=["Ledger"])


def _resp(data, status_val, message, ok_code=200, err_code=404):
    return JSONResponse(
        content=AppResponse(
            status=status_val, message=message, result=data
        ).model_dump(),
        status_code=err_code if status_val == Status.ERROR else ok_code,
    )


class MergeRequest(BaseModel):
    source_id: UUID
    target_id: UUID


@router.get("")
def get_ledgers(
    skip: int = 0,
    limit: int = 500,
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    company_id: Optional[UUID] = Depends(get_company_id),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "view")),
):
    data, status_val, message = LedgerService.get_all(
        db, skip, limit, search, category, include_inactive, company_id=company_id
    )
    return _resp(data, status_val, message)


@router.post("/validate")
def validate_ledger(
    body: LedgerValidateRequest,
    db: Session = Depends(get_db),
    company_id: Optional[UUID] = Depends(get_company_id),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "view")),
):
    data = LedgerService.validate(
        db, body.name, body.gstin, body.id, company_id=company_id, ledger_group_id=body.ledger_group_id
    )
    return _resp(data, Status.SUCCESS, "Validation complete")


@router.get("/suggest-group")
def suggest_group(
    category: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "view")),
):
    data = LedgerService.suggest_group(db, category, name)
    return _resp(data, Status.SUCCESS, "Suggestion computed")


@router.post("/quick-create", status_code=201)
def quick_create_ledger(
    body: LedgerQuickCreate,
    db: Session = Depends(get_db),
    company_id: Optional[UUID] = Depends(get_company_id),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "write")),
):
    data, status_val, message = LedgerService.quick_create(
        db, body, company_id=company_id
    )
    return _resp(data, status_val, message, ok_code=201, err_code=400)


@router.post("/merge")
def merge_ledgers(
    body: MergeRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "delete")),
):
    data, status_val, message = LedgerService.merge(db, body.source_id, body.target_id)
    return _resp(data, status_val, message, err_code=400)


@router.get("/{ledger_id}")
def get_ledger(
    ledger_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "view")),
):
    data, status_val, message = LedgerService.get_by_id(db, ledger_id)
    return _resp(data, status_val, message)


@router.post("/bulk", status_code=201)
def bulk_create_ledgers(
    body: LedgerBulkRequest,
    db: Session = Depends(get_db),
    company_id: Optional[UUID] = Depends(get_company_id),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "write")),
):
    data = LedgerService.bulk_create(db, body, company_id=company_id)
    ok = data["failed"] == 0
    return _resp(
        data,
        Status.SUCCESS if ok else Status.ERROR,
        f"Created {data['created']} ledger(s)"
        if ok
        else f"Created {data['created']}, failed {data['failed']}",
        ok_code=201,
        err_code=400,
    )


@router.post("", status_code=201)
def create_ledger(
    ledger: LedgerCreate,
    db: Session = Depends(get_db),
    company_id: Optional[UUID] = Depends(get_company_id),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "write")),
):
    data, status_val, message = LedgerService.create(db, ledger, company_id=company_id)
    return _resp(data, status_val, message, ok_code=201, err_code=400)


@router.put("/{ledger_id}")
def update_ledger(
    ledger_id: UUID,
    ledger: LedgerUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "write")),
):
    data, status_val, message = LedgerService.update(db, ledger_id, ledger)
    return _resp(data, status_val, message)


@router.patch("/{ledger_id}/freeze")
def freeze_ledger(
    ledger_id: UUID,
    frozen: str = Query(..., description="Y to freeze/block, N to unfreeze"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "write")),
):
    data, status_val, message = LedgerService.set_frozen(db, ledger_id, frozen)
    return _resp(data, status_val, message, err_code=400)


@router.patch("/{ledger_id}/active")
def update_ledger_active(
    ledger_id: UUID,
    active: str = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "write")),
):
    data, status_val, message = LedgerService.update_active(db, ledger_id, active)
    return _resp(data, status_val, message, err_code=400)


@router.delete("/{ledger_id}")
def delete_ledger(
    ledger_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _=Depends(require_permission(FEATURE_LEDGER, "delete")),
):
    _, status_val, message = LedgerService.delete(db, ledger_id)
    return _resp(None, status_val, message)
