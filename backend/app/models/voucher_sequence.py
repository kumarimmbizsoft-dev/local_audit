import uuid

from sqlalchemy import Column, String, Integer, DateTime, UniqueConstraint
from sqlalchemy import Uuid as UUID
from sqlalchemy.sql import func
from app.core.database import Base


class VoucherSequence(Base):
    __tablename__ = "voucher_sequence"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "voucher_type", name="uq_voucher_sequence_company_type"
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), index=True, nullable=False)
    voucher_type = Column(String(100), nullable=False)
    prefix = Column(String(10), nullable=False)
    last_number = Column(Integer, default=0)
    number_width = Column(Integer, default=4)
    active = Column(String(1), default="Y")
    created_by = Column(String(100))
    modified_by = Column(String(100))
    created_date = Column(DateTime(timezone=True), default=func.now())
    modified_date = Column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now()
    )
