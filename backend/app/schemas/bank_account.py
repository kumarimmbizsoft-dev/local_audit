from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, date
from uuid import UUID
from decimal import Decimal


class BankAccountBase(BaseModel):
    account_type: str = "BANK"
    bank_name: Optional[str] = Field(None, max_length=100)
    account_holder_name: Optional[str] = Field(None, max_length=100)
    account_number: Optional[str] = Field(None, max_length=30)
    ifsc_code: Optional[str] = Field(None, max_length=11)
    branch: Optional[str] = Field(None, max_length=100)
    upi_id: Optional[str] = Field(None, max_length=60)
    ledger_id: Optional[UUID] = None
    active: str = "Y"


class BankAccountCreate(BankAccountBase):
    # Optionally auto-create the linked ledger
    opening_balance: Optional[Decimal] = None
    opening_balance_date: Optional[date] = None


class BankAccountUpdate(BankAccountCreate):
    pass


class BankAccountResponse(BankAccountBase):
    id: UUID
    created_date: Optional[datetime] = None
    modified_date: Optional[datetime] = None

    class Config:
        from_attributes = True
