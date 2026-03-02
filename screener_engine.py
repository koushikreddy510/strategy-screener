#!/usr/bin/env python3
"""
screener_engine.py

Screener engine using pandas_ta for accurate indicator calculations.
Supports stocks (NSE) and commodities (MCX) across multiple timeframes.
Results are computed once and cached in-memory per run to avoid re-scanning
on every page request.
"""

import os
import json
import time
import hashlib
import numpy as np
import pandas as pd
import pandas_ta as ta
from typing import Optional, List, Dict, Any
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise RuntimeError("Please set DATABASE_URL environment variable")
engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20)

# ============================================================
# Table mapping
# ============================================================

TABLE_MAP = {
    "stocks": {
        "1D": {"table": "ohlcv_1d", "dt_col": "date", "dt_type": "date"},
    },
    "commodities": {
        "1D": {"table": "commodity_ohlcv_1d", "dt_col": "date", "dt_type": "date"},
        "4H": {"table": "commodity_ohlcv_4h", "dt_col": "datetime", "dt_type": "datetime"},
        "2H": {"table": "commodity_ohlcv_2h", "dt_col": "datetime", "dt_type": "datetime"},
        "1H": {"table": "commodity_ohlcv_1h", "dt_col": "datetime", "dt_type": "datetime"},
    },
}

SYMBOLS_TABLE_MAP = {
    "stocks": "ohlcv_1d",
    "commodities": "commodity_ohlcv_1d",
}

# ============================================================
# Indicator implementations via pandas_ta
# ============================================================

def ema_indicator(df: pd.DataFrame, length: int) -> pd.Series:
    return ta.ema(df["close"], length=length)

def rsi_indicator(df: pd.DataFrame, length: int) -> pd.Series:
    return ta.rsi(df["close"], length=length)

def supertrend_indicator(df: pd.DataFrame, period: int, multiplier: float) -> pd.DataFrame:
    st = ta.supertrend(df["high"], df["low"], df["close"], length=period, multiplier=multiplier)
    if st is None or st.empty:
        df = df.copy()
        df["supertrend"] = np.nan
        df["supertrend_dir"] = "bearish"
        return df

    st_col = [c for c in st.columns if c.startswith("SUPERT_")]
    dir_col = [c for c in st.columns if c.startswith("SUPERTd_")]

    df = df.copy()
    df["supertrend"] = st[st_col[0]].values if st_col else np.nan
    raw_dir = st[dir_col[0]].values if dir_col else np.ones(len(df))
    df["supertrend_dir"] = pd.Series(raw_dir).map({1: "bullish", -1: "bearish"}).fillna("bearish").values
    return df

def parabolic_sar_indicator(df: pd.DataFrame, af_start: float = 0.02, af_step: float = 0.02, af_max: float = 0.2) -> pd.DataFrame:
    psar = ta.psar(df["high"], df["low"], df["close"], af0=af_start, af=af_step, max_af=af_max)
    df = df.copy()

    if psar is None or psar.empty:
        df["psar"] = np.nan
        df["psar_dir"] = "bearish"
        return df

    long_col = [c for c in psar.columns if "PSARl_" in c]
    short_col = [c for c in psar.columns if "PSARs_" in c]

    psar_long = psar[long_col[0]] if long_col else pd.Series(np.nan, index=df.index)
    psar_short = psar[short_col[0]] if short_col else pd.Series(np.nan, index=df.index)

    df["psar"] = psar_long.combine_first(psar_short)
    df["psar_dir"] = np.where(psar_long.notna(), "bullish", "bearish")
    return df

def vwap_indicator(df: pd.DataFrame) -> pd.Series:
    result = ta.vwap(df["high"], df["low"], df["close"], df["volume"])
    if result is None:
        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        cum_tp_vol = (typical_price * df["volume"]).cumsum()
        cum_vol = df["volume"].cumsum()
        return cum_tp_vol / cum_vol
    return result

INDICATORS = {
    "ema": ema_indicator,
    "rsi": rsi_indicator,
    "supertrend": supertrend_indicator,
    "parabolic_sar": parabolic_sar_indicator,
    "vwap": vwap_indicator,
}

