-- Add source column if missing (scrape_financials requires it)
ALTER TABLE stock_financials ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'screener.in';
