"""First-run database initialization + seed.

Creates all tables (schema on Postgres), seeds a ready-to-use admin login
with full permissions, a default company, standard chart of accounts,
GST rates, HSN/SAC reference data, units, cost centers and starter LOVs so
the product is usable immediately on first launch.
"""
import uuid
from datetime import date

from sqlalchemy import text, inspect

from app.core.database import Base, engine, SessionLocal, IS_SQLITE
from app.core.security import get_password_hash

# Import every model so its table registers on Base.metadata.
from app.models import (  # noqa: F401
    audit_log,
    auth,
    bank_account,
    company,
    cost_center,
    custom_field,
    gst,
    ledger,
    ledger_group,
    lov,
    party,
    product_item,
    system_setting,
    unit,
    user_master,
    user_company_map,
    user_role,
    app_feature_rolemap,
    app_features,
    app_module,
    subscription,
    voucher_detail,
    voucher_header,
    voucher_sequence,
    voucher_type,
)
from app.models.app_module import AppModule
from app.models.app_features import AppFeature
from app.models.app_feature_rolemap import AppFeatureRolemap
from app.models.company import Company
from app.models.cost_center import CostCenter
from app.models.gst import GstRate, HsnCode
from app.models.unit import UnitMaster
from app.models.user_role import UserRole
from app.models.user_master import UserMaster, UserRoleMap
from app.models.user_company_map import UserCompanyMap
from app.models.auth import UserAttr
from app.models.lov import Lov
from app.models.voucher_sequence import VoucherSequence
from app.models.voucher_type import VoucherType
from app.models.ledger_group import LedgerGroup

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_EMAIL = "admin@immbiz.local"
DEFAULT_ADMIN_PASSWORD = "Admin@123"

MODULES = [
    ("MASTERS", "Masters", 1),
    ("TRANSACTIONS", "Transactions", 2),
    ("REPORTS", "Reports", 3),
    ("ADMIN", "Administration", 4),
]

# (feature_code, feature_name, feature_url, module_code)
FEATURES = [
    ("COMPANY", "Company", "/app/companies", "MASTERS"),
    ("LEDGER_GROUP", "Ledger Groups", "/app/ledger-groups", "MASTERS"),
    ("LEDGER", "Ledgers", "/app/ledgers", "MASTERS"),
    ("CUSTOMER", "Customers", "/app/customers", "MASTERS"),
    ("VENDOR", "Vendors", "/app/vendors", "MASTERS"),
    ("ITEMS", "Products / Items", "/app/products", "MASTERS"),
    ("BANK_CASH", "Bank & Cash", "/app/banks", "MASTERS"),
    ("GST_SETUP", "GST Setup", "/app/gst", "MASTERS"),
    ("COST_CENTER", "Cost Centers", "/app/cost-centers", "MASTERS"),
    ("UNITS", "Units", "/app/units", "MASTERS"),
    ("VOUCHER_TYPE", "Voucher Types", "/app/voucher-types", "MASTERS"),
    ("VOUCHER", "Accounting Voucher", "/app/accounting-vouchers", "TRANSACTIONS"),
    ("REPORT", "Reports", "/app/reports", "REPORTS"),
    ("LOV", "List of Values", "/app/lov", "ADMIN"),
    ("CUSTOM_FIELD", "Custom Fields", "/app/custom-fields", "ADMIN"),
    ("USER_ROLE", "User Roles", "/app/roles", "ADMIN"),
    ("USER_MASTER", "Users", "/app/users", "ADMIN"),
    ("SYSTEM_SETTING", "System Settings", "/app/settings", "ADMIN"),
]

VOUCHER_BASE_TYPES = [
    ("SALES", "Sales", "SAL"),
    ("PURCHASE", "Purchase", "PUR"),
    ("RECEIPT", "Receipt", "REC"),
    ("PAYMENT", "Payment", "PAY"),
    ("CONTRA", "Contra", "CON"),
    ("JOURNAL", "Journal", "JNL"),
    ("DEBIT_NOTE", "Debit Note", "DN"),
    ("CREDIT_NOTE", "Credit Note", "CN"),
]

# (voucher_type, prefix) — a numbering sequence is seeded for each.
VOUCHER_SEQUENCES = [
    ("JOURNAL", "JV"),
    ("SALES", "SV"),
    ("PURCHASE", "PV"),
    ("RECEIPT", "RV"),
    ("PAYMENT", "PMT"),
    ("CONTRA", "CV"),
    ("DEBIT_NOTE", "DN"),
    ("CREDIT_NOTE", "CN"),
]

# System ledgers required for automated voucher posting (sales/purchase GST,
# rounding, cash). (ledger_name, sub_group_name, category, balance_type, flags)
SYSTEM_LEDGERS = [
    ("Cash", "Cash-in-hand", "cash", "DR", {"is_cash": "Y"}),
    ("Sales Account", "Sales Accounts", "income", "CR", {}),
    ("Purchase Account", "Purchase Accounts", "expense", "DR", {}),
    ("Sales Return", "Sales Accounts", "income", "DR", {}),
    ("Purchase Return", "Purchase Accounts", "expense", "CR", {}),
    ("Output CGST", "Duties & Taxes", "tax", "CR", {}),
    ("Output SGST", "Duties & Taxes", "tax", "CR", {}),
    ("Output IGST", "Duties & Taxes", "tax", "CR", {}),
    ("Input CGST", "Duties & Taxes", "tax", "DR", {}),
    ("Input SGST", "Duties & Taxes", "tax", "DR", {}),
    ("Input IGST", "Duties & Taxes", "tax", "DR", {}),
    ("TDS Payable", "Duties & Taxes", "tax", "CR", {}),
    ("Round Off", "Office Expenses", "expense", "DR", {}),
]

