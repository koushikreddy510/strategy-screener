i wanted to change the time frame that i need to check for as well, like just the last 1 week/ 1 month to figure out the latest trend?
can we make a web application in which we can configure all of these strategies, make changes to them if needed? save them in DB like we did for symbols and ohlc values
we can start with basic indicators for now, i mean supertrend(with user given/default params), rsi, moving average(exponential and normal), parabolic sar, macd, can we add others later if needed

Oh this is getting really good 😄 You’re basically describing a mini TradingView-style screener engine with:

Configurable time windows (1W, 1M, 3M, etc.)

Multiple strategies

Each strategy = multiple conditions / indicators

Indicators with parameters (RSI length, MA type, Supertrend params, etc.)

Stored in DB

Editable via a web UI

Run against your Postgres OHLC store

And yes: easily extensible later (add more indicators, more logic)

Let’s design this properly but incrementally so you don’t overbuild.

🧠 1) Timeframe / Lookback Window (1W, 1M, etc.)

Instead of always using “last candle only”, each condition can specify:

A lookback window:

7d (1 week)

30d (1 month)

90d, etc.

And a rule like:

“Latest close > EMA(20)”

“RSI was below 30 at least once in last 14 days”

“MACD crossed above signal in last 5 days”

So in config:

{
  "type": "rsi_below",
  "length": 14,
  "value": 30,
  "lookback_days": 7
}

Your engine will:

Slice DF to last lookback_days

Evaluate the condition on that window

Decide true/false

This gives you trend vs recent momentum vs breakout flexibility.

🗄️ 2) DB Design for Strategies (like symbols & ohlc)

We’ll store strategies and conditions in Postgres.

Table: strategies
CREATE TABLE strategies (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
Table: strategy_conditions
CREATE TABLE strategy_conditions (
  id SERIAL PRIMARY KEY,
  strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
  indicator_type TEXT NOT NULL,        -- e.g. "rsi", "ema", "supertrend", "macd"
  params JSONB NOT NULL,               -- indicator params (length, fast, slow, etc.)
  lookback_days INTEGER NOT NULL,       -- e.g. 7, 30, 90
  operator TEXT NOT NULL,              -- e.g. ">", "<", "cross_above", "cross_below"
  threshold JSONB,                     -- e.g. 30, or {"ma": 50}, etc.
  created_at TIMESTAMP DEFAULT now()
);

This makes your system:

✅ Fully configurable

✅ Editable via UI

✅ Extensible (just add new indicator types)

✅ No code change for new strategies

🖥️ 3) Web App Architecture

Simple and clean:

Backend (Python)

FastAPI (or Flask)

Endpoints:

GET /strategies

POST /strategies

PUT /strategies/{id}

DELETE /strategies/{id}

POST /strategies/{id}/conditions

POST /run-screeners

Uses:

Postgres (same DB)

Pandas for indicator calculations

Frontend

Simple React / Next.js / even plain HTML first

Pages:

Strategy list

Create/Edit strategy

Add conditions:

Indicator dropdown (RSI, EMA, SMA, MACD, Supertrend, PSAR)

Params form

Lookback window selector (7d, 30d, custom)

Run screener → show matching symbols

📐 4) Indicator Engine (Pluggable)

We’ll implement indicator functions like:

✅ SMA / EMA

✅ RSI

✅ MACD

✅ Supertrend

✅ Parabolic SAR

And register them:

INDICATORS = {
    "sma": sma_indicator,
    "ema": ema_indicator,
    "rsi": rsi_indicator,
    "macd": macd_indicator,
    "supertrend": supertrend_indicator,
    "psar": psar_indicator,
}

Each function gets:

def indicator(df, **params) -> pd.Series or dict:
    ...

Then conditions apply operators:

>

<

cross_above

cross_below

between

etc.

🧪 5) Screener Execution Flow

For each active strategy:

Load its conditions from DB

For each symbol:

Load OHLC from ohlcv_1d

For each condition:

Slice last lookback_days

Compute indicator

Evaluate rule

