"""Masters dashboard: tile counts and master-data health indicators."""
import json
import logging
import math
from copy import deepcopy
from datetime import date, datetime, timedelta
from threading import RLock
from time import monotonic
from typing import Dict, Any, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.ledger import Ledger
from app.models.ledger_group import LedgerGroup
from app.models.party import Party
from app.models.product_item import ProductItem
from app.models.bank_account import BankAccount
from app.models.gst import GstRate, HsnCode
from app.models.cost_center import CostCenter
from app.models.unit import UnitMaster
from app.models.voucher_header import VoucherHeader
from app.models.voucher_detail import VoucherDetail
from app.models.voucher_type import VoucherType
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

SUMMARY_CACHE_TTL_SECONDS = 30
AGEING_CACHE_TTL_SECONDS = 60


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        if isinstance(v, str) and not v.strip():
            return default
        val = float(v)
        if math.isnan(val) or math.isinf(val):
            return default
        return val
    except (ValueError, TypeError):
        return default


def _to_date(v: Any, default: Optional[date] = None) -> date:
    if default is None:
        default = date.today()
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v.strip():
        try:
            return date.fromisoformat(v.strip().split("T")[0])
        except Exception:
            pass
    return default


def _to_dict(v: Any) -> Dict[str, Any]:
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _empty_ageing() -> Dict[str, Any]:
    return {
        "total_outstanding": 0.0,
        "not_due": 0.0,
        "0_30": 0.0,
        "31_60": 0.0,
        "61_90": 0.0,
        "90_plus": 0.0,
        "open_document_count": 0,
    }


def _get_period_date_range(period: Optional[str]) -> Tuple[Optional[date], Optional[date]]:
    if not period:
        return None, None

    p = period.strip().upper().replace(" ", "_")
    today = date.today()

    if p in ("ALL_TIME", "ALL"):
        return None, None

    # Check 6 months BEFORE "MONTH" check because LAST_6_MONTHS contains "MONTH"
    if "LAST_6" in p or "6_MONTH" in p or "SIX" in p:
        month = today.month - 6
        year = today.year
        if month <= 0:
            month += 12
            year -= 1
        return date(year, month, 1), today

    if "MONTH" in p:
        return date(today.year, today.month, 1), today

    if "QUARTER" in p:
        m = today.month
        if m in (4, 5, 6):
            q_start = date(today.year, 4, 1)
        elif m in (7, 8, 9):
            q_start = date(today.year, 7, 1)
        elif m in (10, 11, 12):
            q_start = date(today.year, 10, 1)
        else:
            q_start = date(today.year, 1, 1)
        return q_start, today

    if "YTD" in p or "FY" in p:
        fy_year = today.year if today.month >= 4 else today.year - 1
        return date(fy_year, 4, 1), today

    if "YEAR" in p:
        return date(today.year, 1, 1), today

    return None, None


def _get_compare_date_range(period: Optional[str], compare: Optional[str]) -> Tuple[Optional[date], Optional[date]]:
    if not period or not compare or compare.strip().upper().replace(" ", "_") == "BUDGET_TARGET":
        return None, None

    start_date, end_date = _get_period_date_range(period)
    if not start_date or not end_date:
        return None, None

    c = compare.strip().upper().replace(" ", "_")
    if "LAST_YEAR" in c:
        try:
            return start_date.replace(year=start_date.year - 1), end_date.replace(year=end_date.year - 1)
        except ValueError:
            return start_date.replace(year=start_date.year - 1, day=28), end_date.replace(year=end_date.year - 1, day=28)

    if "PREVIOUS" in c:
        duration = (end_date - start_date).days + 1
        comp_end = start_date - timedelta(days=1)
        comp_start = comp_end - timedelta(days=duration - 1)
        return comp_start, comp_end

    return None, None


