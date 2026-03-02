"""
Data management engine: triggers OHLCV updates, symbol syncs, financials scrapes,
and sector enrichment. Supports both full and incremental modes.
Runs data-store scripts or inline logic depending on availability.
"""

import os
import sys
import time
import subprocess
import threading
from datetime import datetime, timedelta, date
from typing import Optional, Dict, Any
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

DATA_STORE_DIR = os.getenv("DATA_STORE_DIR", os.path.join(os.path.dirname(__file__), "..", "data-store"))

_running_jobs: Dict[str, Dict[str, Any]] = {}
_job_lock = threading.Lock()


def _job_status(job_id: str) -> dict:
    with _job_lock:
        j = _running_jobs.get(job_id)
        if not j:
            return {"job_id": job_id, "status": "not_found"}
        return {
            "job_id": job_id,
            "status": j["status"],
            "started_at": j.get("started_at"),
            "finished_at": j.get("finished_at"),
            "progress": j.get("progress", ""),
            "error": j.get("error"),
        }


def _run_in_thread(job_id: str, fn, *args, **kwargs):
    def wrapper():
        with _job_lock:
            _running_jobs[job_id]["status"] = "running"
        try:
            fn(*args, **kwargs)
            with _job_lock:
                _running_jobs[job_id]["status"] = "completed"
                _running_jobs[job_id]["finished_at"] = datetime.now().isoformat()
        except Exception as e:
            with _job_lock:
                _running_jobs[job_id]["status"] = "failed"
                _running_jobs[job_id]["error"] = str(e)
                _running_jobs[job_id]["finished_at"] = datetime.now().isoformat()

    with _job_lock:
        if job_id in _running_jobs and _running_jobs[job_id]["status"] == "running":
            return {"job_id": job_id, "status": "already_running"}
        _running_jobs[job_id] = {
            "status": "starting",
            "started_at": datetime.now().isoformat(),
            "finished_at": None,
            "progress": "",
            "error": None,
        }

    t = threading.Thread(target=wrapper, daemon=True)
    t.start()
    return {"job_id": job_id, "status": "started"}


def get_data_status() -> dict:
    """Get overview: symbol count, OHLCV coverage, financials coverage, last update dates."""
    with engine.connect() as conn:
        sym_count = conn.execute(text("SELECT COUNT(*) FROM symbols WHERE tradingsymbol LIKE '%-EQ'")).scalar()
        sym_with_sector = conn.execute(text(
            "SELECT COUNT(*) FROM symbols WHERE tradingsymbol LIKE '%-EQ' AND COALESCE(TRIM(sector), '') != ''"
        )).scalar()

        ohlcv_count = conn.execute(text("SELECT COUNT(DISTINCT tradingsymbol) FROM ohlcv_1d")).scalar()
        ohlcv_latest = conn.execute(text("SELECT MAX(date) FROM ohlcv_1d")).scalar()
        ohlcv_oldest = conn.execute(text("SELECT MIN(date) FROM ohlcv_1d")).scalar()

        fin_count = conn.execute(text("SELECT COUNT(DISTINCT tradingsymbol) FROM stock_financials")).scalar() or 0
        fin_latest = conn.execute(text("SELECT MAX(scraped_at) FROM stock_financials")).scalar()

        try:
            ann_count = conn.execute(text("SELECT COUNT(*) FROM result_announcements")).scalar() or 0
            ann_latest = conn.execute(text("SELECT MAX(result_date) FROM result_announcements")).scalar()
        except Exception:
            ann_count = 0
            ann_latest = None

        has_commodity = False
        try:
            comm_count = conn.execute(text("SELECT COUNT(DISTINCT tradingsymbol) FROM commodity_ohlcv_1d")).scalar()
            has_commodity = True
        except Exception:
            comm_count = 0

    return {
        "symbols": {
            "total": sym_count,
            "with_sector": sym_with_sector,
            "without_sector": sym_count - sym_with_sector,
        },
        "ohlcv": {
            "symbols_with_data": ohlcv_count,
            "latest_date": str(ohlcv_latest) if ohlcv_latest else None,
            "oldest_date": str(ohlcv_oldest) if ohlcv_oldest else None,
        },
        "financials": {
            "symbols_with_data": fin_count,
            "latest_scraped": str(fin_latest) if fin_latest else None,
        },
        "result_announcements": {
            "total": ann_count,
            "latest_date": str(ann_latest) if ann_latest else None,
        },
        "commodities": {
            "available": has_commodity,
            "symbols_with_data": comm_count if has_commodity else 0,
        },
        "running_jobs": {
            k: v["status"] for k, v in _running_jobs.items()
        },
    }