INDICATOR_METADATA = {
    "ema": {
        "params": {"length": {"type": "int", "default": 14, "min": 1}},
        "description": "Exponential Moving Average",
    },
    "rsi": {
        "params": {"length": {"type": "int", "default": 14, "min": 1}},
        "description": "Relative Strength Index",
    },
    "supertrend": {
        "params": {
            "period": {"type": "int", "default": 10, "min": 1},
            "multiplier": {"type": "float", "default": 3.0, "min": 0.1},
        },
        "description": "Supertrend (pandas_ta)",
    },
    "parabolic_sar": {
        "params": {
            "af_start": {"type": "float", "default": 0.02, "min": 0.001},
            "af_step": {"type": "float", "default": 0.02, "min": 0.001},
            "af_max": {"type": "float", "default": 0.2, "min": 0.01},
        },
        "description": "Parabolic SAR (pandas_ta)",
    },
    "vwap": {
        "params": {},
        "description": "Volume Weighted Average Price",
    },
}

# ============================================================
# Data loading
# ============================================================

def _get_table_info(market_type: str, timeframe: str) -> dict:
    mt = TABLE_MAP.get(market_type, TABLE_MAP["stocks"])
    return mt.get(timeframe, mt.get("1D"))

def load_strategies(market_type: str = None):
    if market_type:
        sql = "SELECT id, name, market_type, timeframe FROM strategies WHERE is_active = TRUE AND market_type = :mt;"
        with engine.connect() as conn:
            return [dict(row) for row in conn.execute(text(sql), {"mt": market_type})]
    sql = "SELECT id, name, market_type, timeframe FROM strategies WHERE is_active = TRUE;"
    with engine.connect() as conn:
        return [dict(row) for row in conn.execute(text(sql))]

def load_conditions(strategy_id: int):
    sql = """
    SELECT id, indicator_type, params, lookback_days, operator, threshold
      FROM strategy_conditions
     WHERE strategy_id = :sid;
    """
    with engine.connect() as conn:
        rows = conn.execute(text(sql), {"sid": strategy_id}).fetchall()
    conditions = []
    for row in rows:
        cond = row._asdict()
        cond["params"] = json.loads(cond["params"]) if isinstance(cond["params"], str) else cond["params"]
        cond["threshold"] = json.loads(cond["threshold"]) if isinstance(cond["threshold"], str) else cond["threshold"]
        conditions.append(cond)
    return conditions

def load_ohlc(symbol: str, market_type: str = "stocks", timeframe: str = "1D") -> pd.DataFrame:
    info = _get_table_info(market_type, timeframe)
    table = info["table"]
    dt_col = info["dt_col"]
    sql = f"""
    SELECT {dt_col}, open, high, low, close, volume
      FROM {table}
     WHERE tradingsymbol = :sym
  ORDER BY {dt_col};
    """
    with engine.connect() as conn:
        df = pd.read_sql(text(sql), conn, params={"sym": symbol}, index_col=dt_col, parse_dates=[dt_col])
    return df

def list_symbols(market_type: str = "stocks") -> list:
    table = SYMBOLS_TABLE_MAP.get(market_type, "ohlcv_1d")
    sql = f"SELECT DISTINCT tradingsymbol FROM {table};"
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(text(sql))]

def load_symbol_info(symbols: list) -> Dict[str, Dict]:
    """Load market_cap, listing_date, sector for given symbols from the symbols table."""
    if not symbols:
        return {}
    placeholders = ", ".join([f":s{i}" for i in range(len(symbols))])
    params = {f"s{i}": s for i, s in enumerate(symbols)}
    sql = f"""
    SELECT tradingsymbol, name,
           COALESCE(market_cap, 0) as market_cap,
           listing_date,
           COALESCE(sector, '') as sector
      FROM symbols
     WHERE tradingsymbol IN ({placeholders});
    """
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).fetchall()
    return {row[0]: {"name": row[1], "market_cap": float(row[2]), "listing_date": str(row[3]) if row[3] else None, "sector": row[4]} for row in rows}

def categorize_market_cap(mcap: float) -> str:
    if mcap <= 0:
        return "Unknown"
    if mcap >= 200_000_000_000:
        return "Large Cap"
    if mcap >= 50_000_000_000:
        return "Mid Cap"
    if mcap >= 10_000_000_000:
        return "Small Cap"
    return "Micro Cap"

# ============================================================
# Condition evaluation
# ============================================================

def get_threshold_value(threshold: dict, df: pd.DataFrame, series: pd.Series) -> float:
    if "value" in threshold:
        return threshold["value"]
    if "field" in threshold:
        return df[threshold["field"]].iloc[-1]
    return series.iloc[-1]