class DashboardService:
    # The cache is per warm worker and short-lived. It reduces repeated reads
    # without becoming a durable or cross-user source of financial data.
    _cache_lock = RLock()
    _summary_cache: Dict[Tuple[str, str, str, str], Tuple[float, Dict[str, Any]]] = {}
    _ageing_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}
    _trend_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}
    _static_counts_cache: Dict[Tuple[str, str], Tuple[float, int]] = {}

    @staticmethod
    def _get_schema_key(db: Optional[Session]) -> str:
        if db is None:
            return "master"
        try:
            bind = db.get_bind()
            trans_map = getattr(bind, "execution_options", {}).get("schema_translate_map", {})
            if trans_map and trans_map.get("master") == "demo":
                return "demo"
        except Exception:
            pass
        return "master"

    @classmethod
    def _get_static_count(cls, db: Session, model_class, cache_name: str, ttl: int = 60) -> int:
        schema = cls._get_schema_key(db)
        key = (schema, cache_name)
        with cls._cache_lock:
            cached = cls._static_counts_cache.get(key)
            if cached and cached[0] > monotonic():
                return cached[1]
        cnt = db.query(model_class).filter(model_class.active == "Y").count()
        with cls._cache_lock:
            cls._static_counts_cache[key] = (monotonic() + ttl, cnt)
        return cnt

    @classmethod
    def _cache_get(cls, cache: dict, key: Any) -> Optional[Dict[str, Any]]:
        with cls._cache_lock:
            cached = cache.get(key)
            if not cached:
                return None
            expires_at, value = cached
            if expires_at <= monotonic():
                cache.pop(key, None)
                return None
            return deepcopy(value)

    @classmethod
    def _cache_set(
        cls, cache: dict, key: Any, ttl_seconds: int, value: Dict[str, Any]
    ) -> Dict[str, Any]:
        with cls._cache_lock:
            cache[key] = (monotonic() + ttl_seconds, deepcopy(value))
        return value

    @classmethod
    def invalidate_cache(cls, company_id: Optional[UUID] = None) -> None:
        """Drop cached dashboard values after a financial write."""
        with cls._cache_lock:
            if company_id is None:
                cls._summary_cache.clear()
                cls._ageing_cache.clear()
                cls._trend_cache.clear()
                cls._static_counts_cache.clear()
                return
            company_key = str(company_id)
            for k in list(cls._ageing_cache):
                if k == company_key or (isinstance(k, tuple) and len(k) > 1 and k[1] == company_key):
                    cls._ageing_cache.pop(k, None)
            for k in list(cls._trend_cache):
                if k == company_key or (isinstance(k, tuple) and len(k) > 1 and k[1] == company_key):
                    cls._trend_cache.pop(k, None)
            for key in list(cls._summary_cache):
                if (isinstance(key, tuple) and len(key) > 1 and key[1] == company_key) or key[0] == company_key:
                    cls._summary_cache.pop(key, None)

    @classmethod
    def summary(
        cls,
        db: Session,
        company_id: Optional[UUID] = None,
        period: Optional[str] = None,
        compare: Optional[str] = None,
    ) -> Dict[str, Any]:
        schema = cls._get_schema_key(db)
        cache_key = (schema, str(company_id or ""), period or "", compare or "")
        cached = cls._cache_get(cls._summary_cache, cache_key)
        if cached is not None:
            return cached
        data = cls._summary_uncached(db, company_id, period, compare)
        return cls._cache_set(
            cls._summary_cache, cache_key, SUMMARY_CACHE_TTL_SECONDS, data
        )

    @classmethod
    def ageing(cls, db: Session, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        if company_id is None:
            return {"ar_ageing": _empty_ageing(), "ap_ageing": _empty_ageing()}
        schema = cls._get_schema_key(db)
        cache_key = (schema, str(company_id))
        cached = cls._cache_get(cls._ageing_cache, cache_key)
        if cached is not None:
            return cached
        data = {
            "ar_ageing": cls._compute_ar_ageing(db, company_id),
            "ap_ageing": cls._compute_ap_ageing(db, company_id),
        }
        return cls._cache_set(
            cls._ageing_cache, cache_key, AGEING_CACHE_TTL_SECONDS, data
        )

    @classmethod
    def trend(cls, db: Session, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        if company_id is None:
            return {"performance_trend": []}
        schema = cls._get_schema_key(db)
        cache_key = (schema, str(company_id or ""))
        cached = cls._cache_get(cls._trend_cache, cache_key)
        if cached is not None:
            return cached
        try:
            data = {"performance_trend": cls._compute_performance_trend(db, company_id)}
        except Exception as error:
            logger.warning("Error computing performance trend: %s", error)
            data = {"performance_trend": []}
        return cls._cache_set(
            cls._trend_cache, cache_key, SUMMARY_CACHE_TTL_SECONDS, data
        )

    @staticmethod
    def _ledger_balances(db: Session, company_id: Optional[UUID] = None) -> Dict[str, float]:
        """Net posted balance (debit - credit) per ledger, aggregated directly in the database."""
        try:
            from sqlalchemy import func, or_
            q = (
                db.query(
                    VoucherDetail.ledger_id,
                    func.coalesce(func.sum(VoucherDetail.debit_amount), 0),
                    func.coalesce(func.sum(VoucherDetail.credit_amount), 0),
                )
                .join(VoucherHeader, VoucherHeader.id == VoucherDetail.voucher_id)
                .filter(
                    VoucherDetail.active == "Y",
                    VoucherHeader.active == "Y",
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherDetail.ledger_id.isnot(None),
                )
            )
            if company_id:
                q = q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
            rows = q.group_by(VoucherDetail.ledger_id).all()
            return {
                str(r[0]): round(_to_float(r[1]) - _to_float(r[2]), 2)
                for r in rows
                if r[0] is not None
            }
        except Exception as e:
            logger.warning("Error computing ledger balances: %s", e)
            return {}

    @staticmethod
    def _summary_uncached(
        db: Session,
        company_id: Optional[UUID] = None,
        period: Optional[str] = None,
        compare: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not company_id:
            return {
                "financial_overview": {
                    "cash_bank_total": 0.0,
                    "revenue_total": 0.0,
                    "expenses_total": 0.0,
                    "net_profit": 0.0,
                    "profit_margin_pct": 0.0,
                    "target_pct": 0.0,
                },
                "performance_trend": [],
                "gst_estimate": {"output_tax": 0.0, "input_tax_credit": 0.0, "net_payable": 0.0, "status": "No company"},
                "chart_of_accounts": {"total_ledgers": 0, "inactive_ledgers": 0, "missing_grouping": 0, "groups": 0},
                "customers": {"total": 0, "missing_gstin": 0, "with_outstanding": 0, "overdue": 0, "receivable_total": 0.0, "with_credit_limit": 0},
                "vendors": {"total": 0, "missing_gstin": 0, "with_payable": 0, "payable": 0, "payable_total": 0.0},
                "ar_ageing": _empty_ageing(),
                "ap_ageing": _empty_ageing(),
                "products": {"total": 0, "inactive": 0, "gst_missing": 0, "low_stock": 0},
                "bank_cash": {"bank_accounts": 0, "cash_accounts": 0, "reconciliation_pending": 0, "reconciliation_status": "No company"},
                "gst_setup": {"rates": 0, "hsn_codes": 0, "configured": False, "status": "No company"},
                "cost_centers": {"total": 0, "departments": 0, "projects": 0, "branches": 0},
                "units": {"total": 0},
                "vouchers": {"posted_count": 0, "draft_count": 0, "cancelled_count": 0, "requires_approval": 0},
                "recent_activity": [],
                "health_score_pct": 100,
                "period": period or "",
                "compare": compare or "",
                "comparison": None,
            }
        from sqlalchemy import or_

        # Ensure default ledgers and voucher types exist for this company if newly selected
        if company_id:
            try:
                from app.core.init_db import (
                    seed_default_ledgers_for_company,
                    seed_default_voucher_types_for_company,
                )
                has_ledgers = db.query(Ledger).filter(Ledger.company_id == company_id).first() is not None
                if not has_ledgers:
                    seed_default_ledgers_for_company(db, company_id)
                    seed_default_voucher_types_for_company(db, company_id)
                    db.commit()
            except Exception as e:
                db.rollback()
                logger.warning("Notice auto-seeding company defaults: %s", e)

        # 1. Ledgers
        try:
            ledgers_q = db.query(Ledger)
            if company_id:
                ledgers_q = ledgers_q.filter(or_(Ledger.company_id == company_id, Ledger.company_id.is_(None)))
            ledgers = ledgers_q.all()
            active_ledgers = [l for l in ledgers if getattr(l, "active", "Y") == "Y"]
            grps = db.query(LedgerGroup).all()
            group_names = {str(g.id): (g.name or "").lower() for g in grps}
            groups_count = sum(1 for g in grps if getattr(g, "active", "Y") == "Y")
        except Exception as e:
            logger.warning("Error fetching ledgers: %s", e)
            ledgers, active_ledgers, groups_count, group_names = [], [], 0, {}

        # 2. Parties (Customers & Vendors)
        try:
            parties_q = db.query(Party)
            if company_id:
                parties_q = parties_q.filter(or_(Party.company_id == company_id, Party.company_id.is_(None)))
            parties = parties_q.all()

            def is_cust(p):
                return getattr(p, "key_group", "") in ("C", "B")

            def is_vend(p):
                return getattr(p, "key_group", "") in ("V", "B")

            customers = [p for p in parties if is_cust(p) and getattr(p, "active", "Y") == "Y"]
            vendors = [p for p in parties if is_vend(p) and getattr(p, "active", "Y") == "Y"]
        except Exception as e:
            logger.warning("Error fetching parties: %s", e)
            customers, vendors = [], []

        # 3. Ledger balances
        try:
            balances = DashboardService._ledger_balances(db, company_id)
        except Exception as e:
            logger.warning("Error computing ledger balances: %s", e)
            balances = {}

        def net_outstanding(p) -> float:
            add_info = _to_dict(getattr(p, "additional_info", None))
            opening = _to_float(add_info.get("opening_bal"), 0.0)
            posted = balances.get(str(p.ledger_id), 0.0) if getattr(p, "ledger_id", None) else 0.0
            return opening + posted

        cust_with_outstanding = sum(1 for p in customers if net_outstanding(p) > 0)
        receivable_total = sum(
            net_outstanding(p) for p in customers if net_outstanding(p) > 0
        )
        vend_with_payable = sum(1 for p in vendors if net_outstanding(p) < 0)
        payable_total = sum(
            -net_outstanding(p) for p in vendors if net_outstanding(p) < 0
        )

        # Ageing scans all posted invoices and settlement vouchers. It is
        # returned from /api/dashboard/ageing after this core summary so the
        # dashboard can render its primary data without waiting for that scan.
        ar_ageing = _empty_ageing()
        ap_ageing = _empty_ageing()

        # 5. Products / Items
        try:
            from sqlalchemy import and_, case, func

            items_q = db.query(
                func.count(ProductItem.id).label("total"),
                func.coalesce(
                    func.sum(
                        case((ProductItem.status == "Active", 1), else_=0)
                    ),
                    0,
                ).label("active"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    ProductItem.status == "Active",
                                    (ProductItem.gst_percent.is_(None))
                                    | (ProductItem.gst_percent == 0),
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("gst_missing"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    ProductItem.status == "Active",
                                    ProductItem.track_inventory == "Y",
                                    func.coalesce(ProductItem.opening_stock, 0)
                                    <= func.coalesce(ProductItem.min_stock_level, 0),
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("low_stock"),
            )
            if company_id:
                items_q = items_q.filter(or_(ProductItem.company_id == company_id, ProductItem.company_id.is_(None)))
            item_counts = items_q.one()
            total_items = int(item_counts.total or 0)
            active_items_count = int(item_counts.active or 0)
            gst_missing_count = int(item_counts.gst_missing or 0)
            low_stock_count = int(item_counts.low_stock or 0)
        except Exception as e:
            logger.warning("Error fetching items: %s", e)
            total_items = active_items_count = gst_missing_count = low_stock_count = 0

        # 6. Bank & Cash
        try:
            banks_q = db.query(BankAccount).filter(BankAccount.active == "Y")
            if company_id:
                banks_q = banks_q.outerjoin(Ledger, Ledger.id == BankAccount.ledger_id).filter(
                    or_(Ledger.company_id == company_id, Ledger.company_id.is_(None), BankAccount.ledger_id.is_(None))
                )
            banks = banks_q.all()
        except Exception as e:
            logger.warning("Error fetching banks: %s", e)
            banks = []

        bank_accounts = [b for b in banks if getattr(b, "account_type", "") != "CASH"]
        recon_pending = sum(
            1 for b in bank_accounts if abs(balances.get(str(getattr(b, "ledger_id", "")), 0.0)) > 0
        )
        recon_status = (
            "All reconciled"
            if recon_pending == 0
            else f"{recon_pending} pending"
        )

        # 7. GST Setup
        try:
            gst_rate_count = DashboardService._get_static_count(db, GstRate, "gst_rate")
            hsn_count = DashboardService._get_static_count(db, HsnCode, "hsn_code")
            gst_configured = gst_rate_count > 0 and hsn_count > 0
        except Exception as e:
            logger.warning("Error fetching gst setup: %s", e)
            gst_rate_count, hsn_count, gst_configured = 0, 0, False

        # 8. Cost Centers
        try:
            from sqlalchemy import case, func

            cc_counts = (
                db.query(
                    func.coalesce(func.sum(case((CostCenter.kind == "DEPARTMENT", 1), else_=0)), 0),
                    func.coalesce(func.sum(case((CostCenter.kind == "PROJECT", 1), else_=0)), 0),
                    func.coalesce(func.sum(case((CostCenter.kind == "BRANCH", 1), else_=0)), 0),
                )
                .filter(CostCenter.active == "Y")
                .one()
            )
            departments, projects, branches = (int(value or 0) for value in cc_counts)
        except Exception as e:
            logger.warning("Error fetching cost centers: %s", e)
            departments, projects, branches = 0, 0, 0

        # 9. Units
        try:
            units_count = DashboardService._get_static_count(db, UnitMaster, "units")
        except Exception as e:
            logger.warning("Error fetching units: %s", e)
            units_count = 0

        # 10. Vouchers
        try:
            from sqlalchemy import case, func

            vouchers_q = db.query(
                func.coalesce(func.sum(case((VoucherHeader.voucher_status == "DRAFT", 1), else_=0)), 0),
                func.coalesce(func.sum(case((VoucherHeader.voucher_status == "POSTED", 1), else_=0)), 0),
            ).filter(VoucherHeader.active == "Y")
            if company_id:
                vouchers_q = vouchers_q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
            voucher_counts = vouchers_q.one()
            draft_vouchers, posted_vouchers = (int(value or 0) for value in voucher_counts)
        except Exception as e:
            logger.warning("Error fetching vouchers count: %s", e)
            draft_vouchers, posted_vouchers = 0, 0

        # 11. Recent Activity
        try:
            recent = (
                db.query(AuditLog)
                .order_by(AuditLog.created_date.desc())
                .limit(10)
                .all()
            )
        except Exception as e:
            logger.warning("Error fetching recent activity: %s", e)
            recent = []

        # 12. Financial Overview, Performance Trend & GST Estimate
        try:
            financial_overview = DashboardService._compute_financial_overview(
                db, company_id, balances, banks, active_ledgers, period=period, compare=compare, group_names=group_names
            )
        except Exception as e:
            logger.warning("Error computing financial overview: %s", e)
            financial_overview = {
                "cash_bank_total": 0.0,
                "revenue_total": 0.0,
                "expenses_total": 0.0,
                "net_profit": 0.0,
                "profit_margin_pct": 0.0,
                "target_pct": 84,
            }

        performance_trend = []

        try:
            gst_estimate = DashboardService._compute_gst_estimate(
                db,
                company_id,
                period=period,
                precomputed_revenue=financial_overview.get("revenue_total"),
                precomputed_expenses=financial_overview.get("expenses_total"),
            )
        except Exception as e:
            logger.warning("Error computing gst estimate: %s", e)
            gst_estimate = {
                "output_tax": 0.0,
                "input_tax_credit": 0.0,
                "net_payable": 0.0,
                "status": "Before filing",
            }

        return {
            "financial_overview": financial_overview,
            "performance_trend": performance_trend,
            "gst_estimate": gst_estimate,
            "chart_of_accounts": {
                "total_ledgers": len(active_ledgers),
                "inactive_ledgers": len(ledgers) - len(active_ledgers),
                "missing_grouping": sum(
                    1 for l in active_ledgers if not getattr(l, "ledger_group_id", None)
                ),
                "groups": groups_count,
            },
            "customers": {
                "total": len(customers),
                "missing_gstin": sum(1 for p in customers if not getattr(p, "gstin", None)),
                "with_outstanding": cust_with_outstanding,
                "overdue": cust_with_outstanding,
                "receivable_total": round(receivable_total, 2),
                "with_credit_limit": sum(
                    1
                    for p in customers
                    if _to_float(_to_dict(getattr(p, "payment_info", None)).get("credit_limit")) > 0
                ),
            },
            "vendors": {
                "total": len(vendors),
                "missing_gstin": sum(1 for p in vendors if not getattr(p, "gstin", None)),
                "with_payable": vend_with_payable,
                "payable": vend_with_payable,
                "payable_total": round(payable_total, 2),
            },
            "ar_ageing": ar_ageing,
            "ap_ageing": ap_ageing,
            "products": {
                "total": active_items_count,
                "inactive": total_items - active_items_count,
                "gst_missing": gst_missing_count,
                "low_stock": low_stock_count,
            },
            "bank_cash": {
                "bank_accounts": len(financial_overview.get("bank_accounts", [])) if financial_overview.get("bank_accounts") else len(bank_accounts),
                "cash_accounts": len(financial_overview.get("cash_accounts", [])) if financial_overview.get("cash_accounts") else sum(1 for b in banks if getattr(b, "account_type", "") == "CASH"),
                "reconciliation_pending": recon_pending,
                "reconciliation_status": recon_status,
                "bank_total": financial_overview.get("bank_total", 0.0),
                "cash_total": financial_overview.get("cash_total", 0.0),
                "accounts": financial_overview.get("bank_accounts", []),
                "cash_details": financial_overview.get("cash_accounts", []),
            },
            "gst_setup": {
                "rates": gst_rate_count,
                "hsn_codes": hsn_count,
                "configured": gst_configured,
                "status": "Configured" if gst_configured else "Incomplete",
            },
            "cost_centers": {
                "total": departments + projects + branches,
                "departments": departments,
                "projects": projects,
                "branches": branches,
            },
            "units": {
                "total": units_count,
            },
            "vouchers": {
                "draft": draft_vouchers,
                "posted": posted_vouchers,
            },
            "recent_activity": [
                {
                    "entity": r.entity or "",
                    "entityName": r.entity_name or "",
                    "action": r.action or "",
                    "actor": r.actor,
                    "createdDate": r.created_date.isoformat() if r.created_date else None,
                }
                for r in recent
            ],
        }

    @staticmethod
    def _compute_financial_overview(
        db: Session,
        company_id: Optional[UUID],
        balances: Dict[str, float],
        banks: list,
        active_ledgers: list,
        period: Optional[str] = None,
        compare: Optional[str] = None,
        group_names: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Compute Cash & Bank, Revenue, Operating Expenses, Net Profit, and margin metrics."""
        from sqlalchemy import case, func, or_
        from app.models.voucher_header import VoucherHeader
        from app.models.voucher_type import VoucherType

        bank_total = 0.0
        cash_total = 0.0
        bank_accounts_list = []
        cash_accounts_list = []
        seen_ledger_ids = set()

        for b in banks:
            op = _to_float(getattr(b, "opening_balance", 0.0))
            lid = str(getattr(b, "ledger_id", ""))
            if lid:
                seen_ledger_ids.add(lid)
            net = balances.get(lid, 0.0)
            bal = op + net
            acct_type = (getattr(b, "account_type", "") or "").upper()
            if acct_type == "CASH":
                cash_total += bal
                cash_accounts_list.append({
                    "id": str(b.id),
                    "name": getattr(b, "bank_name", "") or getattr(b, "account_name", "Cash Account"),
                    "balance": round(bal, 2),
                })
            else:
                bank_total += bal
                bank_accounts_list.append({
                    "id": str(b.id),
                    "name": getattr(b, "bank_name", "") or getattr(b, "account_name", "Bank Account"),
                    "account_number": getattr(b, "account_number", "") or "",
                    "balance": round(bal, 2),
                })

        if group_names is None:
            from app.models.ledger_group import LedgerGroup
            try:
                grps = db.query(LedgerGroup).all()
                group_names = {str(g.id): (g.name or "").lower() for g in grps}
            except Exception:
                group_names = {}

        for l in active_ledgers:
            lid = str(l.id)
            if lid in seen_ledger_ids:
                continue

            gname = group_names.get(str(getattr(l, "ledger_group_id", "") or ""), "")
            lname = (getattr(l, "name", "") or "").lower()

            is_b = (
                getattr(l, "is_bank", "N") == "Y"
                or getattr(l, "category", "") == "bank"
                or "bank" in gname
                or ("bank" in lname and "charges" not in lname and "interest" not in lname)
            )
            is_c = (
                getattr(l, "is_cash", "N") == "Y"
                or getattr(l, "category", "") == "cash"
                or "cash" in gname
                or "cash" in lname
            )

            op = _to_float(getattr(l, "opening_balance", 0.0))
            net = balances.get(lid, 0.0)
            bal = op + net

            if is_b:
                seen_ledger_ids.add(lid)
                bank_total += bal
                bank_accounts_list.append({
                    "id": lid,
                    "name": getattr(l, "name", "Bank"),
                    "account_number": getattr(l, "hsn_sac", "") or "",
                    "balance": round(bal, 2),
                })
            elif is_c:
                seen_ledger_ids.add(lid)
                cash_total += bal
                cash_accounts_list.append({
                    "id": lid,
                    "name": getattr(l, "name", "Cash"),
                    "balance": round(bal, 2),
                })

        cash_bank_total = bank_total + cash_total

        start_date, end_date = _get_period_date_range(period)
        fd_str = start_date.isoformat() if start_date else None
        td_str = end_date.isoformat() if end_date else None
        from app.services.report_service import ReportService
        pnl = ReportService.profit_and_loss(
            db,
            from_date=fd_str,
            to_date=td_str,
            company_id=company_id,
        )
        revenue_total = _to_float(pnl.get("incomeTotal", 0.0))
        expenses_total = _to_float(pnl.get("expenseTotal", 0.0))
        net_profit = _to_float(pnl.get("netProfit", 0.0))
        margin_pct = round((net_profit / revenue_total * 100), 1) if revenue_total > 0 else 0.0
        # Calculate comparative period numbers if compare parameter is given
        comp_start, comp_end = _get_compare_date_range(period, compare)
        compare_revenue = 0.0
        compare_expenses = 0.0
        compare_net_profit = 0.0
        revenue_growth_pct = 0.0
        expenses_growth_pct = 0.0
        profit_growth_pct = 0.0
        if comp_start and comp_end:
            comp_pnl = ReportService.profit_and_loss(
                db,
                from_date=comp_start.isoformat(),
                to_date=comp_end.isoformat(),
                company_id=company_id,
            )
            compare_revenue = _to_float(comp_pnl.get("incomeTotal", 0.0))
            compare_expenses = _to_float(comp_pnl.get("expenseTotal", 0.0))
            compare_net_profit = _to_float(comp_pnl.get("netProfit", 0.0))
            revenue_growth_pct = round(((revenue_total - compare_revenue) / compare_revenue * 100), 1) if compare_revenue > 0 else 0.0
            expenses_growth_pct = round(((expenses_total - compare_expenses) / compare_expenses * 100), 1) if compare_expenses > 0 else 0.0
            profit_growth_pct = round(((net_profit - compare_net_profit) / abs(compare_net_profit) * 100), 1) if compare_net_profit != 0 else 0.0

        return {
            "cash_bank_total": round(cash_bank_total, 2),
            "bank_total": round(bank_total, 2),
            "cash_total": round(cash_total, 2),
            "bank_accounts": bank_accounts_list,
            "cash_accounts": cash_accounts_list,
            "revenue_total": round(revenue_total, 2),
            "expenses_total": round(expenses_total, 2),
            "net_profit": round(net_profit, 2),
            "profit_margin_pct": margin_pct,
            "target_pct": 84,
            "compare_revenue": round(compare_revenue, 2) if comp_start else None,
            "compare_expenses": round(compare_expenses, 2) if comp_start else None,
            "compare_net_profit": round(compare_net_profit, 2) if comp_start else None,
            "revenue_growth_pct": revenue_growth_pct,
            "expenses_growth_pct": expenses_growth_pct,
            "profit_growth_pct": profit_growth_pct,
        }

    @staticmethod
    def _compute_performance_trend(db: Session, company_id: Optional[UUID]) -> list:
        """Monthly performance trend for the last 6 months, using true accounting movements."""
        from datetime import date
        from sqlalchemy import case, extract, func, or_
        from app.models.voucher_header import VoucherHeader
        from app.models.voucher_detail import VoucherDetail
        from app.services.report_service import ReportService
        month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        today = date.today()
        cur_year, cur_month = today.year, today.month
        months = []
        for i in range(5, -1, -1):
            m = cur_month - i
            y = cur_year
            while m <= 0:
                m += 12
                y -= 1
            months.append((y, m))
        first_year, first_month = months[0]
        start_date = date(first_year, first_month, 1)
        end_date = (
            date(cur_year + 1, 1, 1)
            if cur_month == 12
            else date(cur_year, cur_month + 1, 1)
        )
        group_map = ReportService._group_map(db)
        ledgers = ReportService._get_ledgers(db, company_id)
        income_ids = [l.id for l in ledgers if ReportService._nature(l, group_map) == "INCOME"]
        expense_ids = [l.id for l in ledgers if ReportService._nature(l, group_map) == "EXPENSE"]
        year_expr = extract("year", VoucherHeader.voucher_date)
        month_expr = extract("month", VoucherHeader.voucher_date)
        inc_cond = VoucherDetail.ledger_id.in_(income_ids) if income_ids else False
        exp_cond = VoucherDetail.ledger_id.in_(expense_ids) if expense_ids else False
        inc_amount = case((inc_cond, VoucherDetail.credit_amount - VoucherDetail.debit_amount), else_=0)
        exp_amount = case((exp_cond, VoucherDetail.debit_amount - VoucherDetail.credit_amount), else_=0)
        trend_q = (
            db.query(
                year_expr.label("year"),
                month_expr.label("month"),
                func.coalesce(func.sum(inc_amount), 0).label("revenue"),
                func.coalesce(func.sum(exp_amount), 0).label("expenses"),
            )
            .join(VoucherHeader, VoucherHeader.id == VoucherDetail.voucher_id)
            .filter(
                VoucherDetail.active == "Y",
                VoucherHeader.voucher_status == "POSTED",
                VoucherHeader.active == "Y",
                VoucherHeader.voucher_date >= start_date,
                VoucherHeader.voucher_date < end_date,
            )
        )
        if company_id:
            trend_q = trend_q.filter(
                or_(
                    VoucherHeader.company_id == company_id,
                    VoucherHeader.company_id.is_(None),
                )
            )
        values = {
            (int(row.year), int(row.month)): (
                _to_float(row.revenue),
                _to_float(row.expenses),
            )
            for row in trend_q.group_by(year_expr, month_expr).all()
        }
        return [
            {
                "month": m_name,
                "year": y,
                "revenue": round(values.get((y, m), (0.0, 0.0))[0], 2),
                "expenses": round(values.get((y, m), (0.0, 0.0))[1], 2),
                "net_profit": round(
                    values.get((y, m), (0.0, 0.0))[0]
                    - values.get((y, m), (0.0, 0.0))[1],
                    2,
                ),
            }
            for y, m in months
            for m_name in (month_names[m - 1],)
        ]

    @staticmethod
    def _compute_gst_estimate(
        db: Session,
        company_id: Optional[UUID],
        period: Optional[str] = None,
        precomputed_revenue: Optional[float] = None,
        precomputed_expenses: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Compute estimated output GST vs ITC & net payable."""
        if precomputed_revenue is not None and precomputed_expenses is not None:
            sales_total = _to_float(precomputed_revenue)
            pur_total = _to_float(precomputed_expenses)
        else:
            from sqlalchemy import func, or_
            from app.models.voucher_header import VoucherHeader
            from app.models.voucher_type import VoucherType

            start_date, end_date = _get_period_date_range(period)

            sales_q = (
                db.query(func.coalesce(func.sum(func.coalesce(VoucherHeader.total_debit, VoucherHeader.total_credit)), 0))
                .outerjoin(VoucherType, VoucherType.id == VoucherHeader.voucher_type_id)
                .filter(
                    or_(
                        VoucherHeader.voucher_type == "SALES",
                        VoucherType.base_voucher_type == "SALES",
                    ),
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y",
                )
            )
            if company_id:
                sales_q = sales_q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
            if start_date:
                sales_q = sales_q.filter(VoucherHeader.voucher_date >= start_date)
            if end_date:
                sales_q = sales_q.filter(VoucherHeader.voucher_date <= end_date)
            sales_total = _to_float(sales_q.scalar())

            pur_q = (
                db.query(func.coalesce(func.sum(func.coalesce(VoucherHeader.total_debit, VoucherHeader.total_credit)), 0))
                .outerjoin(VoucherType, VoucherType.id == VoucherHeader.voucher_type_id)
                .filter(
                    or_(
                        VoucherHeader.voucher_type == "PURCHASE",
                        VoucherType.base_voucher_type == "PURCHASE",
                    ),
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y",
                )
            )
            if company_id:
                pur_q = pur_q.filter(or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None)))
            if start_date:
                pur_q = pur_q.filter(VoucherHeader.voucher_date >= start_date)
            if end_date:
                pur_q = pur_q.filter(VoucherHeader.voucher_date <= end_date)
            pur_total = _to_float(pur_q.scalar())

        output_tax = sales_total * 0.18
        input_tax_credit = pur_total * 0.18

        net_payable = max(0.0, output_tax - input_tax_credit)
        return {
            "output_tax": round(output_tax, 2),
            "input_tax_credit": round(input_tax_credit, 2),
            "net_payable": round(net_payable, 2),
            "status": "Before filing",
        }

    @staticmethod
    def _compute_ar_ageing(db: Session, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Compute document-level AR ageing for posted SALES vouchers with direct & FIFO receipt allocation."""
        try:
            from datetime import date
            from sqlalchemy import or_
            from sqlalchemy.orm import joinedload

            today = date.today()

            sales_q = (
                db.query(VoucherHeader)
                .outerjoin(VoucherType, VoucherType.id == VoucherHeader.voucher_type_id)
                .options(joinedload(VoucherHeader.details))
                .filter(
                    or_(
                        VoucherHeader.voucher_type == "SALES",
                        VoucherType.base_voucher_type == "SALES",
                    ),
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y",
                )
            )
            if company_id:
                sales_q = sales_q.filter(
                    or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None))
                )
            sales_vouchers = sales_q.order_by(VoucherHeader.voucher_date.asc(), VoucherHeader.created_date.asc()).all()

            if not sales_vouchers:
                return {
                    "total_outstanding": 0.0,
                    "not_due": 0.0,
                    "0_30": 0.0,
                    "31_60": 0.0,
                    "61_90": 0.0,
                    "90_plus": 0.0,
                    "open_document_count": 0,
                }

            receipts_q = (
                db.query(VoucherHeader)
                .outerjoin(VoucherType, VoucherType.id == VoucherHeader.voucher_type_id)
                .options(joinedload(VoucherHeader.details))
                .filter(
                    or_(
                        VoucherHeader.voucher_type == "RECEIPT",
                        VoucherType.base_voucher_type == "RECEIPT",
                    ),
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y",
                )
            )
            if company_id:
                receipts_q = receipts_q.filter(
                    or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None))
                )
            receipt_vouchers = receipts_q.all()

            # Track receipts linked directly to invoices vs. general receipts per customer ledger
            receipt_credits_by_doc: Dict[str, float] = {}
            party_general_receipts: Dict[str, float] = {}

            for r in receipt_vouchers:
                amt = _to_float(r.total_debit or r.total_credit, 0.0)
                if r.source_document_id:
                    doc_key = str(r.source_document_id)
                    receipt_credits_by_doc[doc_key] = receipt_credits_by_doc.get(doc_key, 0.0) + amt
                elif r.reference_no:
                    doc_key = r.reference_no.strip()
                    receipt_credits_by_doc[doc_key] = receipt_credits_by_doc.get(doc_key, 0.0) + amt
                else:
                    # Credit lines on receipt represent party settlement
                    for d in r.details:
                        if d.active != "N" and _to_float(d.credit_amount) > 0 and d.ledger_id:
                            lid = str(d.ledger_id)
                            party_general_receipts[lid] = party_general_receipts.get(lid, 0.0) + _to_float(d.credit_amount)

            buckets = {
                "not_due": 0.0,
                "0_30": 0.0,
                "31_60": 0.0,
                "61_90": 0.0,
                "90_plus": 0.0,
            }
            open_count = 0
            total_outstanding = 0.0

            for sv in sales_vouchers:
                invoice_amt = _to_float(sv.total_debit or sv.total_credit, 0.0)
                paid_amt = receipt_credits_by_doc.get(str(sv.id), 0.0)
                if sv.voucher_no and sv.voucher_no.strip() in receipt_credits_by_doc:
                    paid_amt += receipt_credits_by_doc[sv.voucher_no.strip()]

                # Determine party ledger from debit lines
                party_ledger_id = None
                for d in sv.details:
                    if d.active != "N" and _to_float(d.debit_amount) > 0 and d.ledger_id:
                        party_ledger_id = str(d.ledger_id)
                        break

                # Apply FIFO unallocated receipts if remaining
                outstanding = max(0.0, invoice_amt - paid_amt)
                if outstanding > 0.009 and party_ledger_id and party_ledger_id in party_general_receipts:
                    available_gen = party_general_receipts[party_ledger_id]
                    if available_gen > 0:
                        allocated = min(outstanding, available_gen)
                        outstanding -= allocated
                        party_general_receipts[party_ledger_id] -= allocated

                if outstanding > 0.009:
                    open_count += 1
                    total_outstanding += outstanding
                    due_raw = getattr(sv, "due_date", None) or getattr(sv, "voucher_date", None)
                    effective_due = _to_date(due_raw, default=today)
                    days_overdue = (today - effective_due).days
                    if days_overdue <= 0:
                        buckets["not_due"] += outstanding
                    elif 1 <= days_overdue <= 30:
                        buckets["0_30"] += outstanding
                    elif 31 <= days_overdue <= 60:
                        buckets["31_60"] += outstanding
                    elif 61 <= days_overdue <= 90:
                        buckets["61_90"] += outstanding
                    else:
                        buckets["90_plus"] += outstanding

            return {
                "total_outstanding": round(total_outstanding, 2),
                "not_due": round(buckets["not_due"], 2),
                "0_30": round(buckets["0_30"], 2),
                "31_60": round(buckets["31_60"], 2),
                "61_90": round(buckets["61_90"], 2),
                "90_plus": round(buckets["90_plus"], 2),
                "open_document_count": open_count,
            }
        except Exception as e:
            logger.warning("Error in _compute_ar_ageing: %s", e)
            return {
                "total_outstanding": 0.0,
                "not_due": 0.0,
                "0_30": 0.0,
                "31_60": 0.0,
                "61_90": 0.0,
                "90_plus": 0.0,
                "open_document_count": 0,
            }

    @staticmethod
    def _compute_ap_ageing(db: Session, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Compute document-level AP ageing for posted PURCHASE vouchers with direct & FIFO payment allocation."""
        try:
            from datetime import date
            from sqlalchemy import or_
            from sqlalchemy.orm import joinedload

            today = date.today()
            purchase_q = (
                db.query(VoucherHeader)
                .outerjoin(VoucherType, VoucherType.id == VoucherHeader.voucher_type_id)
                .options(joinedload(VoucherHeader.details))
                .filter(
                    or_(
                        VoucherHeader.voucher_type == "PURCHASE",
                        VoucherType.base_voucher_type == "PURCHASE",
                    ),
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y",
                )
            )
            if company_id:
                purchase_q = purchase_q.filter(
                    or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None))
                )
            purchase_vouchers = purchase_q.order_by(VoucherHeader.voucher_date.asc(), VoucherHeader.created_date.asc()).all()

            if not purchase_vouchers:
                return {
                    "total_outstanding": 0.0,
                    "not_due": 0.0,
                    "0_30": 0.0,
                    "31_60": 0.0,
                    "61_90": 0.0,
                    "90_plus": 0.0,
                    "open_document_count": 0,
                }

            payments_q = (
                db.query(VoucherHeader)
                .outerjoin(VoucherType, VoucherType.id == VoucherHeader.voucher_type_id)
                .options(joinedload(VoucherHeader.details))
                .filter(
                    or_(
                        VoucherHeader.voucher_type == "PAYMENT",
                        VoucherType.base_voucher_type == "PAYMENT",
                    ),
                    VoucherHeader.voucher_status == "POSTED",
                    VoucherHeader.active == "Y",
                )
            )
            if company_id:
                payments_q = payments_q.filter(
                    or_(VoucherHeader.company_id == company_id, VoucherHeader.company_id.is_(None))
                )
            payment_vouchers = payments_q.all()

            payment_debits_by_doc: Dict[str, float] = {}
            party_general_payments: Dict[str, float] = {}

            for p in payment_vouchers:
                amt = _to_float(p.total_debit or p.total_credit, 0.0)
                if p.source_document_id:
                    doc_key = str(p.source_document_id)
                    payment_debits_by_doc[doc_key] = payment_debits_by_doc.get(doc_key, 0.0) + amt
                elif p.reference_no:
                    doc_key = p.reference_no.strip()
                    payment_debits_by_doc[doc_key] = payment_debits_by_doc.get(doc_key, 0.0) + amt
                else:
                    # Debit lines on payment represent party settlement
                    for d in p.details:
                        if d.active != "N" and _to_float(d.debit_amount) > 0 and d.ledger_id:
                            lid = str(d.ledger_id)
                            party_general_payments[lid] = party_general_payments.get(lid, 0.0) + _to_float(d.debit_amount)

            buckets = {
                "not_due": 0.0,
                "0_30": 0.0,
                "31_60": 0.0,
                "61_90": 0.0,
                "90_plus": 0.0,
            }
            open_count = 0
            total_outstanding = 0.0

            for pv in purchase_vouchers:
                bill_amt = _to_float(pv.total_debit or pv.total_credit, 0.0)
                paid_amt = payment_debits_by_doc.get(str(pv.id), 0.0)
                if pv.voucher_no and pv.voucher_no.strip() in payment_debits_by_doc:
                    paid_amt += payment_debits_by_doc[pv.voucher_no.strip()]

                # Determine party ledger from credit lines
                party_ledger_id = None
                for d in pv.details:
                    if d.active != "N" and _to_float(d.credit_amount) > 0 and d.ledger_id:
                        party_ledger_id = str(d.ledger_id)
                        break

                # Apply FIFO unallocated payments if remaining
                outstanding = max(0.0, bill_amt - paid_amt)
                if outstanding > 0.009 and party_ledger_id and party_ledger_id in party_general_payments:
                    available_gen = party_general_payments[party_ledger_id]
                    if available_gen > 0:
                        allocated = min(outstanding, available_gen)
                        outstanding -= allocated
                        party_general_payments[party_ledger_id] -= allocated

                if outstanding > 0.009:
                    open_count += 1
                    total_outstanding += outstanding
                    due_raw = getattr(pv, "due_date", None) or getattr(pv, "voucher_date", None)
                    effective_due = _to_date(due_raw, default=today)
                    days_overdue = (today - effective_due).days
                    if days_overdue <= 0:
                        buckets["not_due"] += outstanding
                    elif 1 <= days_overdue <= 30:
                        buckets["0_30"] += outstanding
                    elif 31 <= days_overdue <= 60:
                        buckets["31_60"] += outstanding
                    elif 61 <= days_overdue <= 90:
                        buckets["61_90"] += outstanding
                    else:
                        buckets["90_plus"] += outstanding

            return {
                "total_outstanding": round(total_outstanding, 2),
                "not_due": round(buckets["not_due"], 2),
                "0_30": round(buckets["0_30"], 2),
                "31_60": round(buckets["31_60"], 2),
                "61_90": round(buckets["61_90"], 2),
                "90_plus": round(buckets["90_plus"], 2),
                "open_document_count": open_count,
            }
        except Exception as e:
            logger.warning("Error in _compute_ap_ageing: %s", e)
            return {
                "total_outstanding": 0.0,
                "not_due": 0.0,
                "0_30": 0.0,
                "31_60": 0.0,
                "61_90": 0.0,
                "90_plus": 0.0,
                "open_document_count": 0,
            }