def sync_symbols(mode: str = "full") -> dict:
    """Sync symbols from Fyers master. Mode: 'full' re-downloads, 'check' just reports delta."""
    import requests
    import certifi
    from io import StringIO
    import pandas as pd

    FYERS_URL = "https://public.fyers.in/sym_details/NSE_CM.csv"
    resp = requests.get(FYERS_URL, verify=certifi.where(), timeout=30)
    resp.raise_for_status()
    df = pd.read_csv(StringIO(resp.text), header=None)
    symbols_df = df[[0, 1, 5, 9]].copy()
    symbols_df.columns = ["fyers_token", "name", "isin", "tradingsymbol"]
    symbols_df = symbols_df[symbols_df["tradingsymbol"].str.endswith("-EQ")]
    symbols_df = symbols_df.dropna(subset=["tradingsymbol"])

    with engine.connect() as conn:
        existing = set(r[0] for r in conn.execute(text("SELECT tradingsymbol FROM symbols")).fetchall())

    new_symbols = symbols_df[~symbols_df["tradingsymbol"].isin(existing)]
    removed = existing - set(symbols_df["tradingsymbol"].tolist())

    if mode == "check":
        return {
            "fyers_total": len(symbols_df),
            "db_total": len(existing),
            "new": len(new_symbols),
            "removed": len(removed),
            "new_symbols": new_symbols["tradingsymbol"].tolist()[:50],
            "removed_symbols": list(removed)[:50],
        }

    upsert_sql = """
    INSERT INTO symbols (tradingsymbol, fyers_token, name, isin, updated_at)
    VALUES (:ts, :ft, :name, :isin, now())
    ON CONFLICT (tradingsymbol) DO UPDATE SET
        fyers_token = EXCLUDED.fyers_token, name = EXCLUDED.name,
        isin = EXCLUDED.isin, updated_at = now()
    """
    with engine.connect() as conn:
        for row in symbols_df.itertuples(index=False):
            conn.execute(text(upsert_sql), {
                "ts": row.tradingsymbol, "ft": str(row.fyers_token),
                "name": row.name, "isin": row.isin,
            })
        conn.commit()

    return {
        "synced": len(symbols_df),
        "new": len(new_symbols),
        "removed": len(removed),
    }


def _update_ohlcv_job(mode: str = "incremental"):
    """OHLCV update job. 'incremental' fetches from last date; 'full' fetches 365 days."""
    try:
        from fyers_apiv3 import fyersModel
    except ImportError:
        raise RuntimeError("fyers_apiv3 not installed. pip install fyers-apiv3")

    client_id = os.getenv("FYERS_CLIENT_ID", "03VEQP97U0-100")
    token_file = os.getenv("FYERS_TOKEN_FILE", os.path.join(DATA_STORE_DIR, "fyers_access_token.txt"))

    if not os.path.exists(token_file):
        raise RuntimeError(f"Token file not found: {token_file}")
    with open(token_file) as f:
        token = f.read().strip()
    if not token:
        raise RuntimeError("Token file is empty")

    fyers = fyersModel.FyersModel(client_id=client_id, token=token, log_path=None)
    prof = fyers.get_profile()
    if not prof or prof.get("s") != "ok":
        raise RuntimeError(f"Fyers token invalid: {prof}")

    with engine.connect() as conn:
        symbols = [r[0] for r in conn.execute(text(
            "SELECT tradingsymbol FROM symbols ORDER BY tradingsymbol"
        )).fetchall()]

    today = date.today()

    if mode == "incremental":
        with engine.connect() as conn:
            last_date = conn.execute(text("SELECT MAX(date) FROM ohlcv_1d")).scalar()
        if last_date:
            range_from = (last_date - timedelta(days=2)).strftime("%Y-%m-%d")
        else:
            range_from = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    else:
        range_from = (today - timedelta(days=365)).strftime("%Y-%m-%d")

    range_to = today.strftime("%Y-%m-%d")

    upsert_sql = """
    INSERT INTO ohlcv_1d (tradingsymbol, date, open, high, low, close, volume, updated_at)
    VALUES (:ts, :dt, :o, :h, :l, :c, :v, now())
    ON CONFLICT (tradingsymbol, date) DO UPDATE SET
        open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
        close=EXCLUDED.close, volume=EXCLUDED.volume, updated_at=now()
    """

    success = 0
    failed = 0
    total = len(symbols)

    for i, symbol in enumerate(symbols, 1):
        with _job_lock:
            if "ohlcv" in _running_jobs:
                _running_jobs["ohlcv"]["progress"] = f"[{i}/{total}] {symbol}"
        try:
            resp = fyers.history(data={
                "symbol": symbol, "resolution": "1D", "date_format": "1",
                "range_from": range_from, "range_to": range_to, "cont_flag": "1",
            })
            if not resp or resp.get("s") != "ok":
                failed += 1
                time.sleep(0.3)
                continue
            candles = resp.get("candles", [])
            if not candles:
                time.sleep(0.3)
                continue
            with engine.connect() as conn:
                for c in candles:
                    ts, o, h, l, cl, v = c
                    dt = datetime.fromtimestamp(ts).date()
                    conn.execute(text(upsert_sql), {"ts": symbol, "dt": dt, "o": o, "h": h, "l": l, "c": cl, "v": int(v)})
                conn.commit()
            success += 1
        except Exception:
            failed += 1
        time.sleep(0.3)

    with _job_lock:
        if "ohlcv" in _running_jobs:
            _running_jobs["ohlcv"]["progress"] = f"Done: {success} OK, {failed} failed out of {total}"


