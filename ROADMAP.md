# Strategy Screener & Trading — Roadmap

## 1. API Keys: Cursor Pro vs OpenAI

**Cursor Pro** is your subscription to the Cursor IDE (the editor you’re using). It does **not** give you OpenAI API keys for your own app.

For **AI stock recommendations** in this app, you need an **OpenAI API key**:

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. **API Keys** → Create new secret key
4. Add to `.env`: `OPENAI_API_KEY=sk-...`

OpenAI charges per token. Use `gpt-4o-mini` (cheaper) or `gpt-4o` (better quality). You get a small free tier when you first sign up.

---

## 2. Stock Filtering Ideas (Beyond Current Screener)

| Idea | Description |
|------|-------------|
| **Quality score** | Combine debt/equity, ROCE, FCF, margin consistency into a 0–100 score |
| **Momentum rank** | Rank by 1M/3M/6M returns; filter top quintile |
| **Volatility filter** | Exclude or down-rank stocks with ATR % above threshold |
| **Insider/s promoter** | Use NSE corporate announcements; flag buying/selling |
| **Earnings surprise** | Compare reported vs expected EPS; filter positive surprises |
| **Relative strength vs index** | Stock return / NIFTY 50 return over N days |
| **Sector rotation** | Add NIFTY sector index performance; overweight outperforming sectors |
| **Backtest win rate** | If we store historical signals, show hit rate per strategy |
| **Composite rank** | Weight financials (40%) + technicals (40%) + momentum (20%); sort by rank |

---

## 3. News & Sector Ideas

| Source | Use |
|--------|-----|
| **NSE corporate announcements** | Already in `result_announcements`; extend to board meetings, AGM, results |
| **Moneycontrol / ET RSS** | Scrape headlines by sector or symbol; keyword alerts |
| **News API / Alpha Vantage** | Paid APIs for structured news (symbol, date, sentiment) |
| **Twitter/X** | Finance handles, sector hashtags; requires API access |
| **Sector index performance** | NIFTY IT, BANK, PHARMA daily %; show “hot sectors” on Sector Explorer |

---

## 4. Slack Integration

### Option A: Screener results to Slack (strategy-screener)

- Add `SLACK_WEBHOOK_URL` to strategy-screener `.env`
- New job: after a run (or scheduled), POST a formatted summary to Slack
- Include: strategy name, match count, top 10 symbols, sector breakdown, link to Run page

### Option B: Use existing trading-service

- Trading-service already has `slack_notify.py` for orders/fills
- Extend with: `notify_screener_results(strategy_name, matches, top_picks)`
- Strategy-screener calls trading-service: `POST /trading/notify-screener` with run summary

### Option C: Send to Slack from Run page ✅ (Implemented)

- Run page has a **Slack** button next to AI Picks
- Click to post current results (with sector/cap filters) to your Slack channel
- Requires `SLACK_WEBHOOK_URL` in `.env`. Create at [slack.com/apps](https://api.slack.com/messaging/webhooks)

---

## 5. Trading Service Enhancements (Desktop/trading-service)

Your trading-service supports **Flattrade, Paytm Money, Kotak** and has accounts, orders, positions, PnL. Here is a feature roadmap.

### 5.1 PnL per Account ✅ (Partly there)

- `GET /trading/pnl?account_id=X` already filters by account
- **Enhancement**: Add summary endpoint: `GET /trading/pnl/summary` → `{ account_id: { realized, unrealized, total }, ... }`
- **Dashboard**: Show PnL per account in Trading page as cards or tabs

### 5.2 Positions/Strategies per Account

- Add `strategy` or `tag` to positions (e.g. “momentum”, “value”, “swing”)
- Table: `trading_positions.strategy` or `trading_orders.strategy_tag`
- **UI**: Group positions by strategy; show PnL per strategy per account

### 5.3 Place / Edit Orders

- **Place**: `POST /trading/orders` → body: `{ account_id, symbol, side, qty, order_type, price?, sl?, target? }`
- **Edit**: `PATCH /trading/orders/{id}` → modify price, qty (broker-dependent)
- **Cancel**: `DELETE /trading/orders/{id}`
- **Broker support**: Flattrade API for place/cancel; check if edit is supported

### 5.4 Trailing Stop Loss (TSL)

- **Idea**: Store TSL rules in `trading_trailing_stops` (symbol, account, trigger_type, trail_pct, etc.)
- **Options**:
  1. **Broker-native TSL**: If Flattrade has TSL orders, use directly
  2. **App-managed TSL**: Cron job checks live price vs rule; places SL order when triggered
  3. **Per-strategy TSL**: Different trail % per strategy (e.g. 3% for swing, 1.5% for intraday)

### 5.5 Stop Loss Management

- **SL types**: Fixed SL, trailing SL, breakeven SL (move SL to cost when profit > X%)
- **Bulk update**: “Move all SL to breakeven” or “Trail all by 2%”
- **Sync**: When broker reports fill, update local position; recompute SL levels

### 5.6 Fyers Integration (Optional)

- Strategy-screener uses Fyers for OHLCV
- Trading-service uses Flattrade
- To unify: add Fyers adapter to trading-service for orders/positions (if you trade via Fyers)

---

## Next Steps (Suggested Order)

1. **OpenAI key** — Get key from platform.openai.com; enable AI Picks
2. **Slack screener** — Add webhook + “Send to Slack” for run results (quick win)
3. **PnL summary** — Trading-service endpoint for per-account PnL summary
4. **Trailing SL** — Design `trading_trailing_stops` schema; implement cron or broker-native
5. **News** — Start with NSE announcements; add RSS for sector headlines
