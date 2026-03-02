"""
candle_patterns.py

Pure-Python candlestick pattern detection on OHLC DataFrames.
Each detector returns a dict with pattern name, signal (bullish/bearish/neutral),
and strength (1-3).

Patterns are grouped into:
  - Single candle: Doji, Hammer, Inverted Hammer, Shooting Star, Marubozu, Spinning Top
  - Double candle: Engulfing, Harami, Piercing Line, Dark Cloud Cover, Tweezer Top/Bottom
  - Triple candle: Morning Star, Evening Star, Three White Soldiers, Three Black Crows
"""

import numpy as np
import pandas as pd


def _body(o, c):
    return abs(c - o)

def _upper_shadow(h, o, c):
    return h - max(o, c)

def _lower_shadow(l, o, c):
    return min(o, c) - l

def _is_bullish(o, c):
    return c > o

def _is_bearish(o, c):
    return c < o

def _avg_body(df, n=10):
    """Average body size over last n candles."""
    bodies = (df["close"] - df["open"]).abs()
    return bodies.rolling(n).mean()


# ============================================================
# Single-candle patterns
# ============================================================

def detect_doji(df):
    """Doji: body is very small relative to range."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    rng = h - l
    avg = _avg_body(df)
    return (body <= rng * 0.1) & (rng > 0) & (body < avg * 0.3)


def detect_hammer(df):
    """Hammer: small body at top, long lower shadow (bullish reversal)."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    ls = pd.concat([o, c], axis=1).min(axis=1) - l
    us = h - pd.concat([o, c], axis=1).max(axis=1)
    rng = h - l
    return (ls >= body * 2) & (us <= body * 0.5) & (body > rng * 0.1) & (rng > 0)


def detect_inverted_hammer(df):
    """Inverted Hammer: small body at bottom, long upper shadow (bullish reversal)."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    us = h - pd.concat([o, c], axis=1).max(axis=1)
    ls = pd.concat([o, c], axis=1).min(axis=1) - l
    rng = h - l
    return (us >= body * 2) & (ls <= body * 0.5) & (body > rng * 0.1) & (rng > 0)


def detect_shooting_star(df):
    """Shooting Star: small body at bottom, long upper shadow (bearish reversal)."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    us = h - pd.concat([o, c], axis=1).max(axis=1)
    ls = pd.concat([o, c], axis=1).min(axis=1) - l
    rng = h - l
    bearish = c < o
    return (us >= body * 2) & (ls <= body * 0.5) & bearish & (body > rng * 0.1) & (rng > 0)


def detect_marubozu(df):
    """Marubozu: full body candle with no/tiny shadows. Returns +1 bullish, -1 bearish."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    rng = h - l
    us = h - pd.concat([o, c], axis=1).max(axis=1)
    ls = pd.concat([o, c], axis=1).min(axis=1) - l
    is_maru = (body >= rng * 0.8) & (us <= rng * 0.05) & (ls <= rng * 0.05) & (rng > 0)
    bullish = c > o
    result = pd.Series(0, index=df.index)
    result[is_maru & bullish] = 1
    result[is_maru & ~bullish] = -1
    return result


def detect_spinning_top(df):
    """Spinning Top: small body with roughly equal shadows."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    us = h - pd.concat([o, c], axis=1).max(axis=1)
    ls = pd.concat([o, c], axis=1).min(axis=1) - l
    rng = h - l
    avg = _avg_body(df)
    shadow_ratio = pd.concat([us, ls], axis=1).min(axis=1) / pd.concat([us, ls], axis=1).max(axis=1).replace(0, np.nan)
    return (body < avg * 0.4) & (shadow_ratio > 0.4) & (rng > 0) & (us > body * 0.5) & (ls > body * 0.5)


# ============================================================
# Double-candle patterns
# ============================================================

