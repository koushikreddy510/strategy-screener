CREATE TABLE IF NOT EXISTS strategies (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  market_type TEXT NOT NULL DEFAULT 'stocks',
  timeframe TEXT NOT NULL DEFAULT '1D',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

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
