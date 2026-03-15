# Financials Data Setup

The screener shows financial columns (Rev, OPM%, P/E, P/B, etc.) when 10+ stocks match. This data comes from the **stock_financials** table, which is populated by scraping [screener.in](https://www.screener.in).

## Why are Latest Results showing null for revenue, P/E, etc.?

The **Latest Results** tab shows companies that announced results (from NSE). The financial numbers (revenue, net_profit, opm_pct, pe_ratio, etc.) come from a JOIN with **stock_financials**. If `stock_financials` is empty or missing those symbols, all financial fields will be `null`.

**Recommended workflow to fix empty columns:**

1. Run **Latest Results** scraper (Admin → scrape last 7–30 days) — populates `result_announcements` with NSE dates/symbols.
2. Run **Scrape Latest Announcements Only** (Admin → Financial Results) — scrapes financials for just those announcement symbols (~1 req/sec). Much faster than Scrape Full.
3. Refresh the Financials page — Latest Results will show revenue, P/E, etc. for scraped symbols.

Alternatively, run "Update (Incremental)" or "Scrape Full" to populate all symbols; announcement symbols are prioritized first.

## Current status

Run the diagnostic to check your data:

```bash
DATABASE_URL="postgresql://market_user:market_pass@localhost:5432/market" python3 scripts/check_financials_data.py
```

- **0 rows** = No financials scraped yet. Follow steps below.
- **source column missing** = Run the migration first.

## 1. Add source column (if needed)

The scrape script requires a `source` column. If the diagnostic shows the table exists but inserts fail:

```bash
psql $DATABASE_URL -f migrations/add_financials_source.sql
```

Or with explicit URL:

```bash
PGPASSWORD=market_pass psql -h localhost -U market_user -d market -f migrations/add_financials_source.sql
```

## 2. Populate financials

**Option A: Via Admin UI**

1. Go to **Admin** in the app.
2. Find the **Financial Results** section.
3. Use **Scrape Latest Announcements Only** to quickly fill Latest Results (only symbols that announced in last 45 days).
4. Or use **Update (Incremental)** (scrapes symbols not done in last 7 days) or **Scrape Full** (all symbols).
5. Wait — it scrapes ~1 req/sec to avoid rate limits. After completion, refresh the Financials page to see updated counts.

**Note:** Job state is in-memory. If the backend restarts, completed jobs disappear from the Admin UI. Refresh the Financials page after a scrape to confirm data.

**Option B: Via data-store script directly**

```bash
cd /path/to/data-store
export DATABASE_URL="postgresql://market_user:market_pass@localhost:5432/market"
python scrape_financials.py --limit 50    # Test with 50 symbols first
python scrape_financials.py               # Full run (all symbols)
```

Note: The script reads symbols from the `symbols` table. Run **Sync symbols** first if needed.

## 3. Verify

After scraping, run the diagnostic again. You should see row counts and sample data. Financial columns will then appear in screener results when 10+ stocks match.

---

## Screener.in Latest Results (rate limit & login)

The **Scrape Screener.in Latest** job fetches `/results/latest/`. It now has:

- **3 second delay** before the request (configurable via `SCREENER_REQUEST_DELAY_SEC`)
- **429 retries** — on "Too Many Requests", waits 10s and retries up to 3 times

### Using session cookies (if page requires login)

1. Log in to [screener.in](https://www.screener.in) in your browser (Google or email).
2. Open DevTools → Application → Cookies → `https://www.screener.in`
3. Copy the cookie string (e.g. `sessionid=abc123; csrftoken=xyz`)
4. Set in your env or `.env`:
   ```
   SCREENER_SESSION_COOKIE=sessionid=abc123; csrftoken=xyz
   ```
5. Restart the backend so it picks up the env var.
6. Run the job again from Admin.

Cookies expire; you may need to refresh them periodically.