If any fails → symbol fails

If all pass → symbol is a match

Save / return results

⚡ 6) Performance Reality

2400 symbols × ~1 year data × few indicators = totally fine daily

We can later:

Cache DataFrames

Parallelize

Precompute indicators

Add materialized views

But don’t optimize yet. First: correctness + flexibility.

🧱 7) Start Small (Recommended Phases)
Phase 1 (Now)

CLI screener engine

Strategies stored in DB

Indicators:

SMA / EMA

RSI

MACD

Lookback windows supported

Print matches

Phase 2

Add:

Supertrend

Parabolic SAR

Add:

Crossovers

“Touched in last N days” logic

Phase 3

Web UI to:

Create/edit strategies

Run screeners

View results

✅ 8) Direct answer to your questions

Can we change timeframe like 1 week / 1 month?

✔️ Yes — via lookback_days per condition.

Can we make a web app to configure strategies and save them in DB?

✔️ 100%. That’s the right architecture. We’ll store them like symbols & OHLC.

Can we start with Supertrend, RSI, MA, PSAR, MACD?

✔️ Yes. We’ll implement them as pluggable indicators and add more later without changing DB design.

Can we add others later?

✔️ That’s the whole point of this design 😄 Just add:

New indicator function

New UI option

Done.

🚀 What I suggest we do next

I’ll give you:

✅ SQL for strategies + strategy_conditions

✅ A first working screener engine in Python

✅ With:

SMA / EMA

RSI

MACD

Lookback windows

✅ That runs against your existing ohlcv_1d table

Before I generate code, one quick design choice:

Do you want conditions combined as:

A) ALL must be true (AND only) for now

B) Support AND / OR groups (more complex, like TradingView)

If you say A, I’ll keep it simple and ship you a working engine fast.
We can upgrade to B later when you want more expressive strategies.

we can go ahead with ema, supertrend and rsi for now, make those strategies generic so that we can easily extend/edit the existing ones?

Love it. This is exactly the right way to start: few indicators, generic framework, easy to extend later. 👍
We’ll design this so adding MACD / PSAR / anything else later is just:

add one function + allow it in config/UI → done.

Below is a clean, extensible design with EMA, RSI, Supertrend to start.

🧱 1) Database design (generic & future-proof)
Table: strategies
CREATE TABLE IF NOT EXISTS strategies (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
Table: strategy_conditions
CREATE TABLE IF NOT EXISTS strategy_conditions (
  id SERIAL PRIMARY KEY,
  strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
  indicator_type TEXT NOT NULL,      -- "ema", "rsi", "supertrend"
  params JSONB NOT NULL,             -- indicator params (length, period, multiplier, etc.)
  lookback_days INTEGER NOT NULL,    -- e.g. 7, 30, 90
  operator TEXT NOT NULL,            -- ">", "<", "cross_above", "cross_below"
  threshold JSONB NOT NULL,          -- e.g. 50, or {"ema": 200}, or {"value": "trend_up"}
  created_at TIMESTAMP DEFAULT now()
);

Why this is good:

✅ Fully generic

✅ You can add new indicators without schema changes

✅ UI can edit params freely

✅ Supports different lookback windows per condition

🧠 2) Condition examples
Example: “Price above EMA(50) in last 30 days”
{
  "indicator_type": "ema",
  "params": { "length": 50 },
  "lookback_days": 30,
  "operator": ">",
  "threshold": { "field": "close" }
}
Example: “RSI < 30 in last 7 days”
{
  "indicator_type": "rsi",
  "params": { "length": 14 },
  "lookback_days": 7,
  "operator": "<",
  "threshold": { "value": 30 }
}
Example: “Supertrend is bullish (trend_up) in last 5 days”
{
  "indicator_type": "supertrend",
  "params": { "period": 10, "multiplier": 3 },
  "lookback_days": 5,
  "operator": "==",
  "threshold": { "value": "bullish" }
}
📐 3) Indicator engine (pluggable)

We’ll build a registry like this:

