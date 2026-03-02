"""
financials_engine.py

Separate engine for stock financial data (quarterly/annual results).
Reads from the stock_financials table — completely independent from
the screener/indicator engine.
"""

import os
from typing import Optional, List, Dict, Any
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("Please set DATABASE_URL environment variable")
engine = create_engine(DATABASE_URL, pool_size=5, max_overflow=10)


def get_financials_list(
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "revenue",
    sort_dir: str = "desc",
    result_type: str = "quarterly",
    sector: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get the latest financial result for each stock, with pagination.
    Returns one row per symbol (the most recent period).
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT ON (f.tradingsymbol)
                f.tradingsymbol, f.nse_symbol, f.company_name,
                f.period, f.period_end_date, f.result_type,
                f.revenue, f.expenses, f.operating_profit, f.opm_pct,
                f.other_income, f.interest, f.depreciation,
                f.profit_before_tax, f.tax, f.net_profit, f.npm_pct, f.eps,
                f.pe_ratio, f.pb_ratio, f.market_cap_cr,
                f.dividend_yield, f.roce_pct, f.roe_pct,
                f.revenue_growth_pct, f.profit_growth_pct,
                COALESCE(s.sector, '') as sector,
                COALESCE(s.market_cap, 0) as market_cap_raw
            FROM stock_financials f
            LEFT JOIN symbols s ON s.tradingsymbol = f.tradingsymbol
            WHERE f.result_type = :rtype
            ORDER BY f.tradingsymbol, f.period_end_date DESC NULLS LAST
        """), {"rtype": result_type}).fetchall()

    all_results = []
    for r in rows:
        all_results.append({
            "tradingsymbol": r[0],
            "nse_symbol": r[1],
            "company_name": r[2],
            "period": r[3],
            "period_end_date": str(r[4]) if r[4] else None,
            "result_type": r[5],
            "revenue": r[6],
            "expenses": r[7],
            "operating_profit": r[8],
            "opm_pct": r[9],
            "other_income": r[10],
            "interest": r[11],
            "depreciation": r[12],
            "profit_before_tax": r[13],
            "tax": r[14],
            "net_profit": r[15],
            "npm_pct": r[16],
            "eps": r[17],
            "pe_ratio": r[18],
            "pb_ratio": r[19],
            "market_cap_cr": r[20],
            "dividend_yield": r[21],
            "roce_pct": r[22],
            "roe_pct": r[23],
            "revenue_growth_pct": r[24],
            "profit_growth_pct": r[25],
            "sector": r[26],
            "market_cap_raw": float(r[27]),
        })

    if sector and sector != "all":
        from sector_groups import get_parent_sector
        all_results = [r for r in all_results if r["sector"] == sector or get_parent_sector(r["sector"]) == sector]

    if search:
        q = search.lower()
        all_results = [r for r in all_results if q in r["nse_symbol"].lower() or q in (r["company_name"] or "").lower()]

    # Sort
    reverse = sort_dir == "desc"
    sort_keys = {
        "revenue": lambda r: r.get("revenue") or 0,
        "net_profit": lambda r: r.get("net_profit") or 0,
        "operating_profit": lambda r: r.get("operating_profit") or 0,
        "opm_pct": lambda r: r.get("opm_pct") or 0,
        "npm_pct": lambda r: r.get("npm_pct") or 0,
        "eps": lambda r: r.get("eps") or 0,
        "pe_ratio": lambda r: r.get("pe_ratio") or 0,
        "pb_ratio": lambda r: r.get("pb_ratio") or 0,
        "market_cap_cr": lambda r: r.get("market_cap_cr") or 0,
        "revenue_growth_pct": lambda r: r.get("revenue_growth_pct") or 0,
        "profit_growth_pct": lambda r: r.get("profit_growth_pct") or 0,
        "roce_pct": lambda r: r.get("roce_pct") or 0,
        "roe_pct": lambda r: r.get("roe_pct") or 0,
    }
    if sort_by in sort_keys:
        all_results.sort(key=sort_keys[sort_by], reverse=reverse)

    total = len(all_results)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "results": all_results[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_symbol_financials(
    nse_symbol: str,
    result_type: str = "quarterly",
) -> Dict[str, Any]:
    """Get all quarterly or annual results for a single symbol, ordered by date."""
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                f.period, f.period_end_date, f.result_type,
                f.revenue, f.expenses, f.operating_profit, f.opm_pct,
                f.other_income, f.interest, f.depreciation,
                f.profit_before_tax, f.tax, f.net_profit, f.npm_pct, f.eps,
                f.pe_ratio, f.pb_ratio, f.market_cap_cr,
                f.dividend_yield, f.roce_pct, f.roe_pct,
                f.revenue_growth_pct, f.profit_growth_pct,
                f.company_name, f.tradingsymbol
            FROM stock_financials f
            WHERE f.nse_symbol = :sym AND f.result_type = :rtype
            ORDER BY f.period_end_date ASC NULLS LAST
        """), {"sym": nse_symbol.upper(), "rtype": result_type}).fetchall()

    results = []
    for r in rows:
        results.append({
            "period": r[0],
            "period_end_date": str(r[1]) if r[1] else None,
            "result_type": r[2],
            "revenue": r[3],
            "expenses": r[4],
            "operating_profit": r[5],
            "opm_pct": r[6],
            "other_income": r[7],
            "interest": r[8],
            "depreciation": r[9],
            "profit_before_tax": r[10],
            "tax": r[11],
            "net_profit": r[12],
            "npm_pct": r[13],
            "eps": r[14],
            "pe_ratio": r[15],
            "pb_ratio": r[16],
            "market_cap_cr": r[17],
            "dividend_yield": r[18],
            "roce_pct": r[19],
            "roe_pct": r[20],
            "revenue_growth_pct": r[21],
            "profit_growth_pct": r[22],
        })

    company_name = rows[0][23] if rows else ""
    tradingsymbol = rows[0][24] if rows else ""

    return {
        "nse_symbol": nse_symbol.upper(),
        "tradingsymbol": tradingsymbol,
        "company_name": company_name,
        "result_type": result_type,
        "results": results,
    }