def evaluate_condition(cond: dict, df: pd.DataFrame) -> bool:
    indicator_type = cond["indicator_type"]
    params = cond["params"]
    lookback_days = cond["lookback_days"]
    operator = cond["operator"]
    threshold = cond["threshold"]

    try:
        if indicator_type == "supertrend":
            result = INDICATORS[indicator_type](df, **params)
            series = result["supertrend_dir"] if operator == "==" else result["supertrend"]
        elif indicator_type == "parabolic_sar":
            result = INDICATORS[indicator_type](df, **params)
            series = result["psar_dir"] if operator == "==" else result["psar"]
        elif indicator_type == "vwap":
            series = INDICATORS[indicator_type](df)
        else:
            series = INDICATORS[indicator_type](df, **params)

        if series is None:
            return False

        window = series.tail(lookback_days)
        if window.empty:
            return False

        latest = window.iloc[-1]
        if pd.isna(latest):
            return False

        previous = window.iloc[-2] if len(window) > 1 else None
        thresh = get_threshold_value(threshold, df, series)

        if operator == ">":
            return float(latest) > float(thresh)
        if operator == "<":
            return float(latest) < float(thresh)
        if operator == "==":
            if indicator_type in ("supertrend", "parabolic_sar"):
                return str(latest) == str(thresh)
            return False
        if operator == "cross_above" and previous is not None and not pd.isna(previous):
            return float(previous) <= float(thresh) < float(latest)
        if operator == "cross_below" and previous is not None and not pd.isna(previous):
            return float(previous) >= float(thresh) > float(latest)
    except Exception:
        return False

    return False

def compute_indicator_values(df: pd.DataFrame, conditions: list) -> Dict[str, Any]:
    values = {}
    seen_labels = set()
    for cond in conditions:
        indicator_type = cond["indicator_type"]
        params = cond["params"]

        label_parts = [indicator_type.upper()]
        if params:
            label_parts.append("(" + ", ".join(f"{v}" for v in params.values()) + ")")
        label = "".join(label_parts)

        if label in seen_labels:
            continue
        seen_labels.add(label)

        try:
            if indicator_type == "supertrend":
                result = INDICATORS[indicator_type](df, **params)
                val = result["supertrend"].iloc[-1]
                values[label] = round(float(val), 2) if not pd.isna(val) else None
                values[f"{label}_dir"] = result["supertrend_dir"].iloc[-1]
            elif indicator_type == "parabolic_sar":
                result = INDICATORS[indicator_type](df, **params)
                val = result["psar"].iloc[-1]
                values[label] = round(float(val), 2) if not pd.isna(val) else None
                values[f"{label}_dir"] = result["psar_dir"].iloc[-1]
            elif indicator_type == "vwap":
                val = INDICATORS[indicator_type](df)
                v = val.iloc[-1] if val is not None else None
                values[label] = round(float(v), 2) if v is not None and not pd.isna(v) else None
            else:
                series = INDICATORS[indicator_type](df, **params)
                v = series.iloc[-1] if series is not None else None
                values[label] = round(float(v), 2) if v is not None and not pd.isna(v) else None
        except Exception:
            values[label] = None

    return values

# ============================================================
# Chart data with indicator overlays
# ============================================================

def get_chart_data_with_indicators(
    symbol: str,
    market_type: str = "stocks",
    timeframe: str = "1D",
    indicator_configs: List[Dict] = None,
    limit: int = 200,
) -> List[Dict]:
    df = load_ohlc(symbol, market_type, timeframe)
    if df.empty:
        return []

    df = df.tail(limit).copy()
    df = df.reset_index()

    dt_col = "date" if "date" in df.columns else "datetime"
    df[dt_col] = df[dt_col].astype(str)

    if indicator_configs:
        for cfg in indicator_configs:
            ind_type = cfg.get("type", "")
            params = cfg.get("params", {})
            label = cfg.get("label", ind_type.upper())

            if ind_type not in INDICATORS:
                continue

            try:
                idx_df = df.set_index(dt_col)
                if ind_type == "supertrend":
                    result = INDICATORS[ind_type](idx_df, **params)
                    df[label] = result["supertrend"].values
                    df[f"{label}_dir"] = result["supertrend_dir"].values
                elif ind_type == "parabolic_sar":
                    result = INDICATORS[ind_type](idx_df, **params)
                    df[label] = result["psar"].values
                    df[f"{label}_dir"] = result["psar_dir"].values
                elif ind_type == "vwap":
                    val = INDICATORS[ind_type](idx_df)
                    df[label] = val.values if val is not None else np.nan
                else:
                    series = INDICATORS[ind_type](idx_df, **params)
                    df[label] = series.values if series is not None else np.nan
            except Exception:
                df[label] = np.nan

    records = df.to_dict(orient="records")
    for r in records:
        for k, v in list(r.items()):
            if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
                r[k] = None
    return records