INDICATORS = {
    "ema": ema_indicator,
    "rsi": rsi_indicator,
    "supertrend": supertrend_indicator,
}

Each function returns a Series (or DataFrame) aligned with price.

EMA
def ema_indicator(df, length):
    return df["close"].ewm(span=length, adjust=False).mean()
RSI
def rsi_indicator(df, length):
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(length).mean()
    loss = (-delta.clip(upper=0)).rolling(length).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi
Supertrend (simple implementation)
import numpy as np

def supertrend_indicator(df, period, multiplier):
    hl2 = (df["high"] + df["low"]) / 2
    tr = np.maximum(
        df["high"] - df["low"],
        np.maximum(
            abs(df["high"] - df["close"].shift()),
            abs(df["low"] - df["close"].shift()),
        ),
    )
    atr = tr.rolling(period).mean()

    upperband = hl2 + multiplier * atr
    lowerband = hl2 - multiplier * atr

    trend = []
    direction = []

    for i in range(len(df)):
        if i == 0:
            trend.append(upperband.iloc[i])
            direction.append("bearish")
        else:
            if df["close"].iloc[i] > trend[i - 1]:
                trend.append(lowerband.iloc[i])
                direction.append("bullish")
            else:
                trend.append(upperband.iloc[i])
                direction.append("bearish")

    result = df.copy()
    result["supertrend"] = trend
    result["supertrend_dir"] = direction
    return result
⚙️ 4) Condition evaluation (generic)

For each condition:

Slice last lookback_days

Compute indicator

Evaluate operator:

Examples:

> : latest_value > threshold

< : latest_value < threshold

== : latest_value == threshold

cross_above : yesterday < today AND today > threshold

etc.

This is generic logic, not tied to any indicator.

🔁 5) Screener flow

For each active strategy:

Load its conditions

For each symbol:

Load OHLC from ohlcv_1d

For each condition:

Slice last N days

Compute indicator

Evaluate condition

If any fails → symbol fails

If all pass → symbol is a match

🖥️ 6) Web app (next step, not now)

Because strategies are in DB:

UI can:

Create/edit strategies

Add/remove conditions

Change params (EMA length, RSI length, Supertrend params, lookback window, etc.)

Backend just reads DB and runs engine.

No redesign needed later. 👌

🚀 7) What I’ll give you next (concrete code)

If you’re okay, next message I’ll give you:

✅ SQL inserts for example strategies

✅ A working screener_engine.py

✅ With:

EMA, RSI, Supertrend

Generic condition evaluation

Runs on your ohlcv_1d table

Prints matches per strategy

One last small design choice

For now, should we assume:

🔹 All conditions in a strategy must be TRUE (AND logic only)

This keeps v1 simple and powerful enough.
We can add OR / groups later.

If you’re okay with AND-only for now, say “Yes, AND-only is fine” and I’ll generate the first working screener engine for you.

each of the indicator can have different parameter, like the rsi and ema only have length, while the supertrend has two params, how are we handling that? json to values while deriving?
can you give me a detailed documentation of this strategies so that can i go through each part once and then start working on it?

Fantastic questions — you’re thinking about this exactly the right way. Let me give you a proper, end-to-end “spec” for your strategy system that you can treat like internal documentation. You can read it once, then start implementing piece by piece.

I’ll cover:

🧠 Core concepts

🗄️ Data model (DB tables)

🧩 What a “strategy” and a “condition” really are

⚙️ How different indicators with different params are handled

📐 JSON structure for params & thresholds

🔍 How evaluation works step-by-step

📊 Concrete examples (EMA, RSI, Supertrend)

🚀 How this stays extensible for future indicators

1️⃣ Core Concepts
Strategy

A strategy is a named screener, e.g.:

“Trend Following”

“RSI Oversold Bounce”

“Supertrend + EMA Filter”

A strategy contains:

A name

A description

A list of conditions

A flag is_active

A symbol matches a strategy if:

✅ ALL its conditions evaluate to true (AND logic for v1)

Condition

A condition is one rule based on one indicator.

