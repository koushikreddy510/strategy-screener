# Strategy Screener Stack Runbook

This file explains:

1. what is already implemented across `data-store`, `strategy-screener`, and `trading-service`
2. what is still missing for a full portfolio backtesting / execution system
3. how to run the full local stack with the right dependencies and ports

The repos assumed here are:

- `/Users/koushik-bangaru/Desktop/data-store`
- `/Users/koushik-bangaru/Desktop/strategy-screener`
- `/Users/koushik-bangaru/Desktop/trading-service`

## Current Architecture

### `data-store`

Responsibilities:

- loads symbols into Postgres
- fetches daily OHLCV
- enriches sector / market cap
- scrapes latest results and financials

Useful files:

- `symbols_to_postgres.py`
- `fyers_ohlcv_1d_job.py`
- `enrich_market_cap.py`
- `scrape_latest_results.py`
- `scrape_financials.py`
- `runner.py` (optional HTTP wrapper around data-store scripts)

### `strategy-screener`

Responsibilities:

- stores screener strategies and conditions in DB
- runs technical screeners and pattern scans
- exposes screener APIs on port `8000`
- hosts the React UI on port `3000`
- contains the `BacktestReplay` page UI

Useful files:

- `backend/main.py`
- `screener_engine.py`
- `financials_engine.py`
- `data_manager.py`
- `frontend/src/pages/BacktestReplay.js`
- `run_server.py`

### `trading-service`

Responsibilities:

- stores accounts, orders, positions, pnl snapshots, execution strategies
- resolves universes from screener outputs / pattern screens / full universe
- exposes trading + replay APIs on port `8001`
- already contains the core daily OHLC portfolio replay engine

Useful files:

- `main.py`
- `trading_service/backtest_replay.py`
- `trading_service/universe_resolver.py`
- `trading_service/strategy_consumer.py`
- `trading_service/db.py`
- `docs/TRADING_STRATEGIES_AND_PIPELINE.md`

## Backtesting: What Is Already Implemented

### Implemented in `trading-service`

The following is already working in code:

- `POST /admin/backtest-replay` endpoint in `trading-service/main.py`
- multi-symbol replay on `ohlcv_1d` via `trading_service/backtest_replay.py`
- universe selection:
  - `explicit`
  - `sector`
  - `all_eq`
  - `daily_universe` JSON by date
- replay modes:
  - `buy_and_hold`
  - `sequential_entries`
  - `daily_screen_rebalance`
- sizing modes:
  - `equal_weight`
  - `fixed_inr`
  - `fixed_qty`
  - `percent_equity`
  - `auto`
- multi-lane replay support in backend
  - split one portfolio across lanes using `cash_fraction`
  - or compare lanes independently in isolated mode
- execution-strategy catalog tables and seeds
  - `trading_execution_strategies`
  - `trading_strategy_account_map`
- universe resolution from:
  - screener strategy results
  - 52-week pattern screen
  - structural screen
  - candle screen
  - union of screener + screen
  - full market universe
- account / position / order / pnl storage
- entry candidate scanning
  - enabled strategies x resolved universe x current open positions
  - returns candidate symbols only
- metrics endpoint for Prometheus

### Implemented in `strategy-screener` UI

The current `BacktestReplay` page already supports:

- start / end date
- initial cash
- commission
- explicit symbol replay
- sector replay
- all-EQ replay
- pasted `daily_universe` JSON
- mode selection
- sizing selection
- max positions / deploy fraction
- optional "exit if not in universe"
- dual-lane comparison UI
- combined MTM chart
- combined daily PnL chart
- activity-day table
- per-lane summary blocks

### Implemented in execution strategy model

The `trading-service` already has seeded execution strategy templates such as:

- momentum breakout
- momentum pullback
- swing confluence
- near 52w quality
- sector rotation momentum
- mean reversion
- commodity trend

These are execution/risk templates, not the same thing as the technical screener strategies in `strategy-screener`.

## What Is Not Implemented Yet

These are the main missing pieces if the goal is a more complete TradingView-style multi-stock portfolio backtester / execution system:

- no real order placement pipeline from screener signal -> risk engine -> order router
- `strategy_consumer.py` only generates candidate symbols; it does not place orders
- no live exit manager yet for:
  - stop loss
  - trailing stop
  - target
  - time-based exit
- replay currently uses only `ohlcv_1d`
  - no intraday fills
  - no stop execution inside candle
  - no bar-by-bar intraday simulation
- replay does not yet model:
  - slippage
  - taxes / brokerage beyond simple `commission_pct`
  - partial exits
  - pyramiding
  - lot-level attribution
- backend supports catalog-compare lanes, but the current `BacktestReplay` UI does not expose all of that yet
- no advanced portfolio analytics yet like:
  - CAGR
  - max drawdown
  - Sharpe / Sortino
  - win rate
  - expectancy
  - per-symbol contribution tables
- no point-in-time screener reconstruction unless you pass `daily_universe`
  - this part is important if you want truly correct historical screener replay

## One Real Issue Fixed

While reviewing the implementation, one real bug was found and fixed:

- `trading_service/universe_resolver.py` had the wrong default screener URL:
  - before: `http://127.0.0.1:800`
  - now: `http://127.0.0.1:8000`

Without that fix, universe resolution would fail whenever `STRATEGY_SCREENER_URL` was not explicitly set.

## Local Dependencies

### Required software

- Python 3.11+ recommended
- Node.js 18+ recommended
- npm
- PostgreSQL

### Database expectation

The stack expects a Postgres database holding market tables such as:

- `symbols`
- `ohlcv_1d`
- `stock_financials`
- `result_announcements`

You can keep `trading-service` on:

- the same Postgres DB as market data for local development, or
- a separate trading DB

If you use a separate trading DB, `trading-service` still needs:

- `MARKET_DATABASE_URL` pointing to the market DB for backtests and full-universe resolution

## Recommended Local Ports

- `strategy-screener` backend: `8000`
- `trading-service` API: `8001`
- `strategy-screener` frontend: `3000`
- `data-store` optional runner: `8003`
- `trading-service` scheduler: `8004` (example local choice)

## Environment Files

### 1. `strategy-screener/.env`

Start from `.env.example`.

Minimum required:

```bash
DATABASE_URL=postgresql://market_user:market_pass@localhost:5432/market
DATA_STORE_DIR=/Users/koushik-bangaru/Desktop/data-store
```

Optional extras:

- Fyers credentials
- `SLACK_WEBHOOK_URL`
- `OPENAI_API_KEY`
- `SCREENER_SESSION_COOKIE`

### 2. `strategy-screener/frontend/.env`

Recommended for local development:

```bash
REACT_APP_API_URL=http://localhost:8000
REACT_APP_TRADING_API_URL=http://localhost:8001
```

Notes:

- `REACT_APP_TRADING_API_URL` is required for `Trading`, `Admin` trading actions, and `Backtest replay`
- after changing frontend env vars, restart `npm start`

### 3. `trading-service/.env`

Start from `.env.example`.

Recommended local setup:

```bash
DATABASE_URL=postgresql://market_user:market_pass@localhost:5432/market
MARKET_DATABASE_URL=postgresql://market_user:market_pass@localhost:5432/market
STRATEGY_SCREENER_URL=http://127.0.0.1:8000
```

Optional:

- `SLACK_WEBHOOK_URL`
- broker credentials such as Flattrade env vars

### 4. `data-store`

There is no single checked-in `.env.example` today, so export values in your shell before running scripts:

```bash
export DATABASE_URL=postgresql://market_user:market_pass@localhost:5432/market
export FYERS_CLIENT_ID=...
export FYERS_SECRET_KEY=...
export FYERS_REDIRECT_URI=https://www.google.com/
```

Some scripts also need:

- token file / generated access token
- Fyers login automation vars if you use auto-token generation

## First-Time Setup

### Step 1. Create / load market tables

In `data-store`, make sure the market DB exists and load symbols / OHLCV:

```bash
cd /Users/koushik-bangaru/Desktop/data-store
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Then run the initial market loaders you need:

```bash
python symbols_to_postgres.py
python fyers_ohlcv_1d_job.py
python enrich_market_cap.py
```

Optional:

```bash
python scrape_latest_results.py --days 7
python scrape_financials.py --limit 50
```

### Step 2. Install `strategy-screener`

```bash
cd /Users/koushik-bangaru/Desktop/strategy-screener
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Frontend:

```bash
cd /Users/koushik-bangaru/Desktop/strategy-screener/frontend
npm install
```

### Step 3. Install `trading-service`

```bash
cd /Users/koushik-bangaru/Desktop/trading-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Optional scheduler dependencies:

```bash
cd /Users/koushik-bangaru/Desktop/trading-service/scheduler
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## How To Run Everything Locally

Use separate terminals.

### Terminal 1: `strategy-screener` backend

```bash
cd /Users/koushik-bangaru/Desktop/strategy-screener
source .venv/bin/activate
python run_server.py
```

Equivalent:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Important:

- run from the repo root, not from `backend/`

### Terminal 2: `trading-service`

```bash
cd /Users/koushik-bangaru/Desktop/trading-service
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

Notes:

- on first boot, `ensure_tables()` will run the trading migrations automatically
- `POST /admin/backtest-replay` requires `MARKET_DATABASE_URL`

### Terminal 3: `strategy-screener` frontend

```bash
cd /Users/koushik-bangaru/Desktop/strategy-screener/frontend
npm start
```

App URL:

- `http://localhost:3000`

### Terminal 4: optional `data-store` runner

This is only needed if you want to trigger `data-store` through HTTP:

```bash
cd /Users/koushik-bangaru/Desktop/data-store
source .venv/bin/activate
uvicorn runner:app --reload --host 0.0.0.0 --port 8003
```

Useful endpoints:

- `GET /health`
- `POST /run/ohlcv-stocks`
- `POST /run/commodity-ohlcv`
- `POST /run/enrich-market-cap`
- `POST /run/scrape-latest-results`
- `POST /run/scrape-financials`

### Terminal 5: optional scheduler

```bash
cd /Users/koushik-bangaru/Desktop/trading-service/scheduler
source .venv/bin/activate
export SCREENER_URL=http://127.0.0.1:8000
export TRADING_URL=http://127.0.0.1:8001
export DATA_STORE_URL=http://127.0.0.1:8003
uvicorn main:app --reload --host 0.0.0.0 --port 8004
```

Notes:

- scheduler reads `scheduler/schedules.yaml`
- all cron times there are in `Asia/Kolkata`

## Quick Health Checks

### `strategy-screener`

- open `http://localhost:8000/docs`

### `trading-service`

- open `http://localhost:8001/health`
- open `http://localhost:8001/trading/execution-strategies`

### `data-store` runner

- open `http://localhost:8003/health`

### frontend

- open `http://localhost:3000`

For Backtest Replay specifically:

- verify `frontend/.env` contains `REACT_APP_TRADING_API_URL=http://localhost:8001`
- restart `npm start` after editing env

## Suggested Startup Order

For local development:

1. PostgreSQL
2. `strategy-screener` backend on `8000`
3. `trading-service` on `8001`
4. `strategy-screener` frontend on `3000`
5. optional `data-store` runner on `8003`
6. optional scheduler on `8004`

For first-time data setup:

1. PostgreSQL
2. `data-store` scripts to load symbols / OHLC
3. `strategy-screener`
4. `trading-service`
5. frontend

## Current Best Next Steps

If continuing the backtesting / execution project, the highest-value next items are:

1. expose catalog-compare replay in the UI
2. add portfolio analytics:
   - CAGR
   - drawdown
   - win rate
   - expectancy
   - exposure
3. support true historical screener replay via stored daily universes
4. implement risk -> order pipeline after `entry_candidate_scan`
5. implement exit manager / trailing stop worker
6. add richer replay rules:
   - stop loss
   - target
   - hold days
   - rebalance cadence
   - ranking / top-N selection