STARTER_LOVS = [
    ("BALANCE_TYPE", "Debit", "DR", 1),
    ("BALANCE_TYPE", "Credit", "CR", 2),
    ("STATUS", "Active", "Y", 1),
    ("STATUS", "Inactive", "N", 2),
    ("GST_TYPE", "Registered", "REG", 1),
    ("GST_TYPE", "Unregistered", "UNREG", 2),
    ("GST_TYPE", "Composition", "COMP", 3),
    ("GST_TYPE", "Exempt", "EXEMPT", 4),
    ("PARTY_TYPE", "Customer", "C", 1),
    ("PARTY_TYPE", "Vendor", "V", 2),
    ("PARTY_TYPE", "Both", "B", 3),
    ("PAYMENT_TERMS", "Due on receipt", "DUE", 1),
    ("PAYMENT_TERMS", "Net 15", "NET15", 2),
    ("PAYMENT_TERMS", "Net 30", "NET30", 3),
    ("PAYMENT_TERMS", "Net 45", "NET45", 4),
    ("PAYMENT_METHODS", "Bank Transfer / NEFT / RTGS", "BANK_TRANSFER", 1),
    ("PAYMENT_METHODS", "UPI / GPay / PhonePe", "UPI", 2),
    ("PAYMENT_METHODS", "Cheque", "CHEQUE", 3),
    ("PAYMENT_METHODS", "Cash", "CASH", 4),
    ("PAYMENT_METHODS", "Credit Card", "CREDIT_CARD", 5),
    ("DASHBOARD_PERIOD", "This quarter", "THIS_QUARTER", 1),
    ("DASHBOARD_PERIOD", "This month", "THIS_MONTH", 2),
    ("DASHBOARD_PERIOD", "FY YTD", "FY_YTD", 3),
    ("DASHBOARD_PERIOD", "Last 6 months", "LAST_6_MONTHS", 4),
    ("DASHBOARD_PERIOD", "This year", "THIS_YEAR", 5),
    ("DASHBOARD_PERIOD", "All time", "ALL_TIME", 6),
    ("DASHBOARD_COMPARE", "Same period last year", "SAME_PERIOD_LAST_YEAR", 1),
    ("DASHBOARD_COMPARE", "Previous period", "PREVIOUS_PERIOD", 2),
    ("DASHBOARD_COMPARE", "Budget / Target", "BUDGET_TARGET", 3),
] + [
    ("VOUCHER_BASE_TYPE", name, code, order)
    for order, (code, name, _abbreviation) in enumerate(VOUCHER_BASE_TYPES, start=1)
]

GST_RATES = [
    (0, "Nil rated"),
    (0.25, "Rough precious stones"),
    (3, "Gold and jewellery"),
    (5, "Essential goods"),
    (12, "Standard goods"),
    (18, "Standard rate"),
    (28, "Luxury / sin goods"),
]

HSN_SEED = [
    ("8471", "Automatic data processing machines: computers, laptops", 18, "G"),
    ("9401", "Seats and chairs, office furniture", 18, "G"),
    ("4802", "Uncoated paper for writing and printing", 12, "G"),
    ("8544", "Insulated wire and cables, USB cables", 18, "G"),
    ("8539", "Electric lamps, LED bulbs", 12, "G"),
    ("6109", "T-shirts, singlets, knitted or crocheted", 5, "G"),
    ("3004", "Medicaments for therapeutic use", 12, "G"),
    ("998313", "IT consulting and support services", 18, "S"),
    ("998314", "IT design and development services", 18, "S"),
    ("997212", "Rental or leasing of buildings", 18, "S"),
    ("996511", "Road transport of goods", 5, "S"),
    ("998222", "Accounting and bookkeeping services", 18, "S"),
]

UNITS = [
    ("Pieces", "PCS"),
    ("Numbers", "NOS"),
    ("Kilogram", "KG"),
    ("Gram", "GM"),
    ("Litre", "LTR"),
    ("Metre", "MTR"),
    ("Box", "BOX"),
    ("Ream", "REAM"),
    ("Dozen", "DOZ"),
    ("Hour", "HR"),
]

COST_CENTERS = [
    ("Head Office", "HO", "BRANCH"),
    ("Sales", "SAL", "DEPARTMENT"),
    ("Operations", "OPS", "DEPARTMENT"),
]


def _create_schema_if_needed() -> None:
    if IS_SQLITE:
        return
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS master"))


def create_all_tables() -> None:
    _create_schema_if_needed()
    Base.metadata.create_all(bind=engine)


def ensure_company_maintain_mode_schema() -> None:
    """Add and backfill the required company maintenance mode."""
    schema = None if IS_SQLITE else "master"
    inspector = inspect(engine)
    try:
        columns = {
            column["name"]
            for column in inspector.get_columns("company", schema=schema)
        }
    except Exception:
        return

    table = "company" if IS_SQLITE else 'master."company"'
    with engine.begin() as connection:
        if "maintain_mode" not in columns:
            connection.execute(
                text(
                    f"ALTER TABLE {table} ADD COLUMN maintain_mode VARCHAR(30) "
                    "NOT NULL DEFAULT 'ACCOUNT_ONLY'"
                )
            )
        connection.execute(
            text(
                f"UPDATE {table} SET maintain_mode = 'ACCOUNT_ONLY' "
                "WHERE maintain_mode IS NULL OR maintain_mode = ''"
            )
        )
        if not IS_SQLITE:
            connection.execute(
                text(
                    f"ALTER TABLE {table} ALTER COLUMN maintain_mode "
                    "SET DEFAULT 'ACCOUNT_ONLY'"
                )
            )
            connection.execute(
                text(
                    f"ALTER TABLE {table} ALTER COLUMN maintain_mode SET NOT NULL"
                )
            )


