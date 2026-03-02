-- Add market_type and timeframe columns to strategies table
-- market_type: 'stocks' (default) or 'commodities'
-- timeframe: '1D' (default), '4H', '2H', '1H'

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'stocks';
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS timeframe TEXT NOT NULL DEFAULT '1D';
