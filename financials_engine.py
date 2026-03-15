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


def get_financials_for_symbols(
    symbols: List[str],
    result_type: str = "quarterly",
) -> Dict[str, Dict[str, Any]]:
    """
    Batch fetch latest financials for a list of tradingsymbols.
    Returns dict: tradingsymbol -> { revenue, operating_profit, opm_pct, net_profit, npm_pct,
      pe_ratio, pb_ratio, eps, roce_pct, roe_pct, revenue_growth_pct, profit_growth_pct, peg, ... }
    PEG = P/E / earnings_growth (profit_growth_pct); None if unavailable.
    """
    if not symbols:
        return {}
    placeholders = ", ".join([f":s{i}" for i in range(len(symbols))])
    params = {f"s{i}": s for i, s in enumerate(symbols)}
    params["rtype"] = result_type

    with engine.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT DISTINCT ON (f.tradingsymbol)
                f.tradingsymbol, f.revenue, f.expenses, f.operating_profit, f.opm_pct,
                f.profit_before_tax, f.net_profit, f.npm_pct, f.eps,
                f.pe_ratio, f.pb_ratio, f.market_cap_cr,
                f.dividend_yield, f.roce_pct, f.roe_pct,
                f.revenue_growth_pct, f.profit_growth_pct,
                f.period, f.period_end_date
            FROM stock_financials f
            WHERE f.tradingsymbol IN ({placeholders}) AND f.result_type = :rtype
            ORDER BY f.tradingsymbol, f.period_end_date DESC NULLS LAST
        """), params).fetchall()

    out = {}
    for r in rows:
        pe = float(r[9]) if r[9] is not None else None
        pg = float(r[16]) if r[16] is not None else None  # profit_growth_pct
        peg = None
        if pe is not None and pg is not None and pg > 0:
            peg = round(pe / pg, 2)
        out[r[0]] = {
            "revenue": float(r[1]) if r[1] is not None else None,
            "expenses": float(r[2]) if r[2] is not None else None,
            "operating_profit": float(r[3]) if r[3] is not None else None,
            "opm_pct": float(r[4]) if r[4] is not None else None,
            "profit_before_tax": float(r[5]) if r[5] is not None else None,
            "net_profit": float(r[6]) if r[6] is not None else None,
            "npm_pct": float(r[7]) if r[7] is not None else None,
            "eps": float(r[8]) if r[8] is not None else None,
            "pe_ratio": pe,
            "pb_ratio": float(r[10]) if r[10] is not None else None,
            "market_cap_cr": float(r[11]) if r[11] is not None else None,
            "dividend_yield": float(r[12]) if r[12] is not None else None,
            "roce_pct": float(r[13]) if r[13] is not None else None,
            "roe_pct": float(r[14]) if r[14] is not None else None,
            "revenue_growth_pct": float(r[15]) if r[15] is not None else None,
            "profit_growth_pct": pg,
            "peg": peg,
            "period": r[17],
            "period_end_date": str(r[18]) if r[18] else None,
        }
    return out


def get_cagr_for_symbols(
    symbols: List[str],
    years: int = 3,
) -> Dict[str, Dict[str, Optional[float]]]:
    """
    Compute revenue and net_profit CAGR over last N years from annual results.
    Returns dict: tradingsymbol -> { revenue_cagr_pct, profit_cagr_pct }
    """
    if not symbols:
        return {}
    placeholders = ", ".join([f":s{i}" for i in range(len(symbols))])
    params = {f"s{i}": s for i, s in enumerate(symbols)}

    # Get annual results ordered by date descending (most recent first)
    with engine.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT f.tradingsymbol, f.period_end_date, f.revenue, f.net_profit
            FROM stock_financials f
            WHERE f.tradingsymbol IN ({placeholders}) AND f.result_type = 'annual'
              AND f.revenue IS NOT NULL AND f.net_profit IS NOT NULL
            ORDER BY f.tradingsymbol, f.period_end_date DESC NULLS LAST
        """), params).fetchall()

    # Group by symbol, take up to (years+1) rows to compute CAGR
    by_sym: Dict[str, List[tuple]] = {}
    for r in rows:
        sym = r[0]
        if sym not in by_sym:
            by_sym[sym] = []
        if len(by_sym[sym]) < years + 1:
            by_sym[sym].append((r[1], float(r[2]) if r[2] else 0, float(r[3]) if r[3] else 0))

    out = {}
    for sym, data in by_sym.items():
        rev_cagr, prof_cagr = None, None
        if len(data) >= 2:
            # data is most recent first: [latest, ..., oldest]
            start_rev = data[-1][1]
            end_rev = data[0][1]
            start_prof = data[-1][2]
            end_prof = data[0][2]
            n = min(len(data) - 1, years)
            if n > 0 and start_rev > 0:
                rev_cagr = round(((end_rev / start_rev) ** (1 / n) - 1) * 100, 1)
            if n > 0 and start_prof > 0 and end_prof > 0:
                prof_cagr = round(((end_prof / start_prof) ** (1 / n) - 1) * 100, 1)
        out[sym] = {"revenue_cagr_pct": rev_cagr, "profit_cagr_pct": prof_cagr}
    return out


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

        sources = {}
        try:
            sources_rows = conn.execute(text("""
                SELECT COALESCE(source, 'screener.in') as src, COUNT(DISTINCT tradingsymbol)
                FROM stock_financials
                GROUP BY COALESCE(source, 'screener.in')
            """)).fetchall()
            sources = {r[0]: r[1] for r in sources_rows}
        except Exception:
            # source column may not exist; run migrations/add_financials_source.sql
            if row and row[0]:
                sources = {"screener.in": row[0]}

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
    source: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get recent result announcements from the result_announcements table,
    joined with financial data if available.
    source: 'all' (default), 'nse', or 'screener.in' to filter by data source.
    """
    source_filter = ""
    params: Dict[str, Any] = {"days": days}
    if source and source in ("nse", "screener.in"):
        source_filter = " AND ra.source = :source"
        params["source"] = source

    with engine.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT
                ra.nse_symbol, ra.company_name, ra.result_date, ra.quarter,
                ra.source, ra.scraped_at,
                f.revenue, f.net_profit, f.opm_pct, f.npm_pct, f.eps,
                f.revenue_growth_pct, f.profit_growth_pct,
                f.pe_ratio, f.market_cap_cr,
                COALESCE(s.sector, '') as sector
            FROM result_announcements ra
            LEFT JOIN LATERAL (
                SELECT sf.revenue, sf.net_profit, sf.opm_pct, sf.npm_pct, sf.eps,
                       sf.revenue_growth_pct, sf.profit_growth_pct, sf.pe_ratio, sf.market_cap_cr
                FROM stock_financials sf
                WHERE sf.result_type = 'quarterly'
                  AND (
                    UPPER(TRIM(COALESCE(sf.nse_symbol, ''))) = UPPER(TRIM(ra.nse_symbol))
                    OR sf.tradingsymbol = 'NSE:' || UPPER(TRIM(ra.nse_symbol)) || '-EQ'
                  )
                ORDER BY sf.period_end_date DESC NULLS LAST
                LIMIT 1
            ) f ON true
            LEFT JOIN symbols s ON s.tradingsymbol = 'NSE:' || ra.nse_symbol || '-EQ'
            WHERE ra.result_date >= CURRENT_DATE - :days
            {source_filter}
            ORDER BY ra.result_date DESC, ra.scraped_at DESC
        """), params).fetchall()

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