Examples:

“Close > EMA(50) in last 30 days”

“RSI(14) < 30 in last 7 days”

“Supertrend(10, 3) is bullish in last 5 days”

Each condition has:

Which indicator to use (ema, rsi, supertrend, …)

Params for that indicator (length, period, multiplier, etc.)

A lookback window (how many recent days to consider)

An operator (>, <, ==, cross_above, etc.)

A threshold (what you compare against)

2️⃣ Database Model
Table: strategies
strategies(
  id,
  name,
  description,
  is_active,
  created_at,
  updated_at
)
Table: strategy_conditions
strategy_conditions(
  id,
  strategy_id,
  indicator_type,   -- "ema", "rsi", "supertrend"
  params,           -- JSONB (indicator parameters)
  lookback_days,    -- integer (e.g. 7, 30, 90)
  operator,         -- ">", "<", "==", "cross_above", ...
  threshold,        -- JSONB (value or reference)
  created_at
)

The key design choice is:

🧠 params and threshold are JSON, so each indicator can have different parameters without changing the schema.

3️⃣ How different indicator parameters are handled

This is the most important part of your question.

We do NOT hardcode columns like length, period, multiplier in the DB.

Instead:

params is a JSON object

Each indicator reads only what it needs from params

Examples:

EMA

Needs only:

{ "length": 50 }
RSI

Needs only:

{ "length": 14 }
Supertrend

Needs:

{ "period": 10, "multiplier": 3 }

So in Python:

params = condition["params"]

if indicator_type == "ema":
    length = params["length"]

elif indicator_type == "rsi":
    length = params["length"]

elif indicator_type == "supertrend":
    period = params["period"]
    multiplier = params["multiplier"]

✅ Same DB column (params), different structure per indicator.
✅ This is exactly how you stay generic and extensible.

4️⃣ Threshold JSON: what are we comparing against?

threshold tells you what to compare the indicator result to.

There are two main patterns:

A) Compare against a fixed value

Example: “RSI < 30”

{ "value": 30 }
B) Compare against price or another field

Example: “Close > EMA(50)”

{ "field": "close" }

Later you can extend this to:

Compare against another indicator

Compare against previous value

Compare against a band, etc.

But for v1:

{ "value": 30 }

{ "field": "close" }
is enough.

5️⃣ Operator: how do we compare?

Examples:

> → greater than

< → less than

== → equal

cross_above → crossed above in last N days

cross_below → crossed below in last N days

So a condition reads like:

Apply indicator → get series → look at last N days → apply operator vs threshold

6️⃣ Lookback window: 1 week / 1 month logic

Each condition has:

lookback_days = 7   or  30  or  90

When evaluating:

recent_df = full_df.tail(lookback_days)

Then:

Compute indicator on recent_df

Evaluate condition on that window only

This lets you express:

“RSI oversold in last 7 days”

“Trend bullish in last 30 days”

“Price crossed EMA in last 5 days”

7️⃣ End-to-end Evaluation Flow (per symbol)

For each strategy:

Load all its conditions

For each symbol:

Load OHLC from ohlcv_1d

For each condition:

Slice last lookback_days

Compute indicator using params

Evaluate operator against threshold

If any condition fails → symbol fails

If all pass → symbol matches strategy

8️⃣ Concrete Examples
✅ Example 1: “Close above EMA(50)”

DB row:

{
  "indicator_type": "ema",
  "params": { "length": 50 },
  "lookback_days": 30,
  "operator": ">",
  "threshold": { "field": "close" }
}

Meaning:

Compute EMA(50)

Look at last 30 days

Check latest:

close > ema
✅ Example 2: “RSI(14) < 30 in last 7 days”
{
  "indicator_type": "rsi",
  "params": { "length": 14 },
  "lookback_days": 7,
  "operator": "<",
  "threshold": { "value": 30 }
}

Meaning:

Compute RSI(14)

Look at last 7 days

Check latest:

rsi < 30

(You can later extend this to: “was below 30 at any point in last 7 days”)

