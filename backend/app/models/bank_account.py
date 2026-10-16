import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy import Uuid as UUID
from sqlalchemy.sql import func
from app.core.database import Base


class BankAccount(Base):
    """Bank & Cash master. Each account links to a ledger so it appears in
    the Bank Book / Cash Book and reconciliation flows."""

    __tablename__ = "bank_account"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_type = Column(String(10), default="BANK")  # BANK / CASH
    bank_name = Column(String(100))
    account_holder_name = Column(String(100))
    account_number = Column(String(30))
    ifsc_code = Column(String(11))
    branch = Column(String(100))
    upi_id = Column(String(60))
    ledger_id = Column(UUID(as_uuid=True), ForeignKey("master.ledger.id"), nullable=True)
    active = Column(String(1), default="Y")
    created_by = Column(String(100))
    modified_by = Column(String(100))
    created_date = Column(DateTime(timezone=True), default=func.now())
    modified_date = Column(DateTime(timezone=True), default=func.now(), onupdate=func.now())