# ============================================================
# Results cache — compute once, paginate from memory
# ============================================================

_results_cache: Dict[str, Dict] = {}
_CACHE_TTL = 300  # 5 minutes

def _cache_key(strategy_id: int, scan_days: Optional[int]) -> str:
    raw = f"{strategy_id}:{scan_days or 0}"
    return hashlib.md5(raw.encode()).hexdigest()

def _get_cached(key: str) -> Optional[List]:
    entry = _results_cache.get(key)
    if entry and (time.time() - entry["ts"]) < _CACHE_TTL:
        return entry["data"]
    return None

def _set_cache(key: str, data: List):
    _results_cache[key] = {"data": data, "ts": time.time()}
    if len(_results_cache) > 50:
        oldest = min(_results_cache, key=lambda k: _results_cache[k]["ts"])
        del _results_cache[oldest]

# ============================================================
# Screener execution
# ============================================================

def _build_stock_entry(
    sym: str, df: pd.DataFrame, conditions: list, matched: bool,
) -> Dict[str, Any]:
    """Build a single stock entry with OHLCV, indicators, and change %."""
    indicator_vals = compute_indicator_values(df, conditions)
    last_row = df.iloc[-1]
    close = float(last_row["close"])

    prev_close = float(df.iloc[-2]["close"]) if len(df) > 1 else close
    change_pct = round(((close - prev_close) / prev_close) * 100, 2) if prev_close else 0

    return {
        "symbol": sym,
        "close": round(close, 2),
        "open": round(float(last_row["open"]), 2),
        "high": round(float(last_row["high"]), 2),
        "low": round(float(last_row["low"]), 2),
        "volume": int(last_row["volume"]),
        "date": str(df.index[-1]),
        "change_pct": change_pct,
        "matched": matched,
        "indicators": indicator_vals,
    }


def run_strategy_for_api(
    strategy_id: int,
    scan_days: Optional[int] = None,
    page: int = 1,
    page_size: int = 15,
    market_type: str = "stocks",
    timeframe: str = "1D",
    matched_only: bool = True,
) -> Dict[str, Any]:
    cache_key = _cache_key(strategy_id, scan_days) + ("_all" if not matched_only else "_matched")
    cached = _get_cached(cache_key)

    if cached is None:
        conditions = load_conditions(strategy_id)
        if not conditions:
            return {"matches": [], "total": 0, "page": page, "page_size": page_size, "total_scanned": 0, "total_matched": 0}

        all_symbols = list_symbols(market_type)
        all_entries = []

        for sym in all_symbols:
            df = load_ohlc(sym, market_type, timeframe)
            if df.empty or len(df) < 5:
                continue

            is_matched = False

            if scan_days is not None and scan_days > 0:
                if len(df) < scan_days:
                    if not matched_only:
                        all_entries.append(_build_stock_entry(sym, df, conditions, False))
                    continue
                for i in range(1, scan_days + 1):
                    current_day_df = df.iloc[:len(df) - (i - 1)]
                    if current_day_df.empty:
                        continue
                    if all(evaluate_condition(c, current_day_df) for c in conditions):
                        is_matched = True
                        break
            else:
                is_matched = all(evaluate_condition(c, df) for c in conditions)

            if is_matched or not matched_only:
                all_entries.append(_build_stock_entry(sym, df, conditions, is_matched))

        # Enrich with market cap info for stocks
        if market_type == "stocks" and all_entries:
            try:
                sym_list = [m["symbol"] for m in all_entries]
                info_map = load_symbol_info(sym_list)
                for m in all_entries:
                    info = info_map.get(m["symbol"], {})
                    m["market_cap"] = info.get("market_cap", 0)
                    m["market_cap_category"] = categorize_market_cap(m["market_cap"])
                    m["company_name"] = info.get("name", "")
                    m["listing_date"] = info.get("listing_date")
                    m["sector"] = info.get("sector", "")
            except Exception:
                for m in all_entries:
                    m["market_cap"] = 0
                    m["market_cap_category"] = "Unknown"
                    m["company_name"] = ""
                    m["listing_date"] = None
                    m["sector"] = ""

        _set_cache(cache_key, all_entries)
        cached = all_entries

    total_scanned = len(cached)
    total_matched = sum(1 for m in cached if m.get("matched"))

    total = len(cached)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "matches": cached[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_scanned": total_scanned,
        "total_matched": total_matched,
    }