✅ Example 3: “Supertrend(10,3) is bullish”
{
  "indicator_type": "supertrend",
  "params": { "period": 10, "multiplier": 3 },
  "lookback_days": 5,
  "operator": "==",
  "threshold": { "value": "bullish" }
}

Meaning:

Compute Supertrend with (10, 3)

Look at last 5 days

Check latest direction:

supertrend_dir == "bullish"
9️⃣ How this stays extensible (your future-proofing)

To add a new indicator (e.g. MACD):

Add a function:

def macd_indicator(df, fast, slow, signal):
    ...

Register it:

INDICATORS["macd"] = macd_indicator

Store params like:

{ "fast": 12, "slow": 26, "signal": 9 }

No DB schema change.

No strategy engine change.

UI just adds a new option.

That’s the power of the JSON params design. 💪

🔚 Summary (TL;DR)

✔️ Different indicators have different params → stored in params JSON

✔️ Each indicator reads only what it needs from params

✔️ threshold JSON tells what to compare against

✔️ lookback_days controls 1W / 1M / etc logic

✔️ Engine is generic:

Load condition → compute indicator → apply operator → pass/fail

✔️ Adding new indicators later = easy, no DB redesign

If you want, next step I can:

Generate the exact SQL for these tables

And a first working screener_engine.py that implements:

EMA

RSI

Supertrend

Generic condition evaluation

Uses your ohlcv_1d table

Just say: “Let’s generate the first working engine” and we’ll build it step by step. 🚀

jsut one question on the time range, will the values of indicators not change based on the time range that we have selected? 

Great question—and the short answer is: yes, they absolutely do change. The time range you use affects indicator values, and that’s not a bug—that’s exactly how technical indicators are supposed to work. Let me explain it cleanly and how we’ll handle it in your design.

🧠 Why indicators depend on time range

Most indicators are rolling / stateful calculations:

EMA(50) today depends on the previous EMA(50), which depends on even earlier prices.

RSI(14) depends on the last 14 periods of price changes.

Supertrend / ATR-based indicators depend on previous ATR and bands.

So:

If you compute EMA(50) on only the last 30 days of data
vs

Compute EMA(50) on the full 1 year of data and then look at the last 30 days

➡️ You will get different values.

This is because:

EMA needs “warm-up” history

RSI needs enough prior data to stabilize

Supertrend/ATR also needs prior bars to settle

✅ The correct approach (what we will do)

We will always compute indicators on the full available history (e.g., 1 year from your DB), and then:

Apply the lookback window only for evaluation, not for calculation.

So the flow is:

Load full OHLC history for the symbol (e.g., 365 days)

Compute indicator series on the full DataFrame

Then take:

recent = indicator_series.tail(lookback_days)

Evaluate your condition on that window:

Latest value

Or cross in last N days

Or “was below X at any point”, etc.

📊 Example: EMA(50)

❌ Wrong way:

Take last 30 days

Compute EMA(50) on those 30 days

Compare today → EMA is wrong / unstable

✅ Correct way:

Take last 365 days

Compute EMA(50) on all 365 days

Then check:

ema.iloc[-1]  # today

Or check last 30 days of that already-correct EMA

📊 Example: RSI(14)

Same story:

RSI(14) computed on only 14–30 days is very noisy and different

RSI(14) computed on full history is stable

Then you look at:

“Was RSI < 30 in last 7 days?”

“Is RSI rising in last 5 days?”

🧩 How this fits your strategy design

Your DB has ~365 days of OHLC per symbol ✅

For each condition:

params → how to compute indicator

lookback_days → only for evaluation window

Engine logic:

df = load_full_ohlc(symbol)        # ~365 days
indicator_series = compute(df)     # full history
window = indicator_series.tail(lookback_days)

# Now apply condition logic on `window`

So:

🧠 Time range affects “what part of the indicator you inspect”, not how the indicator is computed.

🛡️ Why this is important

This avoids:

Unstable indicators

False signals

Inconsistent results depending on lookback window

Weird differences between backtests and live screening