def ensure_voucher_header_source_fields() -> None:
    """Add source_document_type and source_document_id columns if they do not exist."""
    table = "voucher_header" if IS_SQLITE else "master.voucher_header"
    with engine.begin() as connection:
        if IS_SQLITE:
            try:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN source_document_type VARCHAR(50)"))
            except Exception:
                pass
            try:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN source_document_id TEXT"))
            except Exception:
                pass
        else:
            connection.execute(
                text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS source_document_type VARCHAR(50)")
            )
            connection.execute(
                text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS source_document_id UUID")
            )


def ensure_ledger_group_code_field() -> None:
    """Add code column to ledger_group table if it does not exist."""
    schema = None if IS_SQLITE else "master"
    inspector = inspect(engine)
    try:
        columns = {
            column["name"]
            for column in inspector.get_columns("ledger_group", schema=schema)
        }
    except Exception as e:
        print(f"[init_db] Note on columns inspect: {e}")
        return

    table = "ledger_group" if IS_SQLITE else 'master."ledger_group"'
    with engine.begin() as connection:
        if "code" not in columns:
            if IS_SQLITE:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN code VARCHAR(50)"))
            else:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS code VARCHAR(50)"))
            
            try:
                # Create unique index for code (ignoring nulls in PostgreSQL)
                if IS_SQLITE:
                    connection.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_group_code ON {table}(code)"))
                else:
                    connection.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_group_code ON {table}(code) WHERE code IS NOT NULL"))
            except Exception as e:
                print(f"[init_db] Note on index creation: {e}")


def ensure_voucher_sequence_schema() -> None:
    """Drop outdated single-column unique constraint on voucher_type and ensure composite unique index on (company_id, voucher_type)."""
    table = "voucher_sequence" if IS_SQLITE else 'master."voucher_sequence"'
    index_table = "voucher_sequence" if IS_SQLITE else 'master.voucher_sequence'
    with engine.begin() as connection:
        if not IS_SQLITE:
            try:
                connection.execute(
                    text("ALTER TABLE master.voucher_sequence DROP CONSTRAINT IF EXISTS voucher_sequence_voucher_type_key")
                )
            except Exception as e:
                print(f"[init_db] Note on dropping constraint voucher_sequence_voucher_type_key: {e}")
            try:
                connection.execute(
                    text("DROP INDEX IF EXISTS master.voucher_sequence_voucher_type_key")
                )
            except Exception as e:
                print(f"[init_db] Note on dropping index voucher_sequence_voucher_type_key: {e}")
        try:
            connection.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_sequence_company_type "
                    f"ON {index_table} (company_id, voucher_type)"
                )
            )
        except Exception as e:
            print(f"[init_db] Note on creating index uq_voucher_sequence_company_type: {e}")



def _already_seeded(db) -> bool:
    return db.query(UserMaster).first() is not None


def _seed_ledger_groups(db) -> None:
    """Seed a standard chart-of-accounts structure (Primary/Main/Sub)."""
    primary = [
        ("Assets", "DR", "ASSETS"),
        ("Liabilities", "CR", "LIABILITIES"),
        ("Income", "CR", "INCOME"),
        ("Expenses", "DR", "EXPENSES"),
    ]
    main = [
        ("Current Assets", "DR", "Assets", "CURRENT_ASSETS"),
        ("Fixed Assets", "DR", "Assets", "FIXED_ASSETS"),
        ("Investments", "DR", "Assets", "INVESTMENTS"),
        ("Current Liabilities", "CR", "Liabilities", "CURRENT_LIABILITIES"),
        ("Loans (Liability)", "CR", "Liabilities", "LOANS_LIABILITY"),
        ("Capital Account", "CR", "Liabilities", "CAPITAL_ACCOUNT"),
        ("Sales Accounts", "CR", "Income", "SALES_ACCOUNTS"),
        ("Direct Income", "CR", "Income", "DIRECT_INCOME"),
        ("Indirect Income", "CR", "Income", "INDIRECT_INCOME"),
        ("Purchase Accounts", "DR", "Expenses", "PURCHASE_ACCOUNTS"),
        ("Direct Expenses", "DR", "Expenses", "DIRECT_EXPENSES"),
        ("Indirect Expenses", "DR", "Expenses", "INDIRECT_EXPENSES"),
    ]
    sub = [
        ("Bank Accounts", "DR", "Current Assets", "BANK_ACCOUNTS"),
        ("Cash-in-hand", "DR", "Current Assets", "CASH_IN_HAND"),
        ("Sundry Debtors", "DR", "Current Assets", "SUNDRY_DEBTORS"),
        ("Stock-in-hand", "DR", "Current Assets", "STOCK_IN_HAND"),
        ("Loans & Advances (Asset)", "DR", "Current Assets", "LOANS_ADVANCES_ASSET"),
        ("Sundry Creditors", "CR", "Current Liabilities", "SUNDRY_CREDITORS"),
        ("Duties & Taxes", "CR", "Current Liabilities", "DUTIES_TAXES"),
        ("Provisions", "CR", "Current Liabilities", "PROVISIONS"),
        ("Sales Accounts", "CR", "Sales Accounts", "SUB_SALES_ACCOUNTS"),
        ("Purchase Accounts", "DR", "Purchase Accounts", "SUB_PURCHASE_ACCOUNTS"),
        ("Office Expenses", "DR", "Indirect Expenses", "OFFICE_EXPENSES"),
    ]
    by_name = {}
    for name, bt, code in primary:
        g = LedgerGroup(name=name, key_group="P", balance_type=bt, active="Y",
                        is_system="Y", hierarchy_path=name, code=code)
        db.add(g)
        db.flush()
        by_name[name] = g
    for name, bt, parent, code in main:
        g = LedgerGroup(
            name=name, key_group="M", balance_type=bt, active="Y", is_system="Y",
            parent_id=by_name[parent].id,
            hierarchy_path=f"{parent} > {name}",
            code=code,
        )
        db.add(g)
        db.flush()
        by_name[name] = g
    for name, bt, parent, code in sub:
        g = LedgerGroup(
            name=name, key_group="S", balance_type=bt, active="Y", is_system="Y",
            parent_id=by_name[parent].id,
            hierarchy_path=f"{by_name[parent].hierarchy_path} > {name}",
            code=code,
        )
        db.add(g)
        db.flush()
        by_name[name] = g