def invalidate_cache(strategy_id: int = None):
    """Clear cache for a strategy or all."""
    if strategy_id is None:
        _results_cache.clear()
    else:
        keys_to_remove = [k for k in _results_cache if str(strategy_id) in k]
        for k in keys_to_remove:
            del _results_cache[k]

def get_sector_overview(
    page: int = 1,
    page_size: int = 20,
    sector: Optional[str] = None,
    cap_filter: Optional[str] = None,
    mcap_min: Optional[float] = None,
    mcap_max: Optional[float] = None,
    sort_by: str = "market_cap",
    sort_dir: str = "desc",
    group_sectors: bool = False,
    parent_sector: Optional[str] = None,
) -> Dict[str, Any]:
    """Browse all stocks grouped by sector with market cap and latest price."""
    from sector_groups import get_parent_sector, PARENT_SECTORS

    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT s.tradingsymbol, s.name, COALESCE(s.market_cap, 0) as market_cap,
                   s.listing_date, COALESCE(s.sector, '') as sector,
                   o.close, o.volume, o.date
              FROM symbols s
              LEFT JOIN LATERAL (
                SELECT close, volume, date FROM ohlcv_1d
                 WHERE tradingsymbol = s.tradingsymbol
                 ORDER BY date DESC LIMIT 1
              ) o ON true
             WHERE s.tradingsymbol LIKE '%%-EQ'
        """)).fetchall()

    all_stocks = []
    all_sectors_set = set()
    for r in rows:
        sec = r[4] or "Unknown"
        all_sectors_set.add(sec)
        mcap = float(r[2])
        ps = get_parent_sector(sec)
        all_stocks.append({
            "symbol": r[0],
            "company_name": r[1] or "",
            "market_cap": mcap,
            "market_cap_category": categorize_market_cap(mcap),
            "listing_date": str(r[3]) if r[3] else None,
            "sector": sec,
            "parent_sector": ps,
            "close": round(float(r[5]), 2) if r[5] else None,
            "volume": int(r[6]) if r[6] else 0,
            "date": str(r[7]) if r[7] else None,
        })

    # Counts for chips — use parent sectors if grouped
    if group_sectors:
        sector_counts = {}
        for s in all_stocks:
            ps = s["parent_sector"]
            sector_counts[ps] = sector_counts.get(ps, 0) + 1
        sector_list = [ps for ps in PARENT_SECTORS if ps in sector_counts]
    else:
        sector_counts = {}
        for s in all_stocks:
            sec = s["sector"]
            sector_counts[sec] = sector_counts.get(sec, 0) + 1
        sector_list = sorted(all_sectors_set)

    # Filter by sector
    if group_sectors and parent_sector and parent_sector != "all":
        all_stocks = [s for s in all_stocks if s["parent_sector"] == parent_sector]
    elif not group_sectors and sector and sector != "all":
        all_stocks = [s for s in all_stocks if s["sector"] == sector]

    # Market cap range filter
    if mcap_min is not None or mcap_max is not None:
        lo = mcap_min if mcap_min is not None else 0
        hi = mcap_max if mcap_max is not None else float("inf")
        all_stocks = [s for s in all_stocks if lo <= s["market_cap"] <= hi]
    elif cap_filter and cap_filter != "all":
        all_stocks = [s for s in all_stocks if s["market_cap_category"].lower().replace(" ", "_") == cap_filter]

    reverse = sort_dir == "desc"
    sort_keys = {
        "market_cap": lambda s: s["market_cap"],
        "close": lambda s: s.get("close") or 0,
        "volume": lambda s: s.get("volume") or 0,
        "listing_date": lambda s: s.get("listing_date") or "0000-00-00",
    }
    if sort_by in sort_keys:
        all_stocks.sort(key=sort_keys[sort_by], reverse=reverse)

    total = len(all_stocks)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "stocks": all_stocks[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "sectors": sector_list,
        "sector_counts": sector_counts,
        "group_sectors": group_sectors,
    }

def scan_all_patterns(
    page: int = 1,
    page_size: int = 20,
    signal_filter: Optional[str] = None,
    pattern_filter: Optional[str] = None,
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    sort_by: str = "strength",
    sort_dir: str = "desc",
    lookback: int = 3,
) -> Dict[str, Any]:
    """Scan all stocks for candlestick patterns on 1D timeframe."""
    from candle_patterns import scan_patterns_for_symbol, PATTERN_REGISTRY

    cache_key = f"patterns:{signal_filter}:{pattern_filter}:{lookback}"
    cached = _get_cached(cache_key)

    if cached is None:
        all_symbols = list_symbols("stocks")
        all_results = []

        sym_info_map = {}
        try:
            sym_info_map = load_symbol_info(all_symbols)
        except Exception:
            pass

        for sym in all_symbols:
            df = load_ohlc(sym, "stocks", "1D")
            if df.empty or len(df) < 15:
                continue

            patterns = scan_patterns_for_symbol(df, lookback=lookback)
            if not patterns:
                continue

            last = df.iloc[-1]
            info = sym_info_map.get(sym, {})
            mcap = info.get("market_cap", 0)

            for p in patterns:
                all_results.append({
                    "symbol": sym,
                    "company_name": info.get("name", ""),
                    "close": round(float(last["close"]), 2),
                    "open": round(float(last["open"]), 2),
                    "high": round(float(last["high"]), 2),
                    "low": round(float(last["low"]), 2),
                    "volume": int(last["volume"]),
                    "date": str(df.index[-1]),
                    "market_cap": mcap,
                    "market_cap_category": categorize_market_cap(mcap),
                    "sector": info.get("sector", ""),
                    "pattern": p["pattern"],
                    "signal": p["signal"],
                    "strength": p["strength"],
                    "candles": p["candles"],
                    "group": p["group"],
                    "bar_date": p["bar_date"],
                })

        _set_cache(cache_key, all_results)
        cached = all_results

    filtered = list(cached)

    if signal_filter and signal_filter != "all":
        filtered = [r for r in filtered if r["signal"] == signal_filter]

    if pattern_filter and pattern_filter != "all":
        filtered = [r for r in filtered if r["pattern"] == pattern_filter]

    if cap_filter and cap_filter != "all":
        filtered = [r for r in filtered if r["market_cap_category"].lower().replace(" ", "_") == cap_filter]

    if sector_filter and sector_filter != "all":
        filtered = [r for r in filtered if r.get("sector", "") == sector_filter]

    reverse = sort_dir == "desc"
    if sort_by == "strength":
        filtered.sort(key=lambda r: r["strength"], reverse=reverse)
    elif sort_by == "market_cap":
        filtered.sort(key=lambda r: r["market_cap"], reverse=reverse)
    elif sort_by == "close":
        filtered.sort(key=lambda r: r["close"], reverse=reverse)
    elif sort_by == "volume":
        filtered.sort(key=lambda r: r["volume"], reverse=reverse)

    all_patterns = sorted(set(r["pattern"] for r in cached))
    all_sectors = sorted(set(r["sector"] for r in cached if r.get("sector")))

    pattern_counts = {}
    signal_counts = {"bullish": 0, "bearish": 0, "neutral": 0}
    for r in cached:
        pattern_counts[r["pattern"]] = pattern_counts.get(r["pattern"], 0) + 1
        signal_counts[r["signal"]] = signal_counts.get(r["signal"], 0) + 1

    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "results": filtered[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "patterns": all_patterns,
        "pattern_counts": pattern_counts,
        "signal_counts": signal_counts,
        "sectors": all_sectors,
    }


def run_screener():
    strategies = load_strategies()
    for strat in strategies:
        mt = strat.get("market_type", "stocks")
        tf = strat.get("timeframe", "1D")
        print(f"\n--- Strategy: {strat['name']} (ID: {strat['id']}, {mt}/{tf}) ---")
        conditions = load_conditions(strat["id"])
        symbols = list_symbols(mt)
        matches = []
        for sym in symbols:
            df = load_ohlc(sym, mt, tf)
            if df.empty:
                continue
            if all(evaluate_condition(c, df) for c in conditions):
                matches.append(sym)
        print("len of matches:", len(matches))
        print("Matches:", matches or "None")

if __name__ == "__main__":
    run_screener()