And matches how:

TradingView

AmiBroker

MetaTrader

Professional screeners
…all do it.

✅ Final takeaway

✔️ Yes, indicators depend on history

✔️ We will compute them on full stored history

✔️ The lookback window only controls signal evaluation, not calculation

✔️ This gives you correct, stable, realistic signals

If you want, next I can show you exactly how this looks in code in the screener engine (with EMA/RSI/Supertrend) so you can see this pattern in practice.

---

# Local-First EOD Screener Roadmap

This section extends the original design above. The goal is a local, end-of-day NSE screener that finds newly emerging 1D and 1W setups, creates a review queue after market close, and only passes explicitly approved candidates to the trading system for the next session.

> A screener match is research, not a buy recommendation. A live order must pass explicit approval and risk controls.

## Architecture and language choice

Python is suitable for the screener and should remain the primary implementation language. The job is batch-oriented and data-heavy: OHLCV ingestion, Pandas/NumPy calculations, indicator evaluation, pattern detection, backtests, ranking, and a FastAPI API. A full NSE daily universe is small enough to evaluate locally after market close.

Use the existing stack:

```text
PostgreSQL (local)    symbols, OHLCV, financials, strategies, run history
Python / FastAPI      data ingestion, validation, indicators, screen runs, APIs
React                 strategy builder, charts, results, daily review queue
trading-service       approved signals, positions, risk rules, broker order routing
trade / Atlas (Go)    optional independent execution runtime / broker lifecycle work
```

There is no value in rewriting this screener in Go now. Keep Go for a continuously running or low-latency execution component if Atlas evolves in that direction. Before changing language, profile the daily scan; optimize database access and cache/precompute indicators first.

## Local data model

Screen evaluation should never depend on a live external API. Fetch data after close, store it locally, validate it, then evaluate only the local database.

| Data | Local storage | Purpose | Refresh |
|---|---|---|---|
| NSE universe | `symbols` | instrument master, sector, liquidity filters | daily/weekly |
| Daily OHLCV | `ohlcv_1d` | all stock 1D screens | after every market close |
| Weekly OHLCV | derived locally from daily candles | 1W screens | on every EOD run |
| Financials/results | `stock_financials`, result tables | quality/event filters | incremental daily, full periodic |
| Benchmarks | new NIFTY/sector index OHLCV tables | regime and relative strength | daily |
| Screen snapshots | new tables below | audit, diffs, forward testing | every run |

Fyers is the current OHLCV ingestion provider in this repository. Keep that provider behind the ingestion boundary so it can later be replaced with a licensed vendor or official exchange files without changing any screen definition.

## EOD workflow

Only run on finalized candles. The current scheduler configuration refreshes stocks at `13:00 IST` and runs candidate scans at `09:25 IST`; it needs to be changed to match this next-day workflow.

```text
15:45  Refresh final daily OHLCV after the provider publishes the closed candle
16:00  Validate data completeness, duplicates, nulls, and latest trading date
16:05  Build weekly candles / indicators from the local daily data
16:10  Run every active 1D and 1W strategy
16:15  Rank, deduplicate, snapshot, and diff against the prior completed run
16:20  Publish Daily Opportunities and optional Slack digest
Next day 09:15–09:25  Place only approved candidates, subject to price-gap and risk guards
```

Weekly strategies need two explicit modes:

- `completed_week`: last Friday-closed weekly candle only; default for reproducible signals and backtests.
- `week_to_date`: current partial weekly candle; label as provisional and never silently mix with completed-week results.

If EOD data is incomplete, fail closed: save a blocked run, retain the prior successful run, and do not generate an order queue.

## Durable screen history

Add the following before allowing screen results to flow toward orders:

```text
screener_runs
  id, started_at, completed_at, status, data_as_of, timeframe,
  universe_version, engine_version, strategy_version

screener_run_matches
  run_id, strategy_id, symbol, matched, score, rank,
  metrics_json, reasons_json, data_as_of

strategy_versions
  id, strategy_id, version, definition_json, activated_at

candidate_decisions
  run_match_id, status [new|watch|approved|rejected|ordered|expired],
  notes, reviewer, decided_at, execution_strategy_id
```