def detect_bullish_engulfing(df):
    o, c = df["open"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    prev_bearish = prev_c < prev_o
    curr_bullish = c > o
    engulfs = (o <= prev_c) & (c >= prev_o)
    return prev_bearish & curr_bullish & engulfs


def detect_bearish_engulfing(df):
    o, c = df["open"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    prev_bullish = prev_c > prev_o
    curr_bearish = c < o
    engulfs = (o >= prev_c) & (c <= prev_o)
    return prev_bullish & curr_bearish & engulfs


def detect_bullish_harami(df):
    o, c = df["open"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    prev_bearish = prev_c < prev_o
    curr_bullish = c > o
    inside = (o > prev_c) & (c < prev_o)
    return prev_bearish & curr_bullish & inside


def detect_bearish_harami(df):
    o, c = df["open"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    prev_bullish = prev_c > prev_o
    curr_bearish = c < o
    inside = (o < prev_c) & (c > prev_o)
    return prev_bullish & curr_bearish & inside


def detect_piercing_line(df):
    """Piercing Line: bearish candle followed by bullish that opens below prev low and closes above midpoint."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    prev_l = l.shift(1)
    prev_bearish = prev_c < prev_o
    curr_bullish = c > o
    mid = (prev_o + prev_c) / 2
    return prev_bearish & curr_bullish & (o <= prev_l) & (c > mid) & (c < prev_o)


def detect_dark_cloud_cover(df):
    """Dark Cloud Cover: bullish candle followed by bearish that opens above prev high and closes below midpoint."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    prev_h = h.shift(1)
    prev_bullish = prev_c > prev_o
    curr_bearish = c < o
    mid = (prev_o + prev_c) / 2
    return prev_bullish & curr_bearish & (o >= prev_h) & (c < mid) & (c > prev_o)


def detect_tweezer_top(df):
    h = df["high"]
    prev_h = h.shift(1)
    o, c = df["open"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    same_high = (h - prev_h).abs() <= h * 0.001
    prev_bullish = prev_c > prev_o
    curr_bearish = c < o
    return same_high & prev_bullish & curr_bearish


def detect_tweezer_bottom(df):
    l = df["low"]
    prev_l = l.shift(1)
    o, c = df["open"], df["close"]
    prev_o, prev_c = o.shift(1), c.shift(1)
    same_low = (l - prev_l).abs() <= l * 0.001
    prev_bearish = prev_c < prev_o
    curr_bullish = c > o
    return same_low & prev_bearish & curr_bullish


# ============================================================
# Triple-candle patterns
# ============================================================

def detect_morning_star(df):
    o, c = df["open"], df["close"]
    body = (c - o).abs()
    avg = _avg_body(df)
    c1_bear = c.shift(2) < o.shift(2)
    c2_small = body.shift(1) < avg.shift(1) * 0.3
    c3_bull = c > o
    c3_above_mid = c > (o.shift(2) + c.shift(2)) / 2
    return c1_bear & c2_small & c3_bull & c3_above_mid


def detect_evening_star(df):
    o, c = df["open"], df["close"]
    body = (c - o).abs()
    avg = _avg_body(df)
    c1_bull = c.shift(2) > o.shift(2)
    c2_small = body.shift(1) < avg.shift(1) * 0.3
    c3_bear = c < o
    c3_below_mid = c < (o.shift(2) + c.shift(2)) / 2
    return c1_bull & c2_small & c3_bear & c3_below_mid


def detect_three_white_soldiers(df):
    o, c, h = df["open"], df["close"], df["high"]
    b1 = (c.shift(2) > o.shift(2))
    b2 = (c.shift(1) > o.shift(1))
    b3 = (c > o)
    rising = (c > c.shift(1)) & (c.shift(1) > c.shift(2))
    opens_in_body = (o > o.shift(1)) & (o < c.shift(1)) & (o.shift(1) > o.shift(2)) & (o.shift(1) < c.shift(2))
    return b1 & b2 & b3 & rising & opens_in_body


def detect_three_black_crows(df):
    o, c, l = df["open"], df["close"], df["low"]
    b1 = (c.shift(2) < o.shift(2))
    b2 = (c.shift(1) < o.shift(1))
    b3 = (c < o)
    falling = (c < c.shift(1)) & (c.shift(1) < c.shift(2))
    opens_in_body = (o < o.shift(1)) & (o > c.shift(1)) & (o.shift(1) < o.shift(2)) & (o.shift(1) > c.shift(2))
    return b1 & b2 & b3 & falling & opens_in_body


# ============================================================
# Pattern registry
# ============================================================

PATTERN_REGISTRY = {
    "Doji": {"fn": detect_doji, "signal": "neutral", "strength": 1, "candles": 1, "group": "single"},
    "Hammer": {"fn": detect_hammer, "signal": "bullish", "strength": 2, "candles": 1, "group": "single"},
    "Inverted Hammer": {"fn": detect_inverted_hammer, "signal": "bullish", "strength": 1, "candles": 1, "group": "single"},
    "Shooting Star": {"fn": detect_shooting_star, "signal": "bearish", "strength": 2, "candles": 1, "group": "single"},
    "Marubozu (Bull)": {"fn": lambda df: detect_marubozu(df) == 1, "signal": "bullish", "strength": 2, "candles": 1, "group": "single"},
    "Marubozu (Bear)": {"fn": lambda df: detect_marubozu(df) == -1, "signal": "bearish", "strength": 2, "candles": 1, "group": "single"},
    "Spinning Top": {"fn": detect_spinning_top, "signal": "neutral", "strength": 1, "candles": 1, "group": "single"},
    "Bullish Engulfing": {"fn": detect_bullish_engulfing, "signal": "bullish", "strength": 3, "candles": 2, "group": "double"},
    "Bearish Engulfing": {"fn": detect_bearish_engulfing, "signal": "bearish", "strength": 3, "candles": 2, "group": "double"},
    "Bullish Harami": {"fn": detect_bullish_harami, "signal": "bullish", "strength": 2, "candles": 2, "group": "double"},
    "Bearish Harami": {"fn": detect_bearish_harami, "signal": "bearish", "strength": 2, "candles": 2, "group": "double"},
    "Piercing Line": {"fn": detect_piercing_line, "signal": "bullish", "strength": 2, "candles": 2, "group": "double"},
    "Dark Cloud Cover": {"fn": detect_dark_cloud_cover, "signal": "bearish", "strength": 2, "candles": 2, "group": "double"},
    "Tweezer Top": {"fn": detect_tweezer_top, "signal": "bearish", "strength": 2, "candles": 2, "group": "double"},
    "Tweezer Bottom": {"fn": detect_tweezer_bottom, "signal": "bullish", "strength": 2, "candles": 2, "group": "double"},
    "Morning Star": {"fn": detect_morning_star, "signal": "bullish", "strength": 3, "candles": 3, "group": "triple"},
    "Evening Star": {"fn": detect_evening_star, "signal": "bearish", "strength": 3, "candles": 3, "group": "triple"},
    "Three White Soldiers": {"fn": detect_three_white_soldiers, "signal": "bullish", "strength": 3, "candles": 3, "group": "triple"},
    "Three Black Crows": {"fn": detect_three_black_crows, "signal": "bearish", "strength": 3, "candles": 3, "group": "triple"},
}


def scan_patterns_for_symbol(df: pd.DataFrame, lookback: int = 3) -> list:
    """
    Scan the last `lookback` bars for all patterns.
    Returns list of detected pattern dicts.
    """
    if df is None or len(df) < 10:
        return []

    detected = []
    for name, meta in PATTERN_REGISTRY.items():
        try:
            result = meta["fn"](df)
            tail = result.tail(lookback)
            if tail.any():
                last_idx = tail[tail].index[-1]
                detected.append({
                    "pattern": name,
                    "signal": meta["signal"],
                    "strength": meta["strength"],
                    "candles": meta["candles"],
                    "group": meta["group"],
                    "bar_date": str(last_idx),
                })
        except Exception:
            continue

    return detected
