# Strategy Suggestions & New Indicators

## New Indicators (pandas_ta — Python-native)

All implemented and ready for use in strategies:

| Indicator | Description | Typical Use |
|-----------|-------------|-------------|
| **MACD** | Moving Average Convergence Divergence | `MACD > 0` bullish, `MACD < 0` bearish, `cross_above 0` buy signal |
| **Bollinger Bands** | Price bands (lower, middle, upper, %B) | `bb_pct < 0` oversold, `bb_pct > 1` overbought, `close < bb_lower` bounce |
| **ATR** | Average True Range (volatility) | `ATR > value` for volatility filter |
| **SMA** | Simple Moving Average | `close > SMA` trend, `close cross_above SMA` breakout |
| **Stochastic** | %K and %D oscillators | `stoch_k < 20` oversold, `stoch_k > 80` overbought, `stoch_k > stoch_d` bullish |
| **EMA** | Exponential MA | (existing) |
| **RSI** | Relative Strength Index | (existing) |
| **Supertrend** | Trend following | (existing) |
| **Parabolic SAR** | Stop and Reverse | (existing) |
| **VWAP** | Volume Weighted Avg Price | (existing) |

### Example Strategy Ideas

1. **MACD Crossover Buy**: `MACD cross_above 0` (bullish momentum)
2. **RSI Oversold Bounce**: `RSI < 30` (oversold, potential reversal)
3. **Bollinger Bounce**: `close < bb_lower` or `bb_pct < 0` (price at lower band)
4. **Stochastic Oversold**: `stoch_k < 20` (oversold)
5. **Supertrend Bullish**: `supertrend == bullish`
6. **EMA Trend**: `close > ema(50)` (uptrend)

---

## Chart Patterns

### Candlestick Patterns (existing)

Doji, Hammer, Engulfing, Morning Star, Three White Soldiers, etc. — see `candle_patterns.py`.

### Structural Patterns (new)

| Pattern | Signal | Description |
|---------|--------|-------------|
| **Ascending Triangle** | Bullish | Flat resistance, rising support |
| **Descending Triangle** | Bearish | Flat support, falling resistance |
| **Symmetrical Triangle** | Neutral | Converging trendlines |
| **Rising Wedge** | Bearish | Both lines up, converging |
| **Falling Wedge** | Bullish | Both lines down, converging |
| **Cup and Handle** | Bullish | U-shaped dip + consolidation breakout |

Structural patterns are derived with logic (pivot highs/lows, slope analysis) — no external library. They appear on the **Patterns** page together with candlestick patterns. Use a higher **lookback** (e.g. 5–10) for structural patterns, since they need more bars.

### 1W Timeframe

Stocks currently use **1D** only. For **1W** (weekly):

1. **Option A**: Add `ohlcv_1w` and a weekly sync job.
2. **Option B**: Aggregate 1D → 1W on the fly (e.g. resample last 5 days).

Structural patterns are tuned for ~30-bar windows; on weekly that’s ~30 weeks. To support 1W, add a weekly OHLC source and pass it to the pattern detectors.

---

## Libraries Used

- **pandas_ta**: MACD, Bollinger, ATR, SMA, Stochastic, RSI, EMA, Supertrend, PSAR, VWAP
- **Chart patterns**: Custom logic in `chart_patterns_structural.py` (no extra dependencies)
- **Candlestick patterns**: Custom logic in `candle_patterns.py`

There are standalone pattern libraries (e.g. ChartPatterns, PatternPy, simple-chart-patterns-detection) but they can add dependencies and compatibility issues. The current implementation keeps everything in-house and extensible.