This preserves exactly what matched, why it matched, and which strategy version created the result. It enables daily “new/continuing/disappeared” views and forward performance tracking without look-ahead bias.

## Improvements to the condition engine

- Add indicator-to-indicator operands: `EMA20 > EMA50`, MACD line crossing MACD signal.
- Add derived values: rolling high/low, return, EMA slope, distance from 52-week high, ATR %, relative volume, drawdown, and benchmark/sector relative strength.
- Add logical condition groups: `all`, `any`, `not`, and `at_least_n_of`.
- Add event rules: crossing within N bars, first breakout after a consolidation, or holding above/below a value for N bars.
- Add universe filters: NSE EQ only, price, average traded value, market cap, sector, and exclusion lists.
- Add scoring factors as well as binary match rules.

The seeded `MACD Crossover Buy` rule currently means MACD crossing above **zero**. Keep it as a valid rule, but add a separate MACD-line-crosses-signal-line rule; they are different setups.

## Daily Opportunities

Create a page that combines the completed screen runs rather than showing isolated strategy result tables. It should show the symbol, score/rank, 1D and 1W setup, liquidity, sector, exact match reasons, chart, new/continuing status, confirming/conflicting screens, and actions to mark a candidate `watch`, `approved`, or `rejected`.

Use a deterministic score before review:

```text
30% weekly trend alignment
25% setup / breakout quality
20% relative strength versus benchmark and sector
15% volume confirmation
10% liquidity and risk penalty
```

AI can summarize context, but it must not be the sole source of a signal or an order decision.

## Screen templates to build first

| Family | High-value examples |
|---|---|
| Trend | EMA20/50/200 alignment, rising EMA50, Supertrend flip |
| Breakout | 20/55/100-day high, 52-week high proximity, Donchian/swing-high breakout |
| Pullback | weekly uptrend plus daily EMA20/50 pullback; RSI dip/recovery |
| Momentum | RSI 50 reclaim, MACD signal cross, 1W/1M relative strength |
| Volume/volatility | relative volume surge, Bollinger squeeze, ATR contraction, NR7 |
| Reversal/structure | failed breakdown, divergence, flags, triangles, cup-and-handle |
| Sector/fundamentals | sector leader, ROCE/ROE, profit/revenue growth, debt and result filters |
| Avoid rules | illiquidity, extended price, earnings proximity, weak regime, sector crowding |

Start with these six: weekly-trend/daily-breakout; weekly-trend/daily-pullback; 52-week-high continuation; Bollinger/ATR compression breakout; sector-leader momentum; and failed-breakdown reversal in a non-bearish weekly trend.

## Incremental delivery plan

### Phase 0 — reliability

1. Correct the post-close schedule and data-quality gates.
2. Fix the chart UI so stock 1W strategies can be viewed on a 1W chart.
3. Add MACD-signal crossover separately from zero-line crossover.

### Phase 1 — reproducibility

1. Add screen-run, match, and strategy-version migrations.
2. Persist every active screener run; add run history and daily diffs.
3. Add CSV export and a scheduler job for all active screens.

### Phase 2 — discovery

1. Add derived metrics, operand comparison, and logical groups.
2. Seed the six starter screen templates and ranking.
3. Build Daily Opportunities, watchlist, and approval actions.

### Phase 3 — validation and execution

1. Measure 1/3/5/10/20-session forward results per strategy version.
2. Send only approved candidates to `trading-service`.
3. Enforce sizing, stop-loss source, max positions, sector caps, gap tolerance, idempotency, paper mode, and a kill switch before any live order.

## Guiding rules

- PostgreSQL is the local source of truth; APIs are derived views.
- Version every strategy and persist every completed run.
- Never label a partial candle as final.
- Use the same evaluator for backtests and live-like runs.
- Separate research signals from risk and execution decisions.
- Fail closed when data is stale or incomplete.