def start_ohlcv_update(mode: str = "incremental") -> dict:
    return _run_in_thread("ohlcv", _update_ohlcv_job, mode)


def _update_financials_job(mode: str = "incremental", limit: int = 0):
    """Financials scrape from screener.in. 'incremental' skips recently scraped; 'full' does all."""
    import requests as rq
    from bs4 import BeautifulSoup

    SCREENER_BASE = "https://www.screener.in/company"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "text/html,application/xhtml+xml",
    }

    with engine.connect() as conn:
        symbols = [r for r in conn.execute(text(
            "SELECT tradingsymbol, isin FROM symbols ORDER BY tradingsymbol"
        )).fetchall()]

    if mode == "incremental":
        with engine.connect() as conn:
            recently_scraped = set(
                r[0] for r in conn.execute(text(
                    "SELECT DISTINCT tradingsymbol FROM stock_financials WHERE scraped_at > now() - interval '7 days'"
                )).fetchall()
            )
        symbols = [s for s in symbols if s[0] not in recently_scraped]

    if limit > 0:
        symbols = symbols[:limit]

    total = len(symbols)
    session = rq.Session()
    session.headers.update(HEADERS)
    success = 0
    failed = 0

    sys.path.insert(0, DATA_STORE_DIR)
    try:
        from scrape_financials import scrape_symbol, map_row_labels, parse_period_date, parse_number
        has_scraper = True
    except ImportError:
        has_scraper = False

    if not has_scraper:
        raise RuntimeError(f"scrape_financials.py not found in {DATA_STORE_DIR}")

    from scrape_financials import upsert_financials as _upsert, parse_period_date
    import psycopg

    ann_upsert_sql = """
    INSERT INTO result_announcements (nse_symbol, company_name, result_date, quarter, source, scraped_at)
    VALUES (:sym, :company, :dt, :q, 'screener.in', now())
    ON CONFLICT (nse_symbol, result_date, quarter)
    DO UPDATE SET company_name = EXCLUDED.company_name, scraped_at = now()
    """
    announcements_added = 0

    for i, row in enumerate(symbols, 1):
        tradingsymbol = row[0]
        nse_sym = tradingsymbol.split(":")[-1].replace("-EQ", "") if ":" in tradingsymbol else tradingsymbol.replace("-EQ", "")
        with _job_lock:
            if "financials" in _running_jobs:
                _running_jobs["financials"]["progress"] = f"[{i}/{total}] {nse_sym}"
        try:
            data = scrape_symbol(session, nse_sym)
            if not data or (len(data.get("quarterly", [])) == 0 and len(data.get("annual", [])) == 0):
                time.sleep(1)
                continue

            db_cfg = _parse_db_url(DATABASE_URL)
            conn = psycopg.connect(**db_cfg)
            conn.autocommit = False
            _upsert(conn, tradingsymbol, nse_sym, data)
            conn.close()

            company_name = data.get("company_name", "")
            quarterly = data.get("quarterly", [])
            if quarterly:
                latest_q = quarterly[0]
                period = latest_q.get("period", "")
                period_date = parse_period_date(period) if period else None
                if period_date:
                    try:
                        with engine.connect() as sa_conn:
                            sa_conn.execute(text(ann_upsert_sql), {
                                "sym": nse_sym, "company": company_name,
                                "dt": period_date, "q": period,
                            })
                            sa_conn.commit()
                        announcements_added += 1
                    except Exception:
                        pass

            success += 1
        except Exception:
            failed += 1
        time.sleep(1)

    with _job_lock:
        if "financials" in _running_jobs:
            _running_jobs["financials"]["progress"] = (
                f"Done: {success} OK, {failed} failed out of {total}. "
                f"{announcements_added} result announcements added."
            )