def _seed_system_ledgers(db, company_id=None) -> None:
    """Create the system ledgers used by automated voucher posting.

    When company_id is set, ledgers are created only for that company (idempotent).
    """
    from app.models.ledger import Ledger

    groups = {g.name: g for g in db.query(LedgerGroup).all()}
    for name, group_name, category, balance_type, flags in SYSTEM_LEDGERS:
        q = db.query(Ledger).filter(Ledger.name == name)
        if company_id is not None:
            q = q.filter(Ledger.company_id == company_id)
        else:
            q = q.filter(Ledger.company_id.is_(None))
        if q.first():
            continue
        grp = groups.get(group_name)
        db.add(
            Ledger(
                company_id=company_id,
                name=name,
                ledger_group_id=grp.id if grp else None,
                category=category,
                balance_type=balance_type,
                opening_balance=0,
                active="Y",
                is_system="Y",
                is_bank=flags.get("is_bank", "N"),
                is_cash=flags.get("is_cash", "N"),
            )
        )


def seed_default_ledgers_for_company(db, company_id) -> None:
    """Public helper: ensure default/system ledgers exist for a company."""
    _seed_system_ledgers(db, company_id=company_id)


def seed_default_voucher_types_for_company(db, company_id) -> None:
    """Public helper: ensure the six base system Voucher Types exist."""
    existing_codes = {
        row.base_voucher_type
        for row in db.query(VoucherType)
        .filter(
            VoucherType.company_id == company_id,
            VoucherType.is_system == "Y",
        )
        .all()
    }
    for code, name, abbreviation in VOUCHER_BASE_TYPES:
        if code not in existing_codes:
            db.add(
                VoucherType(
                    company_id=company_id,
                    name=name,
                    base_voucher_type=code,
                    abbreviation=abbreviation,
                    active="Y",
                    is_system="Y",
                    created_by="system",
                )
            )


def seed_default_voucher_sequences_for_company(db, company_id) -> None:
    """Public helper: ensure default Voucher Sequences exist for a company."""
    existing_types = {
        row.voucher_type
        for row in db.query(VoucherSequence)
        .filter(VoucherSequence.company_id == company_id)
        .all()
    }
    for vtype, prefix in VOUCHER_SEQUENCES:
        if vtype not in existing_types:
            db.add(
                VoucherSequence(
                    company_id=company_id,
                    voucher_type=vtype,
                    prefix=prefix,
                    last_number=0,
                    number_width=4,
                    active="Y",
                    created_by="system",
                )
            )


def ensure_company_scoping() -> None:
    """Add company_id columns if missing, backfill to the default company, and
    seed default ledgers and voucher sequences for every active company."""
    ensure_voucher_sequence_schema()
    from sqlalchemy import inspect as sa_inspect, text
    from app.models.ledger import Ledger
    from app.models.party import Party
    from app.models.voucher_header import VoucherHeader
    from app.models.product_item import ProductItem
    from app.models.company import Company

    schema = None if IS_SQLITE else "master"
    tables = ("ledger", "party", "voucher_header", "product_item", "voucher_sequence")
    insp = sa_inspect(engine)
    with engine.begin() as conn:
        for table in tables:
            try:
                cols = {c["name"] for c in insp.get_columns(table, schema=schema)}
            except Exception:
                continue
            if "company_id" in cols:
                continue
            fq = table if IS_SQLITE else f'{schema}."{table}"'
            # UUID-compatible: Postgres UUID, SQLite TEXT via SQLAlchemy type affinity
            col_type = "TEXT" if IS_SQLITE else "UUID"
            conn.execute(text(f"ALTER TABLE {fq} ADD COLUMN company_id {col_type}"))

    db = SessionLocal()
    try:
        if not _already_seeded(db):
            return
        default = (
            db.query(Company)
            .filter(Company.is_default == "Y", Company.active == "Y")
            .first()
        ) or db.query(Company).filter(Company.active == "Y").first()
        if default:
            for Model in (Ledger, Party, VoucherHeader, ProductItem, VoucherSequence):
                db.query(Model).filter(Model.company_id.is_(None)).update(
                    {Model.company_id: default.id}, synchronize_session=False
                )
            db.commit()

        for company in db.query(Company).filter(Company.active == "Y").all():
            _seed_system_ledgers(db, company_id=company.id)
            seed_default_voucher_types_for_company(db, company_id=company.id)
            seed_default_voucher_sequences_for_company(db, company_id=company.id)
        seed_voucher_base_type_lovs(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def seed_voucher_base_type_lovs(db) -> None:
    """Ensure all base voucher types exist in master LOVs."""
    from app.models.lov import Lov
    existing = {
        row.key_value
        for row in db.query(Lov)
        .filter(Lov.key_grp == "VOUCHER_BASE_TYPE")
        .all()
    }
    for order, (code, name, _abbreviation) in enumerate(VOUCHER_BASE_TYPES, start=1):
        if code not in existing:
            db.add(
                Lov(
                    key_grp="VOUCHER_BASE_TYPE",
                    key_txt=name,
                    key_value=code,
                    display_order=order,
                    active="Y",
                    key_type="G",
                    created_by="system",
                )
            )
    db.commit()


def ensure_voucher_type_schema() -> None:
    """Add Voucher Type references and due_date to existing voucher_header tables."""
    fq_table = "voucher_header" if IS_SQLITE else 'master."voucher_header"'
    uuid_type = "TEXT" if IS_SQLITE else "UUID"
    additions = {
        "voucher_type_id": uuid_type,
        "voucher_type_name": "VARCHAR(100)",
        "due_date": "DATE",
        "reference_date": "DATE",
    }
    with engine.begin() as connection:
        for column_name, column_type in additions.items():
            if IS_SQLITE:
                try:
                    connection.execute(
                        text(f"ALTER TABLE {fq_table} ADD COLUMN {column_name} {column_type}")
                    )
                except Exception:
                    pass
            else:
                try:
                    connection.execute(
                        text(f"ALTER TABLE {fq_table} ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
                    )
                except Exception:
                    pass
        try:
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_voucher_header_voucher_type_id "
                    f"ON {fq_table} (voucher_type_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_voucher_header_due_date "
                    f"ON {fq_table} (due_date)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_voucher_header_company_type_status "
                    f"ON {fq_table} (company_id, voucher_type, voucher_status)"
                )
            )
            voucher_type_table = (
                "voucher_type" if IS_SQLITE else 'master."voucher_type"'
            )
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "uq_voucher_type_company_name_ci "
                    f"ON {voucher_type_table} (company_id, lower(name))"
                )
            )
        except Exception:
            pass

    if not IS_SQLITE:
        with engine.begin() as connection:
            try:
                connection.execute(text('ALTER TABLE master.voucher_sequence ALTER COLUMN voucher_type TYPE VARCHAR(100)'))
                connection.execute(text('ALTER TABLE master.voucher_header ALTER COLUMN voucher_type TYPE VARCHAR(20)'))
                connection.execute(text('ALTER TABLE master.voucher_type ALTER COLUMN base_voucher_type TYPE VARCHAR(20)'))
            except Exception:
                pass


