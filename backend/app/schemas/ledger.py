from pydantic import BaseModel, Field
from typing import Optional, Any, Dict
from datetime import datetime, date
from uuid import UUID
from decimal import Decimal


class LedgerBase(BaseModel):
    name: Optional[str] = Field(None, max_length=50)
    ledger_group_id: Optional[UUID] = None
    category: Optional[str] = Field(None, max_length=30)
    balance_type: Optional[str] = Field(None, max_length=2)
    opening_balance: Optional[Decimal] = None
    opening_balance_date: Optional[date] = None
    description: Optional[str] = None
    # GST & Tax
    gstin: Optional[str] = Field(None, max_length=15)
    gst_type: Optional[str] = Field(None, max_length=20)
    default_gst_rate: Optional[Decimal] = None
    hsn_sac: Optional[str] = Field(None, max_length=10)
    # Contact
    address: Optional[str] = None
    contact_person: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = Field(None, max_length=100)
    mobile: Optional[str] = Field(None, max_length=20)
    # Credit & billing
    credit_limit: Optional[Decimal] = None
    payment_terms: Optional[str] = Field(None, max_length=30)
    default_narration: Optional[str] = Field(None, max_length=100)
    # Advanced
    tags: Optional[str] = Field(None, max_length=255)
    cost_center_id: Optional[UUID] = None
    custom_fields: Optional[Dict[str, Any]] = None
    is_bank: Optional[str] = "N"
    is_cash: Optional[str] = "N"
    is_frozen: Optional[str] = "N"
    active: str = "Y"
    created_by: Optional[str] = None
    modified_by: Optional[str] = None
    is_system: str = "N"


class LedgerCreate(LedgerBase):
    pass


class LedgerUpdate(LedgerBase):
    pass


class LedgerValidateRequest(BaseModel):
    id: Optional[UUID] = None
    name: Optional[str] = None
    gstin: Optional[str] = None
    ledger_group_id: Optional[UUID] = None


class LedgerQuickCreate(BaseModel):
    name: str
    category: Optional[str] = None
    ledger_group_id: Optional[UUID] = None


class LedgerResponse(LedgerBase):
    id: UUID
    created_date: Optional[datetime] = None
    modified_date: Optional[datetime] = None

    class Config:
        from_attributes = True


class LedgerBulkRow(BaseModel):
    name: str
    opening_balance: Optional[Decimal] = None
    balance_type: Optional[str] = None  # "DR"/"CR"; blank = inherit group


class LedgerBulkRequest(BaseModel):
    ledger_group_id: UUID
    opening_balance_date: Optional[date] = None  # single global date
    items: list[LedgerBulkRow]