def _parse_db_url(url: str) -> dict:
    from urllib.parse import urlparse
    p = urlparse(url)
    return {
        "host": p.hostname or "localhost",
        "port": p.port or 5432,
        "dbname": p.path.lstrip("/"),
        "user": p.username or "market_user",
        "password": p.password or "market_pass",
    }


def start_financials_update(mode: str = "incremental", limit: int = 0) -> dict:
    return _run_in_thread("financials", _update_financials_job, mode, limit)


def _enrich_sectors_job():
    """Enrich symbols with sector/market_cap from NSE API."""
    import requests as rq

    NSE_QUOTE_URL = "https://www.nseindia.com/api/quote-equity"
    NSE_BASE_URL = "https://www.nseindia.com"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
        "Referer": "https://www.nseindia.com/",
    }

    session = rq.Session()
    session.headers.update(HEADERS)
    session.get(NSE_BASE_URL, timeout=10)

    with engine.connect() as conn:
        symbols = [r for r in conn.execute(text(
            "SELECT tradingsymbol, isin FROM symbols WHERE tradingsymbol LIKE '%-EQ' AND (COALESCE(TRIM(sector), '') = '' OR market_cap IS NULL OR market_cap = 0) ORDER BY tradingsymbol"
        )).fetchall()]

    total = len(symbols)
    success = 0
    failed = 0

    for i, row in enumerate(symbols, 1):
        ts = row[0]
        nse_sym = ts.split(":")[-1].replace("-EQ", "") if ":" in ts else ts.replace("-EQ", "")
        with _job_lock:
            if "sectors" in _running_jobs:
                _running_jobs["sectors"]["progress"] = f"[{i}/{total}] {nse_sym}"
        try:
            resp = session.get(NSE_QUOTE_URL, params={"symbol": nse_sym}, timeout=10)
            if resp.status_code == 401:
                session.get(NSE_BASE_URL, timeout=10)
                resp = session.get(NSE_QUOTE_URL, params={"symbol": nse_sym}, timeout=10)
            if resp.status_code != 200:
                failed += 1
                time.sleep(0.5)
                continue
            data = resp.json()
            metadata = data.get("metadata", {})
            security_info = data.get("securityInfo", {})
            mcap_raw = security_info.get("issuedSize", 0)
            last_price = data.get("priceInfo", {}).get("lastPrice", 0)
            market_cap = float(mcap_raw or 0) * float(last_price or 0)
            sector = metadata.get("industry", "") or data.get("info", {}).get("industry", "") or ""
            listing_date_str = metadata.get("listingDate")
            listing_date = None
            if listing_date_str:
                for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
                    try:
                        listing_date = datetime.strptime(listing_date_str, fmt).date()
                        break
                    except ValueError:
                        continue

            with engine.connect() as conn:
                conn.execute(text("""
                    UPDATE symbols SET market_cap=:mcap, listing_date=:ld, sector=:sec, updated_at=now()
                    WHERE tradingsymbol=:ts
                """), {"mcap": market_cap, "ld": listing_date, "sec": sector, "ts": ts})
                conn.commit()
            success += 1
        except Exception:
            failed += 1
        time.sleep(0.5)
        if i % 100 == 0:
            session = rq.Session()
            session.headers.update(HEADERS)
            session.get(NSE_BASE_URL, timeout=10)
            time.sleep(2)

    with _job_lock:
        if "sectors" in _running_jobs:
            _running_jobs["sectors"]["progress"] = f"Done: {success} OK, {failed} failed out of {total}"


def start_sector_enrichment() -> dict:
    return _run_in_thread("sectors", _enrich_sectors_job)