def get_financials_summary() -> Dict[str, Any]:
    """Quick stats about the financials data we have."""
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT
                COUNT(DISTINCT tradingsymbol) as symbols,
                COUNT(*) as total_rows,
                COUNT(CASE WHEN result_type = 'quarterly' THEN 1 END) as quarterly_rows,
                COUNT(CASE WHEN result_type = 'annual' THEN 1 END) as annual_rows,
                MAX(scraped_at) as last_scraped
            FROM stock_financials
        """)).fetchone()

        sources_rows = conn.execute(text("""
            SELECT COALESCE(source, 'screener.in') as src, COUNT(DISTINCT tradingsymbol)
            FROM stock_financials
            GROUP BY COALESCE(source, 'screener.in')
        """)).fetchall()

    sources = {r[0]: r[1] for r in sources_rows}

    return {
        "total_symbols": row[0],
        "total_rows": row[1],
        "quarterly_rows": row[2],
        "annual_rows": row[3],
        "last_scraped": str(row[4]) if row[4] else None,
        "sources": sources,
    }


def get_latest_results(
    days: int = 7,
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    """
    Get recent result announcements from the result_announcements table,
    joined with financial data if available.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                ra.nse_symbol, ra.company_name, ra.result_date, ra.quarter,
                ra.source, ra.scraped_at,
                f.revenue, f.net_profit, f.opm_pct, f.npm_pct, f.eps,
                f.revenue_growth_pct, f.profit_growth_pct,
                f.pe_ratio, f.market_cap_cr,
                COALESCE(s.sector, '') as sector
            FROM result_announcements ra
            LEFT JOIN LATERAL (
                SELECT * FROM stock_financials sf
                WHERE sf.nse_symbol = ra.nse_symbol
                  AND sf.result_type = 'quarterly'
                ORDER BY sf.period_end_date DESC NULLS LAST
                LIMIT 1
            ) f ON true
            LEFT JOIN symbols s ON s.tradingsymbol = 'NSE:' || ra.nse_symbol || '-EQ'
            WHERE ra.result_date >= CURRENT_DATE - :days
            ORDER BY ra.result_date DESC, ra.scraped_at DESC
        """), {"days": days}).fetchall()

    all_results = []
    for r in rows:
        all_results.append({
            "nse_symbol": r[0],
            "company_name": r[1],
            "result_date": str(r[2]) if r[2] else None,
            "quarter": r[3],
            "source": r[4],
            "scraped_at": str(r[5]) if r[5] else None,
            "revenue": float(r[6]) if r[6] is not None else None,
            "net_profit": float(r[7]) if r[7] is not None else None,
            "opm_pct": float(r[8]) if r[8] is not None else None,
            "npm_pct": float(r[9]) if r[9] is not None else None,
            "eps": float(r[10]) if r[10] is not None else None,
            "revenue_growth_pct": float(r[11]) if r[11] is not None else None,
            "profit_growth_pct": float(r[12]) if r[12] is not None else None,
            "pe_ratio": float(r[13]) if r[13] is not None else None,
            "market_cap_cr": float(r[14]) if r[14] is not None else None,
            "sector": r[15],
        })

    total = len(all_results)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "results": all_results[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
