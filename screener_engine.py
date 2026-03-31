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


def macd_indicator(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    """MACD: returns DataFrame with macd_line, macd_signal, macd_hist."""
    res = ta.macd(df["close"], fast=fast, slow=slow, signal=signal)
    if res is None or res.empty:
        out = df[["close"]].copy()
        out["macd_line"] = np.nan
        out["macd_signal"] = np.nan
        out["macd_hist"] = np.nan
        return out[["macd_line", "macd_signal", "macd_hist"]]
    cols = list(res.columns)
    out = df[["close"]].copy()
    out["macd_line"] = res[cols[0]].values if len(cols) > 0 else np.nan
    out["macd_signal"] = res[cols[2]].values if len(cols) > 2 else np.nan
    out["macd_hist"] = res[cols[1]].values if len(cols) > 1 else np.nan
    return out[["macd_line", "macd_signal", "macd_hist"]]


def bollinger_indicator(df: pd.DataFrame, length: int = 20, std: float = 2.0) -> pd.DataFrame:
    """Bollinger Bands: returns lower, middle, upper, pct_b."""
    res = ta.bbands(df["close"], length=length, std=std)
    if res is None or res.empty:
        out = df[["close"]].copy()
        out["bb_lower"] = out["bb_middle"] = out["bb_upper"] = out["bb_pct"] = np.nan
        return out[["bb_lower", "bb_middle", "bb_upper", "bb_pct"]]
    cols = list(res.columns)
    out = df[["close"]].copy()
    out["bb_lower"] = res[cols[0]].values if len(cols) > 0 else np.nan
    out["bb_middle"] = res[cols[1]].values if len(cols) > 1 else np.nan
    out["bb_upper"] = res[cols[2]].values if len(cols) > 2 else np.nan
    out["bb_pct"] = res[cols[4]].values if len(cols) > 4 else np.nan  # BBP
    return out[["bb_lower", "bb_middle", "bb_upper", "bb_pct"]]


def atr_indicator(df: pd.DataFrame, length: int = 14) -> pd.Series:
    return ta.atr(df["high"], df["low"], df["close"], length=length)


def sma_indicator(df: pd.DataFrame, length: int) -> pd.Series:
    return ta.sma(df["close"], length=length)


def stochastic_indicator(df: pd.DataFrame, k: int = 14, d: int = 3) -> pd.DataFrame:
    """Stochastic %K and %D."""
    res = ta.stoch(df["high"], df["low"], df["close"], k=k, d=d)
    if res is None or res.empty:
        out = df[["close"]].copy()
        out["stoch_k"] = out["stoch_d"] = np.nan
        return out[["stoch_k", "stoch_d"]]
    cols = list(res.columns)
    out = df[["close"]].copy()
    out["stoch_k"] = res[cols[0]].values if len(cols) > 0 else np.nan
    out["stoch_d"] = res[cols[1]].values if len(cols) > 1 else np.nan
    return out[["stoch_k", "stoch_d"]]


INDICATORS = {
    "ema": ema_indicator,
    "sma": sma_indicator,
    "rsi": rsi_indicator,
    "macd": macd_indicator,
    "bollinger": bollinger_indicator,
    "atr": atr_indicator,
    "stochastic": stochastic_indicator,
    "supertrend": supertrend_indicator,
    "parabolic_sar": parabolic_sar_indicator,
    "vwap": vwap_indicator,
}

INDICATOR_METADATA = {
    "ema": {
        "params": {"length": {"type": "int", "default": 14, "min": 1}},
        "description": "Exponential Moving Average",
    },
    "sma": {
        "params": {"length": {"type": "int", "default": 20, "min": 1}},
        "description": "Simple Moving Average",
    },
    "rsi": {
        "params": {"length": {"type": "int", "default": 14, "min": 1}},
        "description": "Relative Strength Index",
    },
    "macd": {
        "params": {
            "fast": {"type": "int", "default": 12, "min": 1},
            "slow": {"type": "int", "default": 26, "min": 1},
            "signal": {"type": "int", "default": 9, "min": 1},
        },
        "description": "MACD (Moving Average Convergence Divergence). Uses macd_line by default.",
    },
    "bollinger": {
        "params": {
            "length": {"type": "int", "default": 20, "min": 1},
            "std": {"type": "float", "default": 2.0, "min": 0.1},
        },
        "description": "Bollinger Bands. Uses bb_pct (%B) by default. Or compare close to bb_lower/bb_upper.",
    },
    "atr": {
        "params": {"length": {"type": "int", "default": 14, "min": 1}},
        "description": "Average True Range (volatility)",
    },
    "stochastic": {
        "params": {
            "k": {"type": "int", "default": 14, "min": 1},
            "d": {"type": "int", "default": 3, "min": 1},
        },
        "description": "Stochastic Oscillator. Uses %K by default.",
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
    """Load OHLC. For stocks+1W, resamples from 1D (broker provides 1D only; 1W = aggregated)."""
    if market_type == "stocks" and timeframe == "1W":
        df = load_ohlc(symbol, market_type, "1D")
        if df.empty or len(df) < 5:
            return df
        df = df.sort_index()
        df.index.name = "date"
        # Resample to weekly: week ending Friday (India market convention)
        weekly = df.resample("W-FRI").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        weekly = weekly.dropna(subset=["close"], how="all")
        weekly.index.name = "date"
        return weekly
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
        elif indicator_type == "macd":
            result = INDICATORS[indicator_type](df, **params)
            out_key = params.get("output", "macd_line")
            series = result[out_key] if out_key in result.columns else result["macd_line"]
        elif indicator_type == "bollinger":
            result = INDICATORS[indicator_type](df, **params)
            out_key = params.get("output", "bb_pct")
            series = result[out_key] if out_key in result.columns else result["bb_pct"]
        elif indicator_type == "stochastic":
            result = INDICATORS[indicator_type](df, **params)
            out_key = params.get("output", "stoch_k")
            series = result[out_key] if out_key in result.columns else result["stoch_k"]
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
        if operator == ">=":
            return float(latest) >= float(thresh)
        if operator == "<":
            return float(latest) < float(thresh)
        if operator == "<=":
            return float(latest) <= float(thresh)
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
            elif indicator_type == "macd":
                result = INDICATORS[indicator_type](df, **params)
                out_key = params.get("output", "macd_line")
                v = result[out_key].iloc[-1] if out_key in result.columns else result["macd_line"].iloc[-1]
                values[label] = round(float(v), 4) if v is not None and not pd.isna(v) else None
            elif indicator_type == "bollinger":
                result = INDICATORS[indicator_type](df, **params)
                out_key = params.get("output", "bb_pct")
                v = result[out_key].iloc[-1] if out_key in result.columns else result["bb_pct"].iloc[-1]
                values[label] = round(float(v), 4) if v is not None and not pd.isna(v) else None
            elif indicator_type == "stochastic":
                result = INDICATORS[indicator_type](df, **params)
                out_key = params.get("output", "stoch_k")
                v = result[out_key].iloc[-1] if out_key in result.columns else result["stoch_k"].iloc[-1]
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
                elif ind_type == "macd":
                    result = INDICATORS[ind_type](idx_df, **params)
                    out_key = params.get("output", "macd_line")
                    df[label] = result[out_key].values if out_key in result.columns else result["macd_line"].values
                elif ind_type == "bollinger":
                    result = INDICATORS[ind_type](idx_df, **params)
                    df[f"{label}_lower"] = result["bb_lower"].values
                    df[f"{label}_mid"] = result["bb_middle"].values
                    df[f"{label}_upper"] = result["bb_upper"].values
                elif ind_type == "stochastic":
                    result = INDICATORS[ind_type](idx_df, **params)
                    df[f"{label}_k"] = result["stoch_k"].values
                    df[f"{label}_d"] = result["stoch_d"].values
                else:
                    series = INDICATORS[ind_type](idx_df, **params)
                    df[label] = series.values if hasattr(series, 'values') else np.nan
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
    from sector_groups import get_parent_sector, PARENT_SECTORS, SECTOR_INDICES

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
        "sector_indices": SECTOR_INDICES,
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
    """Scan all stocks for candlestick and structural patterns on 1D timeframe."""
    from candle_patterns import scan_patterns_for_symbol, PATTERN_REGISTRY
    from chart_patterns_structural import scan_structural_patterns_for_symbol

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
            structural = scan_structural_patterns_for_symbol(df, lookback=max(lookback * 5, 20))
            patterns = patterns + structural
            if not patterns:
                continue

            last = df.iloc[-1]
            info = sym_info_map.get(sym, {})
            mcap = info.get("market_cap", 0)

            closes = df["close"].tail(60)
            sparkline_data = [{"i": i, "close": round(float(v), 2)} for i, v in enumerate(closes.tolist())]

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
                    "sparkline": sparkline_data,
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
        from sector_groups import get_parent_sector, PARENT_SECTORS
        if sector_filter in PARENT_SECTORS:
            filtered = [r for r in filtered if get_parent_sector(r.get("sector", "")) == sector_filter]
        else:
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


# 52-week bars (~252 trading days)
WEEK_52_BARS = 252


def scan_52w_high_low(
    page: int = 1,
    page_size: int = 20,
    near_pct: Optional[float] = None,
    pct_from_high_min: Optional[float] = None,
    pct_from_high_max: Optional[float] = None,
    at_52w_high: bool = False,
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    sort_by: str = "pct_from_high",
    sort_dir: str = "asc",
    chart_bars: int = 120,
    chart_timeframe: str = "1D",
) -> Dict[str, Any]:
    """Scan all stocks for 52-week high/low.

    Distance from 52w high (pct_from_high = how far % close is below the 52w high):
    - near_pct: legacy — keep 0 <= pct_from_high <= near_pct (e.g. 5 = within 5% of high).
    - pct_from_high_min / pct_from_high_max: band (e.g. 5 and 10 = 5–10% below high).
    - at_52w_high: shorthand for within ~1% of the 52w high (tight to the high).
    If none of these are set, all stocks with valid 52w data are included (then cap/sector filters apply).
    """
    from sector_groups import get_parent_sector, PARENT_SECTORS

    # Full universe scan cached once per chart settings (not per distance filter).
    cache_key = f"52w_full:{chart_bars}:{chart_timeframe}"
    cached = _get_cached(cache_key)

    if cached is None:
        all_symbols = list_symbols("stocks")
        sym_info_map = {}
        try:
            sym_info_map = load_symbol_info(all_symbols)
        except Exception:
            pass

        results = []
        for sym in all_symbols:
            df = load_ohlc(sym, "stocks", "1D")
            if df.empty or len(df) < 52:
                continue
            win = df.tail(WEEK_52_BARS)
            high_52w = float(win["high"].max())
            low_52w = float(win["low"].min())
            close = float(df["close"].iloc[-1])
            if high_52w <= 0:
                continue
            pct_from_high = (high_52w - close) / high_52w * 100
            pct_from_low = (close - low_52w) / (low_52w or 1) * 100

            chart_df = load_ohlc(sym, "stocks", chart_timeframe).tail(chart_bars)
            if chart_df.empty or len(chart_df) < 5:
                chart_data = []
            else:
                chart_df = chart_df.reset_index()
                dt_col = "date" if "date" in chart_df.columns else chart_df.columns[0]
                chart_data = [{"date": str(row.get(dt_col, "")), "open": round(float(row["open"]), 2),
                    "high": round(float(row["high"]), 2), "low": round(float(row["low"]), 2),
                    "close": round(float(row["close"]), 2), "volume": int(row.get("volume", 0))}
                    for _, row in chart_df.iterrows()]

            info = sym_info_map.get(sym, {})
            mcap = info.get("market_cap", 0)
            sec = info.get("sector", "")
            results.append({
                "symbol": sym,
                "company_name": info.get("name", ""),
                "close": round(close, 2),
                "high_52w": round(high_52w, 2),
                "low_52w": round(low_52w, 2),
                "pct_from_high": round(pct_from_high, 2),
                "pct_from_low": round(pct_from_low, 2),
                "market_cap": mcap,
                "market_cap_category": categorize_market_cap(mcap),
                "sector": sec,
                "parent_sector": get_parent_sector(sec),
                "chart_data": chart_data,
            })

        _set_cache(cache_key, results)
        cached = results

    filtered = list(cached)

    # Distance from 52w high
    lo: Optional[float] = None
    hi: Optional[float] = None
    if at_52w_high:
        lo = pct_from_high_min if pct_from_high_min is not None else 0.0
        hi = pct_from_high_max if pct_from_high_max is not None else 1.0
    elif pct_from_high_min is not None or pct_from_high_max is not None:
        lo = pct_from_high_min
        hi = pct_from_high_max
    elif near_pct is not None:
        lo, hi = 0.0, near_pct

    if lo is not None:
        filtered = [r for r in filtered if r["pct_from_high"] >= lo]
    if hi is not None:
        filtered = [r for r in filtered if r["pct_from_high"] <= hi]

    if cap_filter and cap_filter != "all":
        filtered = [r for r in filtered if r["market_cap_category"].lower().replace(" ", "_") == cap_filter]
    if sector_filter and sector_filter != "all":
        if sector_filter in PARENT_SECTORS:
            filtered = [r for r in filtered if get_parent_sector(r.get("sector", "")) == sector_filter]
        else:
            filtered = [r for r in filtered if r.get("sector", "") == sector_filter]

    reverse = sort_dir == "desc"
    if sort_by == "pct_from_high":
        filtered.sort(key=lambda r: r["pct_from_high"], reverse=reverse)
    elif sort_by == "pct_from_low":
        filtered.sort(key=lambda r: r["pct_from_low"], reverse=reverse)
    elif sort_by == "close":
        filtered.sort(key=lambda r: r["close"], reverse=reverse)
    elif sort_by == "market_cap":
        filtered.sort(key=lambda r: r["market_cap"], reverse=reverse)

    all_sectors = sorted(set(r.get("sector", "") for r in cached if r.get("sector")))
    parent_present = {get_parent_sector(r.get("sector", "")) for r in cached if r.get("sector")}
    parent_sectors = [p for p in PARENT_SECTORS if p in parent_present]

    screen_label = "52w_high_low"
    if at_52w_high:
        screen_label = "at_52w_high"
    elif pct_from_high_min is not None or pct_from_high_max is not None:
        screen_label = "52w_high_band"
    elif near_pct is not None:
        screen_label = "near_52w_high"

    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "results": filtered[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "sectors": all_sectors,
        "parent_sectors": parent_sectors,
        "screen": screen_label,
    }


def scan_structural_patterns(
    page: int = 1,
    page_size: int = 20,
    signal_filter: Optional[str] = None,
    pattern_filter: Optional[str] = None,
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    sort_by: str = "strength",
    sort_dir: str = "desc",
    lookback: int = 25,
    timeframe: str = "1D",
    chart_bars: int = 120,
) -> Dict[str, Any]:
    """Scan all stocks for structural patterns (triangles, wedges, cup & handle).
    Returns chart_data + pattern_lines for each detection so the pattern can be drawn on the chart.
    timeframe: 1D or 1W (1W = resampled from 1D). chart_bars: bars to include in chart."""
    from chart_patterns_structural import scan_structural_patterns_for_symbol

    cache_key = f"structural:{signal_filter}:{pattern_filter}:{lookback}:{timeframe}:{chart_bars}"
    cached = _get_cached(cache_key)

    if cached is None:
        all_symbols = list_symbols("stocks")
        all_results = []
        sym_info_map = {}
        try:
            sym_info_map = load_symbol_info(all_symbols)
        except Exception:
            pass

        lb = max(lookback, 20)
        min_bars = chart_bars
        # For 1W: ~52 weeks from 1 year of daily data; require only ~30 bars for pattern detection
        if timeframe == "1W":
            min_bars = 30

        for sym in all_symbols:
            df = load_ohlc(sym, "stocks", timeframe)
            if df.empty or len(df) < min_bars:
                continue

            pattern_lb = max(lb, 20) if timeframe == "1W" else max(lb * 2, 40)
            patterns = scan_structural_patterns_for_symbol(df, lookback=pattern_lb)
            patterns = [p for p in patterns if p.get("group") == "structural"]
            if not patterns:
                continue

            last = df.iloc[-1]
            info = sym_info_map.get(sym, {})
            mcap = info.get("market_cap", 0)
            n_chart = min(chart_bars, len(df))
            chart_df = df.tail(n_chart).reset_index()
            dt_col = "date" if "date" in chart_df.columns else "datetime"
            chart_df[dt_col] = chart_df[dt_col].astype(str)
            chart_data = []
            for _, row in chart_df.iterrows():
                chart_data.append({
                    "date": str(row.get(dt_col, row.get("datetime", ""))),
                    "open": round(float(row["open"]), 2),
                    "high": round(float(row["high"]), 2),
                    "low": round(float(row["low"]), 2),
                    "close": round(float(row["close"]), 2),
                    "volume": int(row.get("volume", 0)),
                })

            for p in patterns:
                lines = p.get("lines") or []
                # Convert line indices to chart-relative: pattern uses last candles bars
                candles = p.get("candles", lb)
                offset = n_chart - candles
                adjusted_lines = []
                for line in lines:
                    adjusted_points = [{"i": pt["i"] + offset, "value": pt["value"]} for pt in line.get("points", [])]
                    adjusted_lines.append({"type": line.get("type", ""), "points": adjusted_points})

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
                    "candles": candles,
                    "group": p["group"],
                    "bar_date": p["bar_date"],
                    "chart_data": chart_data,
                    "pattern_lines": adjusted_lines,
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
        from sector_groups import get_parent_sector, PARENT_SECTORS
        if sector_filter in PARENT_SECTORS:
            filtered = [r for r in filtered if get_parent_sector(r.get("sector", "")) == sector_filter]
        else:
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

    from sector_groups import get_parent_sector as _gps, PARENT_SECTORS as _PS

    all_patterns = sorted(set(r["pattern"] for r in cached))
    all_sectors = sorted(set(r["sector"] for r in cached if r.get("sector")))
    _pp = {_gps(r.get("sector", "")) for r in cached if r.get("sector")}
    parent_sectors_struct = [p for p in _PS if p in _pp]
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
        "parent_sectors": parent_sectors_struct,
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
