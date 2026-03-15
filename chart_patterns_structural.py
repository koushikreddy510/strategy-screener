"""
Structural chart patterns: triangle, wedge, cup and handle.
Pure Python/numpy/pandas — no external libraries.
Uses pivot highs/lows and slope analysis on OHLC data.
Works on 1D and weekly (aggregate 1D to 1W if needed).
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Optional, Tuple


def _pivot_highs(df: pd.DataFrame, left: int = 3, right: int = 3) -> pd.Series:
    """Pivot high: high is max of window."""
    h = df["high"]
    return h.rolling(left + right + 1, center=True).apply(
        lambda x: x[right] if len(x) == left + right + 1 and x[right] == max(x) else np.nan,
        raw=True,
    )


def _pivot_lows(df: pd.DataFrame, left: int = 3, right: int = 3) -> pd.Series:
    """Pivot low: low is min of window."""
    l = df["low"]
    return l.rolling(left + right + 1, center=True).apply(
        lambda x: x[right] if len(x) == left + right + 1 and x[right] == min(x) else np.nan,
        raw=True,
    )


def _slope(x: np.ndarray, y: np.ndarray) -> float:
    """Linear regression slope."""
    if len(x) < 2 or len(y) < 2:
        return 0.0
    x = np.array(x, dtype=float)
    y = np.array(y, dtype=float)
    mx, my = x.mean(), y.mean()
    denom = ((x - mx) ** 2).sum()
    if denom == 0:
        return 0.0
    return ((x - mx) * (y - my)).sum() / denom


def _intercept(x: np.ndarray, y: np.ndarray) -> float:
    """Linear regression intercept."""
    if len(x) < 2 or len(y) < 2:
        return 0.0
    x, y = np.array(x, dtype=float), np.array(y, dtype=float)
    return y.mean() - _slope(x, y) * x.mean()


def _line_points(x_vals: np.ndarray, y_vals: np.ndarray, i0: int, i1: int) -> List[Dict]:
    """Return points [(i, value), ...] for a fitted line from i0 to i1."""
    if len(x_vals) < 2 or len(y_vals) < 2:
        return []
    m = _slope(x_vals, y_vals)
    b = _intercept(x_vals, y_vals)
    return [{"i": i, "value": round(float(m * i + b), 2)} for i in range(int(i0), int(i1) + 1)]


def detect_ascending_triangle(df: pd.DataFrame, lookback: int = 30, min_touches: int = 2) -> Optional[Dict]:
    """
    Ascending triangle: flat resistance (horizontal line at highs), rising support (higher lows).
    Bullish continuation. Tighter criteria for accuracy.
    """
    if len(df) < lookback:
        return None
    window = df.tail(lookback).copy()
    ph = _pivot_highs(window, 2, 2)
    pl = _pivot_lows(window, 2, 2)
    ph_vals = ph.dropna()
    pl_vals = pl.dropna()
    if len(ph_vals) < min_touches or len(pl_vals) < min_touches:
        return None
    # Pivots should span at least 40% of window (by bar count)
    idx_to_pos = {idx: i for i, idx in enumerate(window.index)}
    ph_pos = [idx_to_pos.get(idx, 0) for idx in ph_vals.index]
    pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
    ph_span = max(ph_pos) - min(ph_pos) if len(ph_pos) > 1 else 0
    pl_span = max(pl_pos) - min(pl_pos) if len(pl_pos) > 1 else 0
    min_span = lookback * 0.4
    if ph_span < min_span or pl_span < min_span:
        return None
    ph_slope = _slope(np.arange(len(ph_vals)), ph_vals.values)
    pl_slope = _slope(np.arange(len(pl_vals)), pl_vals.values)
    flat_tolerance = (ph_vals.max() - ph_vals.min()) / (ph_vals.mean() + 1e-8) < 0.015
    rising_lows = pl_slope > 0
    if flat_tolerance and rising_lows:
        res_flat = ph_vals.mean()
        resistance = [{"i": i, "value": round(float(res_flat), 2)} for i in range(lookback)]
        support = _line_points(np.array(pl_pos), pl_vals.values, min(pl_pos), max(pl_pos))
        if len(support) < 2:
            support = [{"i": 0, "value": round(float(pl_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(pl_vals.iloc[-1]), 2)}]
        return {
            "pattern": "Ascending Triangle",
            "signal": "bullish",
            "strength": 2,
            "candles": lookback,
            "group": "structural",
            "bar_date": str(window.index[-1]),
            "lines": [{"type": "resistance", "points": resistance}, {"type": "support", "points": support}],
        }
    return None


def detect_descending_triangle(df: pd.DataFrame, lookback: int = 30, min_touches: int = 2) -> Optional[Dict]:
    """
    Descending triangle: flat support (horizontal lows), falling resistance (lower highs).
    Bearish continuation. Tighter criteria for accuracy.
    """
    if len(df) < lookback:
        return None
    window = df.tail(lookback).copy()
    ph = _pivot_highs(window, 2, 2)
    pl = _pivot_lows(window, 2, 2)
    ph_vals = ph.dropna()
    pl_vals = pl.dropna()
    if len(ph_vals) < min_touches or len(pl_vals) < min_touches:
        return None
    idx_to_pos = {idx: i for i, idx in enumerate(window.index)}
    ph_pos = [idx_to_pos.get(idx, 0) for idx in ph_vals.index]
    pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
    ph_span = max(ph_pos) - min(ph_pos) if len(ph_pos) > 1 else 0
    pl_span = max(pl_pos) - min(pl_pos) if len(pl_pos) > 1 else 0
    min_span = lookback * 0.4
    if ph_span < min_span or pl_span < min_span:
        return None
    ph_slope = _slope(np.arange(len(ph_vals)), ph_vals.values)
    pl_slope = _slope(np.arange(len(pl_vals)), pl_vals.values)
    flat_tolerance = (pl_vals.max() - pl_vals.min()) / (pl_vals.mean() + 1e-8) < 0.015
    falling_highs = ph_slope < 0
    if flat_tolerance and falling_highs:
        sup_flat = pl_vals.mean()
        support = [{"i": i, "value": round(float(sup_flat), 2)} for i in range(lookback)]
        resistance = _line_points(np.array(ph_pos), ph_vals.values, min(ph_pos), max(ph_pos))
        if len(resistance) < 2:
            resistance = [{"i": 0, "value": round(float(ph_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(ph_vals.iloc[-1]), 2)}]
        return {
            "pattern": "Descending Triangle",
            "signal": "bearish",
            "strength": 2,
            "candles": lookback,
            "group": "structural",
            "bar_date": str(window.index[-1]),
            "lines": [{"type": "resistance", "points": resistance}, {"type": "support", "points": support}],
        }
    return None


def detect_symmetrical_triangle(df: pd.DataFrame, lookback: int = 30, min_touches: int = 2) -> Optional[Dict]:
    """
    Symmetrical triangle: converging trendlines (lower highs, higher lows).
    Breakout direction decides bias; we report as neutral/consolidation. Tighter criteria.
    """
    if len(df) < lookback:
        return None
    window = df.tail(lookback).copy()
    ph = _pivot_highs(window, 2, 2)
    pl = _pivot_lows(window, 2, 2)
    ph_vals = ph.dropna()
    pl_vals = pl.dropna()
    if len(ph_vals) < min_touches or len(pl_vals) < min_touches:
        return None
    idx_to_pos = {idx: i for i, idx in enumerate(window.index)}
    ph_pos = [idx_to_pos.get(idx, 0) for idx in ph_vals.index]
    pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
    ph_span = max(ph_pos) - min(ph_pos) if len(ph_pos) > 1 else 0
    pl_span = max(pl_pos) - min(pl_pos) if len(pl_pos) > 1 else 0
    min_span = lookback * 0.4
    if ph_span < min_span or pl_span < min_span:
        return None
    ph_slope = _slope(np.arange(len(ph_vals)), ph_vals.values)
    pl_slope = _slope(np.arange(len(pl_vals)), pl_vals.values)
    converging = ph_slope < 0 and pl_slope > 0
    if converging:
        pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
        resistance = _line_points(np.array(ph_pos), ph_vals.values, 0, lookback - 1)
        support = _line_points(np.array(pl_pos), pl_vals.values, 0, lookback - 1)
        if len(resistance) < 2:
            resistance = [{"i": 0, "value": round(float(ph_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(ph_vals.iloc[-1]), 2)}]
        if len(support) < 2:
            support = [{"i": 0, "value": round(float(pl_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(pl_vals.iloc[-1]), 2)}]
        return {
            "pattern": "Symmetrical Triangle",
            "signal": "neutral",
            "strength": 2,
            "candles": lookback,
            "group": "structural",
            "bar_date": str(window.index[-1]),
            "lines": [{"type": "resistance", "points": resistance}, {"type": "support", "points": support}],
        }
    return None


def detect_rising_wedge(df: pd.DataFrame, lookback: int = 30, min_touches: int = 2) -> Optional[Dict]:
    """
    Rising wedge: both support and resistance slope up, but support steeper (converging).
    Often bearish reversal. Tighter convergence ratio for accuracy.
    """
    if len(df) < lookback:
        return None
    window = df.tail(lookback).copy()
    ph = _pivot_highs(window, 2, 2)
    pl = _pivot_lows(window, 2, 2)
    ph_vals = ph.dropna()
    pl_vals = pl.dropna()
    if len(ph_vals) < min_touches or len(pl_vals) < min_touches:
        return None
    idx_to_pos = {idx: i for i, idx in enumerate(window.index)}
    ph_pos = [idx_to_pos.get(idx, 0) for idx in ph_vals.index]
    pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
    ph_span = max(ph_pos) - min(ph_pos) if len(ph_pos) > 1 else 0
    pl_span = max(pl_pos) - min(pl_pos) if len(pl_pos) > 1 else 0
    min_span = lookback * 0.4
    if ph_span < min_span or pl_span < min_span:
        return None
    ph_slope = _slope(np.arange(len(ph_vals)), ph_vals.values)
    pl_slope = _slope(np.arange(len(pl_vals)), pl_vals.values)
    both_up = ph_slope > 0 and pl_slope > 0
    converging = pl_slope > ph_slope * 1.3
    if both_up and converging:
        pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
        resistance = _line_points(np.array(ph_pos), ph_vals.values, 0, lookback - 1)
        support = _line_points(np.array(pl_pos), pl_vals.values, 0, lookback - 1)
        if len(resistance) < 2:
            resistance = [{"i": 0, "value": round(float(ph_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(ph_vals.iloc[-1]), 2)}]
        if len(support) < 2:
            support = [{"i": 0, "value": round(float(pl_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(pl_vals.iloc[-1]), 2)}]
        return {
            "pattern": "Rising Wedge",
            "signal": "bearish",
            "strength": 2,
            "candles": lookback,
            "group": "structural",
            "bar_date": str(window.index[-1]),
            "lines": [{"type": "resistance", "points": resistance}, {"type": "support", "points": support}],
        }
    return None


def detect_falling_wedge(df: pd.DataFrame, lookback: int = 30, min_touches: int = 2) -> Optional[Dict]:
    """
    Falling wedge: both slope down, resistance steeper (converging).
    Often bullish reversal. Tighter convergence ratio for accuracy.
    """
    if len(df) < lookback:
        return None
    window = df.tail(lookback).copy()
    ph = _pivot_highs(window, 2, 2)
    pl = _pivot_lows(window, 2, 2)
    ph_vals = ph.dropna()
    pl_vals = pl.dropna()
    if len(ph_vals) < min_touches or len(pl_vals) < min_touches:
        return None
    idx_to_pos = {idx: i for i, idx in enumerate(window.index)}
    ph_pos = [idx_to_pos.get(idx, 0) for idx in ph_vals.index]
    pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
    ph_span = max(ph_pos) - min(ph_pos) if len(ph_pos) > 1 else 0
    pl_span = max(pl_pos) - min(pl_pos) if len(pl_pos) > 1 else 0
    min_span = lookback * 0.4
    if ph_span < min_span or pl_span < min_span:
        return None
    ph_slope = _slope(np.arange(len(ph_vals)), ph_vals.values)
    pl_slope = _slope(np.arange(len(pl_vals)), pl_vals.values)
    both_down = ph_slope < 0 and pl_slope < 0
    converging = abs(ph_slope) > abs(pl_slope) * 1.3
    if both_down and converging:
        pl_pos = [idx_to_pos.get(idx, 0) for idx in pl_vals.index]
        resistance = _line_points(np.array(ph_pos), ph_vals.values, 0, lookback - 1)
        support = _line_points(np.array(pl_pos), pl_vals.values, 0, lookback - 1)
        if len(resistance) < 2:
            resistance = [{"i": 0, "value": round(float(ph_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(ph_vals.iloc[-1]), 2)}]
        if len(support) < 2:
            support = [{"i": 0, "value": round(float(pl_vals.iloc[0]), 2)}, {"i": lookback - 1, "value": round(float(pl_vals.iloc[-1]), 2)}]
        return {
            "pattern": "Falling Wedge",
            "signal": "bullish",
            "strength": 2,
            "candles": lookback,
            "group": "structural",
            "bar_date": str(window.index[-1]),
            "lines": [{"type": "resistance", "points": resistance}, {"type": "support", "points": support}],
        }
    return None


def detect_cup_and_handle(df: pd.DataFrame, cup_lookback: int = 40, handle_lookback: int = 15) -> Optional[Dict]:
    """
    Cup and handle: U-shaped dip (cup) followed by small consolidation (handle).
    Bullish continuation. Cup ≈ 7–65 weeks classic; we use ~40 bars for 1D.
    """
    if len(df) < cup_lookback + handle_lookback:
        return None
    close = df["close"]
    low = df["low"]
    # Cup: find trough in the middle
    cup = close.iloc[-cup_lookback - handle_lookback : -handle_lookback]
    if len(cup) < 10:
        return None
    trough_idx = cup.idxmin()
    trough_val = cup.min()
    left_rim = cup.iloc[0]
    right_rim = cup.iloc[-1]
    cup_depth = max(left_rim, right_rim) - trough_val
    cup_depth_pct = cup_depth / (trough_val + 1e-8) * 100
    is_u = 12 < cup_depth_pct < 35
    similar_rims = abs(left_rim - right_rim) / (left_rim + 1e-8) < 0.03
    # Trough should be in middle third of cup (proper U-shape)
    trough_frac = list(cup.index).index(trough_idx) / max(1, len(cup) - 1) if trough_idx in cup.index else 0.5
    trough_centered = 0.3 <= trough_frac <= 0.7
    handle = close.iloc[-handle_lookback:]
    handle_high = handle.max()
    handle_low = handle.min()
    handle_tight = (handle_high - handle_low) / (handle.mean() + 1e-8) < 0.06
    breakout = close.iloc[-1] > right_rim
    if is_u and similar_rims and trough_centered and handle_tight and breakout:
        # Cup points: left rim (0), trough (middle), right rim (cup end); indices relative to full pattern window
        full_len = cup_lookback + handle_lookback
        trough_pos = list(cup.index).index(trough_idx) if trough_idx in cup.index else len(cup) // 2
        cup_points = [
            {"i": 0, "value": round(float(left_rim), 2)},
            {"i": trough_pos, "value": round(float(trough_val), 2)},
            {"i": len(cup) - 1, "value": round(float(right_rim), 2)},
        ]
        handle_start = len(cup)
        handle_points = [
            {"i": handle_start, "value": round(float(right_rim), 2)},
            {"i": full_len - 1, "value": round(float(close.iloc[-1]), 2)},
        ]
        return {
            "pattern": "Cup and Handle",
            "signal": "bullish",
            "strength": 3,
            "candles": full_len,
            "group": "structural",
            "bar_date": str(df.index[-1]),
            "lines": [
                {"type": "cup", "points": cup_points},
                {"type": "handle", "points": handle_points},
            ],
        }
    return None


STRUCTURAL_PATTERN_REGISTRY = {
    "Ascending Triangle": {"fn": detect_ascending_triangle, "signal": "bullish", "strength": 2},
    "Descending Triangle": {"fn": detect_descending_triangle, "signal": "bearish", "strength": 2},
    "Symmetrical Triangle": {"fn": detect_symmetrical_triangle, "signal": "neutral", "strength": 2},
    "Rising Wedge": {"fn": detect_rising_wedge, "signal": "bearish", "strength": 2},
    "Falling Wedge": {"fn": detect_falling_wedge, "signal": "bullish", "strength": 2},
    "Cup and Handle": {"fn": detect_cup_and_handle, "signal": "bullish", "strength": 3},
}


def scan_structural_patterns_for_symbol(
    df: pd.DataFrame, lookback: int = 30
) -> List[Dict]:
    """
    Scan for structural patterns (triangle, wedge, cup and handle).
    Returns list of detected pattern dicts.
    """
    if df is None or len(df) < 20:
        return []
    detected = []
    for name, meta in STRUCTURAL_PATTERN_REGISTRY.items():
        try:
            if name == "Cup and Handle":
                result = meta["fn"](df, cup_lookback=max(30, lookback), handle_lookback=min(15, lookback))
            else:
                result = meta["fn"](df, lookback=lookback)
            if result is not None:
                detected.append(result)
        except Exception:
            continue
    return detected
