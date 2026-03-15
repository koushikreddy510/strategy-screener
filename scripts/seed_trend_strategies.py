#!/usr/bin/env python3
"""
Seed trend detection strategies. Run from project root:
  DATABASE_URL=postgresql://... python scripts/seed_trend_strategies.py

Strategies use the new indicators: MACD, RSI, Bollinger, Stochastic, Supertrend, EMA, SMA.
Skips strategies that already exist (by name).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Set DATABASE_URL")
    sys.exit(1)

from sqlalchemy import create_engine, text

engine = create_engine(DATABASE_URL)

STRATEGIES = [
    {
        "name": "MACD Bullish",
        "description": "MACD line above zero — bullish momentum",
        "conditions": [
            {"indicator_type": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}, "lookback_days": 1, "operator": ">", "threshold": {"value": 0}},
        ],
    },
    {
        "name": "MACD Crossover Buy",
        "description": "MACD crosses above zero — buy signal",
        "conditions": [
            {"indicator_type": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}, "lookback_days": 2, "operator": "cross_above", "threshold": {"value": 0}},
        ],
    },
    {
        "name": "RSI Oversold Bounce",
        "description": "RSI below 30 — oversold, potential reversal",
        "conditions": [
            {"indicator_type": "rsi", "params": {"length": 14}, "lookback_days": 1, "operator": "<", "threshold": {"value": 30}},
        ],
    },
    {
        "name": "RSI Overbought",
        "description": "RSI above 70 — overbought, caution",
        "conditions": [
            {"indicator_type": "rsi", "params": {"length": 14}, "lookback_days": 1, "operator": ">", "threshold": {"value": 70}},
        ],
    },
    {
        "name": "Supertrend Bullish",
        "description": "Supertrend in bullish mode — uptrend",
        "conditions": [
            {"indicator_type": "supertrend", "params": {"period": 10, "multiplier": 3.0}, "lookback_days": 1, "operator": "==", "threshold": {"value": "bullish"}},
        ],
    },
    {
        "name": "Supertrend Bearish",
        "description": "Supertrend in bearish mode — downtrend",
        "conditions": [
            {"indicator_type": "supertrend", "params": {"period": 10, "multiplier": 3.0}, "lookback_days": 1, "operator": "==", "threshold": {"value": "bearish"}},
        ],
    },
    {
        "name": "Bollinger Oversold",
        "description": "Price at or below lower band — oversold bounce",
        "conditions": [
            {"indicator_type": "bollinger", "params": {"length": 20, "std": 2.0}, "lookback_days": 1, "operator": "<", "threshold": {"value": 0}},
        ],
    },
    {
        "name": "Stochastic Oversold",
        "description": "Stochastic %K below 20 — oversold",
        "conditions": [
            {"indicator_type": "stochastic", "params": {"k": 14, "d": 3}, "lookback_days": 1, "operator": "<", "threshold": {"value": 20}},
        ],
    },
    {
        "name": "Stochastic Overbought",
        "description": "Stochastic %K above 80 — overbought",
        "conditions": [
            {"indicator_type": "stochastic", "params": {"k": 14, "d": 3}, "lookback_days": 1, "operator": ">", "threshold": {"value": 80}},
        ],
    },
    {
        "name": "EMA 20 Uptrend",
        "description": "Close above 20 EMA — short-term uptrend",
        "conditions": [
            {"indicator_type": "ema", "params": {"length": 20}, "lookback_days": 1, "operator": "<", "threshold": {"field": "close"}},
        ],
    },
    {
        "name": "EMA 50 Uptrend",
        "description": "Close above 50 EMA — medium-term uptrend",
        "conditions": [
            {"indicator_type": "ema", "params": {"length": 50}, "lookback_days": 1, "operator": "<", "threshold": {"field": "close"}},
        ],
    },
    {
        "name": "SMA 20 Breakout",
        "description": "Close above 20 SMA — breakout",
        "conditions": [
            {"indicator_type": "sma", "params": {"length": 20}, "lookback_days": 1, "operator": "<", "threshold": {"field": "close"}},
        ],
    },
    {
        "name": "MACD + Supertrend Bullish",
        "description": "MACD positive and Supertrend bullish — strong uptrend",
        "conditions": [
            {"indicator_type": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}, "lookback_days": 1, "operator": ">", "threshold": {"value": 0}},
            {"indicator_type": "supertrend", "params": {"period": 10, "multiplier": 3.0}, "lookback_days": 1, "operator": "==", "threshold": {"value": "bullish"}},
        ],
    },
    {
        "name": "RSI Oversold + EMA Support",
        "description": "RSI oversold with price above 50 EMA — bounce candidate",
        "conditions": [
            {"indicator_type": "rsi", "params": {"length": 14}, "lookback_days": 1, "operator": "<", "threshold": {"value": 30}},
            {"indicator_type": "ema", "params": {"length": 50}, "lookback_days": 1, "operator": "<", "threshold": {"field": "close"}},
        ],
    },
]


def main():
    import json
    with engine.connect() as conn:
        for s in STRATEGIES:
            existing = conn.execute(text("SELECT id FROM strategies WHERE name = :n"), {"n": s["name"]}).fetchone()
            if existing:
                print(f"Skip (exists): {s['name']}")
                continue
            row = conn.execute(
                text("""
                    INSERT INTO strategies (name, description, is_active, market_type, timeframe)
                    VALUES (:name, :desc, true, 'stocks', '1D')
                    RETURNING id
                """),
                {"name": s["name"], "desc": s.get("description", "")},
            ).fetchone()
            sid = row[0]
            for c in s["conditions"]:
                conn.execute(
                    text("""
                        INSERT INTO strategy_conditions (strategy_id, indicator_type, params, lookback_days, operator, threshold)
                        VALUES (:sid, :itype, :params::jsonb, :lb, :op, :thresh::jsonb)
                    """),
                    {
                        "sid": sid,
                        "itype": c["indicator_type"],
                        "params": json.dumps(c["params"]),
                        "lb": c["lookback_days"],
                        "op": c["operator"],
                        "thresh": json.dumps(c["threshold"]),
                    },
                )
            conn.commit()
            print(f"Created: {s['name']} ({len(s['conditions'])} condition(s))")
    print("Done.")


if __name__ == "__main__":
    main()