def _scrape_latest_results_job(days: int = 7):
    """Fetch latest financial result announcements from NSE corporate announcements."""
    import requests as rq
    import re

    NSE_BASE = "https://www.nseindia.com"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json, text/html",
        "Referer": "https://www.nseindia.com/",
    }
    RESULT_KEYWORDS = [
        "financial result", "quarterly", "unaudited", "audited",
        "half year", "annual result", "profit after tax",
    ]
    QUARTER_PATTERNS = [
        r"quarter\s+ended?\s+(\w+\s+\d{1,2},?\s+\d{4})",
        r"period\s+ended?\s+(\w+\s+\d{4})",
        r"(Q[1-4]\s*FY\s*\d{2,4})",
        r"(September|December|March|June)\s+\d{4}",
    ]

    session = rq.Session()
    session.headers.update(HEADERS)
    session.get(NSE_BASE, timeout=15)

    to_date = date.today()
    from_date = to_date - timedelta(days=days)
    fmt = "%d-%m-%Y"
    url = (
        f"{NSE_BASE}/api/corporate-announcements"
        f"?index=equities"
        f"&from_date={from_date.strftime(fmt)}"
        f"&to_date={to_date.strftime(fmt)}"
    )

    with _job_lock:
        if "latest_results" in _running_jobs:
            _running_jobs["latest_results"]["progress"] = f"Fetching NSE announcements ({days}d)..."

    resp = session.get(url, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"NSE API returned {resp.status_code}")
    announcements = resp.json()

    def is_financial_result(ann):
        desc = ann.get("desc", "").lower()
        text = ann.get("attchmntText", "").lower()
        combined = f"{desc} {text}"
        if "outcome of board meeting" in desc:
            return any(kw in combined for kw in RESULT_KEYWORDS)
        return "financial result" in desc

    def extract_quarter(text):
        for pattern in QUARTER_PATTERNS:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                return m.group(0).strip()
        return ""

    def parse_date(dt_str):
        try:
            return datetime.strptime(dt_str, "%d-%b-%Y %H:%M:%S").date()
        except (ValueError, TypeError):
            return None

    results = [a for a in announcements if is_financial_result(a)]

    with engine.connect() as conn:
        our_symbols = set()
        for r in conn.execute(text("SELECT tradingsymbol FROM symbols")).fetchall():
            sym = r[0]
            if ":" in sym:
                sym = sym.split(":")[1]
            if sym.endswith("-EQ"):
                sym = sym[:-3]
            our_symbols.add(sym)

    seen = set()
    saved = 0
    upsert_sql = """
    INSERT INTO result_announcements (nse_symbol, company_name, result_date, quarter, source, scraped_at)
    VALUES (:sym, :company, :dt, :q, 'nse', now())
    ON CONFLICT (nse_symbol, result_date, quarter)
    DO UPDATE SET company_name = EXCLUDED.company_name, scraped_at = now()
    """

    for i, ann in enumerate(results):
        symbol = ann.get("symbol", "")
        company = ann.get("sm_name", "")
        date_str = ann.get("an_dt", "")
        att_text = ann.get("attchmntText", "")

        result_date = parse_date(date_str)
        if not result_date:
            continue

        quarter = extract_quarter(att_text)
        key = (symbol, str(result_date), quarter)
        if key in seen:
            continue
        seen.add(key)

        with engine.connect() as conn:
            conn.execute(text(upsert_sql), {"sym": symbol, "company": company, "dt": result_date, "q": quarter})
            conn.commit()
        saved += 1

        with _job_lock:
            if "latest_results" in _running_jobs:
                tag = "★" if symbol in our_symbols else ""
                _running_jobs["latest_results"]["progress"] = f"[{i+1}/{len(results)}] {tag} {symbol}"

    with _job_lock:
        if "latest_results" in _running_jobs:
            _running_jobs["latest_results"]["progress"] = (
                f"Done: {saved} announcements from {len(announcements)} total NSE announcements ({days}d)"
            )


def start_latest_results_scrape(days: int = 7) -> dict:
    return _run_in_thread("latest_results", _scrape_latest_results_job, days)


def get_job_status(job_id: str) -> dict:
    return _job_status(job_id)


def get_all_jobs() -> dict:
    with _job_lock:
        return {
            k: {
                "status": v["status"],
                "started_at": v.get("started_at"),
                "finished_at": v.get("finished_at"),
                "progress": v.get("progress", ""),
                "error": v.get("error"),
            }
            for k, v in _running_jobs.items()
        }