def ensure_lov_schema() -> None:
    """Ensure master.lov.key_value column width is updated to VARCHAR(50)."""
    fq_table = "lov" if IS_SQLITE else 'master."lov"'
    if not IS_SQLITE:
        with engine.begin() as connection:
            try:
                connection.execute(
                    text(f"ALTER TABLE {fq_table} ALTER COLUMN key_value TYPE VARCHAR(50)")
                )
            except Exception:
                pass


def ensure_bank_account_schema() -> None:
    """Ensure bank_account has account_holder_name column."""
    fq_table = "bank_account" if IS_SQLITE else 'master."bank_account"'
    with engine.begin() as connection:
        if IS_SQLITE:
            try:
                connection.execute(
                    text(f"ALTER TABLE {fq_table} ADD COLUMN account_holder_name VARCHAR(100)")
                )
            except Exception:
                pass
        else:
            try:
                connection.execute(
                    text(f"ALTER TABLE {fq_table} ADD COLUMN IF NOT EXISTS account_holder_name VARCHAR(100)")
                )
            except Exception:
                pass



def ensure_reference_data() -> None:
    """Idempotent upgrades applied on every startup so existing databases gain
    newly added features, voucher sequences and system ledgers without a reseed.
    Safe to run repeatedly; only missing rows are inserted."""
    db = SessionLocal()
    try:
        if not _already_seeded(db):
            return  # a fresh DB is handled by seed_defaults()

        # --- Modules ---
        modules: dict[str, AppModule] = {
            str(module.module_code): module for module in db.query(AppModule).all()
        }
        for code, name, order in MODULES:
            if code not in modules:
                m = AppModule(module_name=name, module_code=code,
                              module_dis_order=order, active="Y")
                db.add(m)
                db.flush()
                modules[code] = m

        # --- LOV reference values ---
        existing_lovs = {
            (row.key_grp, row.key_value) for row in db.query(Lov).all()
        }
        for group, label, value, order in STARTER_LOVS:
            if (group, value) not in existing_lovs:
                db.add(
                    Lov(
                        key_grp=group,
                        key_txt=label,
                        key_value=value,
                        active="Y",
                        display_order=order,
                        key_type="G",
                    )
                )

        # --- Features (+ grant every role that already has full access) ---
        existing_features: dict[str, AppFeature] = {
            str(feature.feature_code): feature
            for feature in db.query(AppFeature).all()
        }
        admin_roles = db.query(UserRole).filter(UserRole.role_code == "ADMIN").all()
        new_features = []
        for fcode, fname, furl, mcode in FEATURES:
            if fcode not in existing_features and mcode in modules:
                f = AppFeature(
                    feature_name=fname,
                    feature_url=furl,
                    feature_code=fcode,
                    app_module_id=modules[mcode].id,
                    active="Y",
                )
                db.add(f)
                db.flush()
                existing_features[fcode] = f
                new_features.append(f)
            elif fcode in existing_features and mcode in modules:
                feature = existing_features[fcode]
                setattr(feature, "feature_name", fname)
                setattr(feature, "feature_url", furl)
                setattr(feature, "app_module_id", modules[mcode].id)
        for f in new_features:
            for role in admin_roles:
                already = (
                    db.query(AppFeatureRolemap)
                    .filter(
                        AppFeatureRolemap.app_feature_id == f.id,
                        AppFeatureRolemap.user_role_id == role.id,
                    )
                    .first()
                )
                if not already:
                    db.add(
                        AppFeatureRolemap(
                            app_feature_id=f.id,
                            user_role_id=role.id,
                            allow_write="Y",
                            allow_delete="Y",
                            active="Y",
                        )
                    )

        # Voucher Types are common reference data: every active role can view
        # them, while write/delete remain explicitly role-controlled.
        voucher_type_feature = existing_features.get("VOUCHER_TYPE")
        if voucher_type_feature is not None:
            for role in db.query(UserRole).filter(UserRole.active == "Y").all():
                mapping = (
                    db.query(AppFeatureRolemap)
                    .filter(
                        AppFeatureRolemap.app_feature_id == voucher_type_feature.id,
                        AppFeatureRolemap.user_role_id == role.id,
                    )
                    .first()
                )
                if mapping is None:
                    db.add(
                        AppFeatureRolemap(
                            app_feature_id=voucher_type_feature.id,
                            user_role_id=role.id,
                            allow_write="N",
                            allow_delete="N",
                            active="Y",
                        )
                    )
                else:
                    setattr(mapping, "active", "Y")

        # --- Voucher sequences ---
        for company in db.query(Company).filter(Company.active == "Y").all():
            seed_default_voucher_sequences_for_company(db, company_id=company.id)

        # --- Ledger groups + system ledgers ---
        if db.query(LedgerGroup).first() is None:
            _seed_ledger_groups(db)
            db.flush()
        # Per-company default ledgers are ensured in ensure_company_scoping().

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ensure_voucher_type_defaults() -> None:
    """Seed system Voucher Types and link legacy vouchers to stable records."""
    from app.models.voucher_header import VoucherHeader

    db = SessionLocal()
    try:
        companies = db.query(Company).filter(Company.active == "Y").all()
        for company in companies:
            seed_default_voucher_types_for_company(db, company.id)
        db.flush()

        defaults = {
            (str(row.company_id), row.base_voucher_type): row
            for row in db.query(VoucherType)
            .filter(VoucherType.is_system == "Y")
            .all()
        }
        legacy_headers = (
            db.query(VoucherHeader)
            .filter(VoucherHeader.voucher_type_id.is_(None))
            .all()
        )
        for header in legacy_headers:
            default_type = defaults.get(
                (str(header.company_id), header.voucher_type)
            )
            if default_type is not None:
                setattr(header, "voucher_type_id", default_type.id)
                setattr(header, "voucher_type_name", default_type.name)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def seed_defaults() -> None:
    db = SessionLocal()
    try:
        if _already_seeded(db):
            return

        modules = {}
        for code, name, order in MODULES:
            m = AppModule(module_name=name, module_code=code, module_dis_order=order, active="Y")
            db.add(m)
            db.flush()
            modules[code] = m

        features = []
        for fcode, fname, furl, mcode in FEATURES:
            f = AppFeature(
                feature_name=fname,
                feature_url=furl,
                feature_code=fcode,
                app_module_id=modules[mcode].id,
                active="Y",
            )
            db.add(f)
            db.flush()
            features.append(f)

        admin_role = UserRole(role_code="ADMIN", role_name="Administrator", active="Y")
        db.add(admin_role)
        db.flush()

        for f in features:
            db.add(
                AppFeatureRolemap(
                    app_feature_id=f.id,
                    user_role_id=admin_role.id,
                    allow_write="Y",
                    allow_delete="Y",
                    active="Y",
                )
            )

        admin_user = UserMaster(
            user_name=DEFAULT_ADMIN_USERNAME,
            user_email=DEFAULT_ADMIN_EMAIL,
            first_name="Admin",
            last_name="User",
            active="Y",
            user_type="S",
        )
        db.add(admin_user)
        db.flush()

        db.add(
            UserRoleMap(
                user_role_id=admin_role.id,
                user_id=admin_user.id,
                active="Y",
            )
        )

        db.add(
            UserAttr(
                id=uuid.uuid4(),
                user_id=admin_user.id,
                attr_name="PWD",
                attr_value=get_password_hash(DEFAULT_ADMIN_PASSWORD),
                active="Y",
            )
        )
        for grp, txt, val, order in STARTER_LOVS:
            db.add(
                Lov(
                    key_grp=grp,
                    key_txt=txt,
                    key_value=val,
                    active="Y",
                    display_order=order,
                    key_type="G",
                )
            )

        for vtype, prefix in VOUCHER_SEQUENCES:
            db.add(
                VoucherSequence(
                    voucher_type=vtype,
                    prefix=prefix,
                    last_number=0,
                    number_width=4,
                    active="Y",
                )
            )

        # Default company with an April-March financial year.
        today = date.today()
        fy_start = date(today.year if today.month >= 4 else today.year - 1, 4, 1)
        fy_end = date(fy_start.year + 1, 3, 31)
        db.add(
            Company(
                company_name="My Company",
                state_code="33",
                state="Tamil Nadu",
                financial_year_start=fy_start,
                financial_year_end=fy_end,
                currency="INR",
                maintain_mode="ACCOUNT_ONLY",
                is_default="Y",
                active="Y",
            )
        )

        for rate, desc in GST_RATES:
            db.add(GstRate(rate=rate, tax_type="BOTH", description=desc, active="Y"))

        for code, desc, rate, kind in HSN_SEED:
            db.add(HsnCode(code=code, description=desc, gst_rate=rate, kind=kind, active="Y"))

        for uname, usym in UNITS:
            db.add(UnitMaster(unit_name=uname, unit_symbol=usym, active="Y"))

        for cname, ccode, ckind in COST_CENTERS:
            db.add(CostCenter(name=cname, code=ccode, kind=ckind, active="Y"))

        _seed_ledger_groups(db)
        db.flush()
        # Attach system ledgers to the default company created above.
        default_co = db.query(Company).filter(Company.is_default == "Y").first()
        _seed_system_ledgers(db, company_id=default_co.id if default_co else None)

        db.commit()
        print(
            f"[init_db] Seeded admin login -> username: {DEFAULT_ADMIN_USERNAME} "
            f"password: {DEFAULT_ADMIN_PASSWORD}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ensure_ledger_groups_deduplicated() -> None:
    """Standardize and deduplicate master.ledger_group records."""
    db = SessionLocal()
    try:
        # 1. Standardize singular / variant names to standard canonical names
        db.execute(text("UPDATE master.ledger_group SET name = 'Assets' WHERE name = 'Asset';"))
        db.execute(text("UPDATE master.ledger_group SET name = 'Liabilities' WHERE name = 'Liability';"))
        db.execute(text("UPDATE master.ledger_group SET name = 'Current Assets' WHERE name = 'Current Asset';"))
        db.execute(text("UPDATE master.ledger_group SET name = 'Current Liabilities' WHERE name = 'Current Liability';"))
        db.execute(text("UPDATE master.ledger_group SET name = 'Bank Accounts' WHERE name = 'Bank Account';"))

        # 2. Repoint any ledgers referencing duplicate groups to the canonical group
        db.execute(text("""
            WITH canonical AS (
                SELECT DISTINCT ON (LOWER(TRIM(name)), key_group)
                    id AS canonical_id,
                    LOWER(TRIM(name)) AS norm_name,
                    key_group
                FROM master.ledger_group
                ORDER BY 
                    LOWER(TRIM(name)), 
                    key_group, 
                    (id::text LIKE 'e0000000%') DESC,
                    created_date ASC NULLS LAST,
                    id ASC
            ),
            duplicates AS (
                SELECT lg.id AS duplicate_id, c.canonical_id
                FROM master.ledger_group lg
                JOIN canonical c ON LOWER(TRIM(lg.name)) = c.norm_name AND lg.key_group = c.key_group
                WHERE lg.id <> c.canonical_id
            )
            UPDATE master.ledger l
            SET ledger_group_id = d.canonical_id
            FROM duplicates d
            WHERE l.ledger_group_id = d.duplicate_id;
        """))

        # 3. Repoint child ledger_groups referencing duplicate parent groups to the canonical parent
        db.execute(text("""
            WITH canonical AS (
                SELECT DISTINCT ON (LOWER(TRIM(name)), key_group)
                    id AS canonical_id,
                    LOWER(TRIM(name)) AS norm_name,
                    key_group
                FROM master.ledger_group
                ORDER BY 
                    LOWER(TRIM(name)), 
                    key_group, 
                    (id::text LIKE 'e0000000%') DESC,
                    created_date ASC NULLS LAST,
                    id ASC
            ),
            duplicates AS (
                SELECT lg.id AS duplicate_id, c.canonical_id
                FROM master.ledger_group lg
                JOIN canonical c ON LOWER(TRIM(lg.name)) = c.norm_name AND lg.key_group = c.key_group
                WHERE lg.id <> c.canonical_id
            )
            UPDATE master.ledger_group lg
            SET parent_id = d.canonical_id
            FROM duplicates d
            WHERE lg.parent_id = d.duplicate_id;
        """))

        # 4. Safely delete duplicate group rows
        db.execute(text("""
            WITH canonical AS (
                SELECT DISTINCT ON (LOWER(TRIM(name)), key_group)
                    id AS canonical_id,
                    LOWER(TRIM(name)) AS norm_name,
                    key_group
                FROM master.ledger_group
                ORDER BY 
                    LOWER(TRIM(name)), 
                    key_group, 
                    (id::text LIKE 'e0000000%') DESC,
                    created_date ASC NULLS LAST,
                    id ASC
            ),
            duplicates AS (
                SELECT lg.id AS duplicate_id
                FROM master.ledger_group lg
                JOIN canonical c ON LOWER(TRIM(lg.name)) = c.norm_name AND lg.key_group = c.key_group
                WHERE lg.id <> c.canonical_id
            )
            DELETE FROM master.ledger_group
            WHERE id IN (SELECT duplicate_id FROM duplicates);
        """))

        # 5. Fix hierarchy paths
        db.execute(text("UPDATE master.ledger_group SET hierarchy_path = name WHERE key_group = 'P';"))
        db.execute(text("""
            UPDATE master.ledger_group lg
            SET hierarchy_path = p.name || ' > ' || lg.name
            FROM master.ledger_group p
            WHERE lg.parent_id = p.id AND lg.key_group = 'M';
        """))
        db.execute(text("""
            UPDATE master.ledger_group lg
            SET hierarchy_path = p.hierarchy_path || ' > ' || lg.name
            FROM master.ledger_group p
            WHERE lg.parent_id = p.id AND lg.key_group = 'S';
        """))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[init_db] Note on deduplicate_ledger_groups: {e}")
    finally:
        db.close()


def ensure_ledger_group_codes() -> None:
    """Backfill static codes for ledger groups based on name and key_group."""
    db = SessionLocal()
    try:
        group_codes = {
            # Primary (P)
            ("Assets", "P"): "ASSETS",
            ("Liabilities", "P"): "LIABILITIES",
            ("Income", "P"): "INCOME",
            ("Expenses", "P"): "EXPENSES",
            # Main (M)
            ("Current Assets", "M"): "CURRENT_ASSETS",
            ("Fixed Assets", "M"): "FIXED_ASSETS",
            ("Investments", "M"): "INVESTMENTS",
            ("Current Liabilities", "M"): "CURRENT_LIABILITIES",
            ("Loans (Liability)", "M"): "LOANS_LIABILITY",
            ("Capital Account", "M"): "CAPITAL_ACCOUNT",
            ("Sales Accounts", "M"): "SALES_ACCOUNTS",
            ("Direct Income", "M"): "DIRECT_INCOME",
            ("Indirect Income", "M"): "INDIRECT_INCOME",
            ("Purchase Accounts", "M"): "PURCHASE_ACCOUNTS",
            ("Direct Expenses", "M"): "DIRECT_EXPENSES",
            ("Indirect Expenses", "M"): "INDIRECT_EXPENSES",
            # Sub (S)
            ("Bank Accounts", "S"): "BANK_ACCOUNTS",
            ("Cash-in-hand", "S"): "CASH_IN_HAND",
            ("Sundry Debtors", "S"): "SUNDRY_DEBTORS",
            ("Stock-in-hand", "S"): "STOCK_IN_HAND",
            ("Loans & Advances (Asset)", "S"): "LOANS_ADVANCES_ASSET",
            ("Sundry Creditors", "S"): "SUNDRY_CREDITORS",
            ("Duties & Taxes", "S"): "DUTIES_TAXES",
            ("Provisions", "S"): "PROVISIONS",
            ("Office Expenses", "S"): "OFFICE_EXPENSES",
            ("Sales Accounts", "S"): "SUB_SALES_ACCOUNTS",
            ("Purchase Accounts", "S"): "SUB_PURCHASE_ACCOUNTS",
        }
        
        for (name, key_group), code in group_codes.items():
            db.query(LedgerGroup).filter(
                LedgerGroup.name == name,
                LedgerGroup.key_group == key_group,
                LedgerGroup.code.is_(None)
            ).update({LedgerGroup.code: code}, synchronize_session=False)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[init_db] Note on ensure_ledger_group_codes: {e}")
    finally:
        db.close()


def ensure_user_company_mapping() -> None:
    """Ensure existing users have at least one assigned default company."""
    db = SessionLocal()
    try:
        companies = db.query(Company).filter(Company.active == "Y").all()
        if not companies:
            return
        default_company = next((c for c in companies if c.is_default == "Y"), companies[0])
        users = db.query(UserMaster).filter(UserMaster.active == "Y").all()

        for u in users:
            has_map = db.query(UserCompanyMap).filter(
                UserCompanyMap.user_id == u.id,
                UserCompanyMap.active == "Y",
            ).first() is not None
            if not has_map:
                db.add(
                    UserCompanyMap(
                        user_id=u.id,
                        company_id=default_company.id,
                        is_default="Y",
                        active="Y",
                    )
                )
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[init_db] Note on ensure_user_company_mapping: {e}")
    finally:
        db.close()


def init_db() -> None:
    ensure_ledger_group_code_field()  # Run DB schema check first
    create_all_tables()
    ensure_company_maintain_mode_schema()
    ensure_voucher_header_source_fields()
    ensure_voucher_type_schema()
    ensure_lov_schema()
    ensure_bank_account_schema()
    ensure_voucher_sequence_schema()
    ensure_company_scoping()
    seed_defaults()
    ensure_reference_data()
    try:
        db = SessionLocal()
        methods = [
            ("PAYMENT_METHODS", "Bank Transfer / NEFT / RTGS", "BANK_TRANSFER", 1),
            ("PAYMENT_METHODS", "UPI / GPay / PhonePe", "UPI", 2),
            ("PAYMENT_METHODS", "Cheque", "CHEQUE", 3),
            ("PAYMENT_METHODS", "Cash", "CASH", 4),
            ("PAYMENT_METHODS", "Credit Card", "CREDIT_CARD", 5),
            ("DASHBOARD_PERIOD", "This quarter", "THIS_QUARTER", 1),
            ("DASHBOARD_PERIOD", "This month", "THIS_MONTH", 2),
            ("DASHBOARD_PERIOD", "FY YTD", "FY_YTD", 3),
            ("DASHBOARD_PERIOD", "Last 6 months", "LAST_6_MONTHS", 4),
            ("DASHBOARD_PERIOD", "This year", "THIS_YEAR", 5),
            ("DASHBOARD_PERIOD", "All time", "ALL_TIME", 6),
            ("DASHBOARD_COMPARE", "Same period last year", "SAME_PERIOD_LAST_YEAR", 1),
            ("DASHBOARD_COMPARE", "Previous period", "PREVIOUS_PERIOD", 2),
            ("DASHBOARD_COMPARE", "Budget / Target", "BUDGET_TARGET", 3),
        ]
        for grp, txt, val, order in methods:
            existing = db.query(Lov).filter(Lov.key_grp == grp, Lov.key_txt == txt).first()
            if not existing:
                db.add(Lov(key_grp=grp, key_txt=txt, key_value=val, display_order=order, active="Y"))
        db.commit()
    except Exception as e:
        pass
    finally:
        db.close()

    db = SessionLocal()
    try:
        from app.services.subscription_service import SubscriptionService
        SubscriptionService.seed_plans(db)
    except Exception as e:
        pass
    finally:
        db.close()

    try:
        from app.core.database import DemoSessionLocal
        demo_db = DemoSessionLocal()
        from app.services.subscription_service import SubscriptionService
        SubscriptionService.seed_plans(demo_db)
        demo_db.close()
    except Exception:
        pass

    ensure_company_scoping()
    ensure_voucher_type_defaults()
    ensure_ledger_groups_deduplicated()
    ensure_ledger_group_codes()  # Backfill codes for existing groups
    ensure_user_company_mapping()
    db = SessionLocal()
    try:
        # Deduplicate and refresh hierarchy paths
        pass
    except Exception:
        pass
    finally:
        db.close()


if __name__ == "__main__":
    init_db()
    insp = inspect(engine)
    print("[init_db] tables:", sorted(insp.get_table_names()))
