# Daily AI Screener Report (→ Slack)

Runs all stock strategies, collects passed stocks, top 10 per sector, and sends an AI-powered analysis to Slack.

## What it does

1. **Collect** — Runs every active stock strategy and collects all unique stocks that passed
2. **Top 10 per sector** — For each parent sector (Automobiles, Banking & Finance, IT & Technology, etc.), picks the top 10 by market cap
3. **AI prompt** — Builds one comprehensive prompt with:
   - All passed stocks (symbol, sector, cap, close, Rev, P/E, ROCE, RevCAGR)
   - Top 10 per sector
   - Instructions to consider: financials, current themes, govt schemes (PLI, infra, defence, renewables), global macro
4. **AI analysis** — GPT picks: best sector(s), top 5–8 stock picks with rationale and risks
5. **Slack** — Posts the full report (summary + top 10 + AI output) to your channel

## Setup

1. **OpenAI API key** (for AI analysis):
   ```bash
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini  # optional, default
   ```

2. **Slack webhook**:
   - Create an app at [api.slack.com/apps](https://api.slack.com/apps)
   - Add "Incoming Webhooks", create webhook for your channel
   - Add to `.env`:
   ```bash
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzy
   ```

3. **Ensure data is fresh** — Run OHLCV update and financials scrape so the AI has meaningful data.

## How to run

**From Admin UI** — Go to Admin → "Daily AI Screener Report" → "Run Daily AI Report → Slack"

**From API**:
```bash
curl -X POST http://localhost:8000/admin/daily-ai-report
```

**Scheduled (cron)** — See `deploy/screener-cron` (e.g. weekdays 9 AM IST).

## Slack message format

- **Summary**: Total stocks passed, by sector counts, strategies run
- **Top 10 per sector**: Condensed list of top picks by sector
- **AI Analysis**: Best sector, top stock picks with rationale, key risks
