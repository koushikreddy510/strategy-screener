# Strategy Engine Documentation

## 1. Overview

This document describes the architecture and design of the configurable strategy screener engine. The goal is to provide:

- A clear data model for storing strategies and conditions in PostgreSQL.
- A generic, pluggable indicator engine (EMA, RSI, Supertrend to start).
- A flexible evaluation framework with lookback windows and generic operators.
- Guidelines for extending with new indicators, operators, and UI integration.

---

## 2. Core Concepts

### 2.1 Strategy
- **Definition**: A named collection of one or more conditions.
- **Properties**:
  - `id`: Unique identifier.
  - `name`: Human-readable name (must be unique).
  - `description`: Optional text description.
  - `is_active`: Boolean flag to enable/disable.
  - `created_at`, `updated_at`: Timestamps.

A symbol “matches” a strategy if **all** of its conditions evaluate to `true` (AND logic in v1).

### 2.2 Condition
- **Definition**: A single rule based on one technical indicator.
- **Properties**:
  - `id`
  - `strategy_id`: Foreign key to `strategies`.
  - `indicator_type`: e.g., `"ema"`, `"rsi"`, `"supertrend"`.
  - `params`: JSONB storing indicator parameters (length, period, multiplier).
  - `lookback_days`: Integer specifying the evaluation window (7, 30, 90, …).
  - `operator`: Comparison type: `>`, `<`, `==`, `cross_above`, `cross_below`.
  - `threshold`: JSONB specifying value or field to compare against.
  - `created_at`

---

## 3. Database Schema

```sql
-- Strategies table
CREATE TABLE IF NOT EXISTS strategies (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Conditions table
CREATE TABLE IF NOT EXISTS strategy_conditions (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    indicator_type TEXT NOT NULL,
    params JSONB NOT NULL,
    lookback_days INTEGER NOT NULL,
    operator TEXT NOT NULL,
    threshold JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);
```

- **`params`** JSON holds indicator-specific settings.
- **`threshold`** JSON holds either:
  - `{"value": 30}` (compare to fixed value)
  - `{"field": "close"}` (compare to latest field value)

---

## 4. Indicator Engine

Indicators are registered in a Python dictionary:

```python
INDICATORS = {
    "ema": ema_indicator,
    "rsi": rsi_indicator,
    "supertrend": supertrend_indicator,
    # future: "macd", "psar", …
}
```

### 4.1 EMA
```python
def ema_indicator(df, length):
    return df["close"].ewm(span=length, adjust=False).mean()
```

### 4.2 RSI
```python
def rsi_indicator(df, length):
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(window=length).mean()
    loss = (-delta.clip(upper=0)).rolling(window=length).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))
```

### 4.3 Supertrend
```python
def supertrend_indicator(df, period, multiplier):
    # Compute ATR and bands
    hl2 = (df["high"] + df["low"]) / 2
    tr = np.maximum.reduce([
        df["high"] - df["low"],
        (df["high"] - df["close"].shift()).abs(),
        (df["low"] - df["close"].shift()).abs()
    ])
    atr = tr.rolling(window=period).mean()
    upper = hl2 + multiplier * atr
    lower = hl2 - multiplier * atr

    # Determine trend direction
    trend, direction = [], []
    for i in range(len(df)):
        if i == 0:
            trend.append(upper.iloc[i]); direction.append("bearish")
        else:
            prev_trend = trend[i - 1]
            if df["close"].iloc[i] > prev_trend:
                trend.append(lower.iloc[i]); direction.append("bullish")
            else:
                trend.append(upper.iloc[i]); direction.append("bearish")

    df = df.copy()
    df["supertrend"] = trend
    df["supertrend_dir"] = direction
    return df
```

---

## 5. Evaluation Workflow

1. **Load Data**  
   - Pull full OHLC history (e.g., 365 days) from `ohlcv_1d`.
2. **Compute Indicators**  
   - Run the indicator function on the entire DataFrame to ensure stability.
3. **Apply Lookback Window**  
   - `window = series.tail(lookback_days)`
4. **Extract Threshold**  
   - Fixed value: `threshold["value"]`
   - Field value: `df[field].iloc[-1]`
5. **Evaluate Operator**  
   - `>`: `window[-1] > threshold`
   - `<`: `window[-1] < threshold`
   - `==`: equality
   - `cross_above`: previous <= threshold < latest
   - `cross_below`: previous >= threshold > latest

If **all** conditions for a strategy pass, the symbol is included in the matches.

---

## 6. JSON Examples

### 6.1 EMA Condition
```json
{
  "indicator_type": "ema",
  "params": { "length": 50 },
  "lookback_days": 30,
  "operator": ">",
  "threshold": { "field": "close" }
}
```

### 6.2 RSI Condition
```json
{
  "indicator_type": "rsi",
  "params": { "length": 14 },
  "lookback_days": 7,
  "operator": "<",
  "threshold": { "value": 30 }
}
```

### 6.3 Supertrend Condition
```json
{
  "indicator_type": "supertrend",
  "params": { "period": 10, "multiplier": 3 },
  "lookback_days": 5,
  "operator": "==",
  "threshold": { "value": "bullish" }
}
```

---

## 7. Extensibility

To add a new indicator (e.g., MACD, PSAR):

1. Implement the function with signature `(df, **params)`.
2. Add it to `INDICATORS` registry.
3. Store its parameters in `params` JSON.
4. Optionally add UI dropdown for the new `indicator_type`.

No database schema changes are required.

---

## 8. Next Steps

- Review this documentation.
- Set up the Python environment (`pandas`, `numpy`, `sqlalchemy`).
- Create the `strategies` and `strategy_conditions` tables.
- Populate example strategies.
- Run `screener_engine.py` and verify matches.
- Proceed to build the frontend UI for strategy management.

---