import React, { useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const tradingApiBase = process.env.REACT_APP_TRADING_API_URL || '';

const MODES = [
  { value: 'buy_and_hold', label: 'Buy & hold (first day equal weight)' },
  { value: 'sequential_entries', label: 'Sequential entries (add each day)' },
  { value: 'daily_screen_rebalance', label: 'Daily rebalance to universe (high turnover)' },
];

const UNIVERSE_TYPES = [
  { value: 'explicit', label: 'Explicit symbols' },
  { value: 'sector', label: 'Sector (market DB)' },
  { value: 'all_eq', label: 'All NSE-EQ (capped)' },
];

/** Backend: auto → equal_weight (buy&hold / rebalance) or fixed_inr (sequential). */
const SIZING_MODES = [
  { value: 'auto', label: 'Auto (mode default)' },
  { value: 'equal_weight', label: 'Equal weight (split deployable cash)' },
  { value: 'fixed_inr', label: 'Fixed ₹ per position' },
  { value: 'fixed_qty', label: 'Fixed quantity (shares)' },
  { value: 'percent_equity', label: '% of equity per position' },
];

function sizingValueHint(mode, sizingMode) {
  if (sizingMode === 'fixed_inr') return 'Rupees allocated to each buy (e.g. 50000).';
  if (sizingMode === 'fixed_qty') return 'Shares per buy (can be fractional in sim).';
  if (sizingMode === 'percent_equity') return '% of portfolio equity at entry (e.g. 10 = 10% per name). If 0, backend splits 100% across names.';
  if (sizingMode === 'equal_weight') return 'Value ignored — cash is split evenly across names.';
  if (mode === 'sequential_entries') return 'Auto uses ₹ below as each new entry size.';
  return 'Auto: equal weight on first day for buy & hold / rebalance.';
}

function parseSymbols(text) {
  if (!text || !text.trim()) return [];
  return [...new Set(
    text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
  )];
}

function defaultDates() {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setMonth(start.getMonth() - 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const cardStyle = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '12px',
  overflow: 'hidden',
  marginBottom: '1rem',
};

const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.35rem' };
const inputStyle = {
  width: '100%',
  padding: '0.45rem 0.55rem',
  fontSize: '0.85rem',
  background: '#0f172a',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: '8px',
  boxSizing: 'border-box',
};

export default function BacktestReplay() {
  const defs = useMemo(() => defaultDates(), []);
  const [startDate, setStartDate] = useState(defs.start);
  const [endDate, setEndDate] = useState(defs.end);
  const [initialCash, setInitialCash] = useState(1000000);
  const [commissionPct, setCommissionPct] = useState(0.03);
  const [universeType, setUniverseType] = useState('explicit');
  const [symbolsText, setSymbolsText] = useState('RELIANCE-EQ\nTCS-EQ\nINFY-EQ');
  const [sector, setSector] = useState('Information Technology');
  const [sectorMatch, setSectorMatch] = useState('contains');
  const [allEqLimit, setAllEqLimit] = useState(200);
  const [mode, setMode] = useState('buy_and_hold');
  const [entryCashPerTrade, setEntryCashPerTrade] = useState(50000);
  const [maxPositions, setMaxPositions] = useState(15);
  const [deployFraction, setDeployFraction] = useState(0.98);
  const [sizingMode, setSizingMode] = useState('auto');
  const [sizingValue, setSizingValue] = useState(50000);
  const [exitIfNotInUniverse, setExitIfNotInUniverse] = useState(false);
  const [dailyUniverseJson, setDailyUniverseJson] = useState('');
  const [includeFullTimeline, setIncludeFullTimeline] = useState(false);
  const [dualLane, setDualLane] = useState(false);
  const [lane2UniverseType, setLane2UniverseType] = useState('sector');
  const [lane2Sector, setLane2Sector] = useState('Banking');
  const [lane2SymbolsText, setLane2SymbolsText] = useState('');
  const [lane2Mode, setLane2Mode] = useState('buy_and_hold');
  const [lane1Fraction, setLane1Fraction] = useState(0.5);
  const [resultTab, setResultTab] = useState('combined');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const tradingApi = tradingApiBase ? axios.create({ baseURL: tradingApiBase }) : null;

  const buildPayload = useCallback(() => {
    let daily_universe = null;
    if (dailyUniverseJson.trim()) {
      try {
        daily_universe = JSON.parse(dailyUniverseJson);
        if (typeof daily_universe !== 'object' || daily_universe === null) throw new Error('Must be a JSON object');
      } catch (e) {
        throw new Error(`daily_universe JSON: ${e.message}`);
      }
    }

    const f2 = dualLane ? Math.round((1 - lane1Fraction) * 1000) / 1000 : 1;
    const f1 = dualLane ? Math.round(lane1Fraction * 1000) / 1000 : 1;

    const sizingPayload = {
      sizing_mode: sizingMode === 'auto' ? null : sizingMode,
      sizing_value: Number(sizingValue) || 0,
    };

    if (dualLane) {
      const sy1 = universeType === 'explicit' ? parseSymbols(symbolsText) : [];
      const sy2 = lane2UniverseType === 'explicit' ? parseSymbols(lane2SymbolsText) : [];
      return {
        start_date: startDate,
        end_date: endDate,
        initial_cash: initialCash,
        commission_pct: commissionPct,
        include_full_timeline: includeFullTimeline,
        ...sizingPayload,
        strategies: [
          {
            strategy_key: 'lane_1',
            cash_fraction: f1,
            universe_type: universeType,
            symbols: sy1,
            sector: universeType === 'sector' ? sector : null,
            sector_match: sectorMatch,
            all_eq_limit: allEqLimit,
            daily_universe: daily_universe,
            mode,
            entry_cash_per_trade: entryCashPerTrade,
            max_positions: maxPositions,
            deploy_fraction: deployFraction,
            exit_if_not_in_universe: exitIfNotInUniverse,
            ...sizingPayload,
          },
          {
            strategy_key: 'lane_2',
            cash_fraction: f2,
            universe_type: lane2UniverseType,
            symbols: sy2,
            sector: lane2UniverseType === 'sector' ? lane2Sector : null,
            sector_match: sectorMatch,
            all_eq_limit: allEqLimit,
            daily_universe: null,
            mode: lane2Mode,
            entry_cash_per_trade: entryCashPerTrade,
            max_positions: maxPositions,
            deploy_fraction: deployFraction,
            exit_if_not_in_universe: false,
            ...sizingPayload,
          },
        ],
      };
    }

    const sy = universeType === 'explicit' ? parseSymbols(symbolsText) : [];
    return {
      start_date: startDate,
      end_date: endDate,
      initial_cash: initialCash,
      commission_pct: commissionPct,
      include_full_timeline: includeFullTimeline,
      ...sizingPayload,
      symbols: sy,
      universe_type: universeType,
      sector: universeType === 'sector' ? sector : null,
      sector_match: sectorMatch,
      all_eq_limit: allEqLimit,
      daily_universe: daily_universe,
      mode,
      entry_cash_per_trade: entryCashPerTrade,
      max_positions: maxPositions,
      deploy_fraction: deployFraction,
      exit_if_not_in_universe: exitIfNotInUniverse,
    };
  }, [
    startDate, endDate, initialCash, commissionPct, includeFullTimeline, universeType, symbolsText,
    sector, sectorMatch, allEqLimit, dailyUniverseJson, mode, entryCashPerTrade, maxPositions,
    deployFraction, exitIfNotInUniverse, dualLane, lane1Fraction, lane2UniverseType, lane2Sector,
    lane2SymbolsText, lane2Mode, sizingMode, sizingValue,
  ]);

  const runBacktest = () => {
    if (!tradingApi) return;
    setError(null);
    setResult(null);
    let payload;
    try {
      payload = buildPayload();
    } catch (e) {
      setError(e.message);
      return;
    }
    const hasDu = !!(payload.daily_universe && Object.keys(payload.daily_universe).length);
    if (universeType === 'explicit' && !dualLane && payload.symbols?.length === 0 && !hasDu) {
      setError('Add symbols (one per line) or paste daily_universe JSON.');
      return;
    }
    if (dualLane && universeType === 'explicit' && parseSymbols(symbolsText).length === 0 && !hasDu) {
      setError('Lane 1: add symbols or daily_universe JSON.');
      return;
    }
    if (dualLane && lane2UniverseType === 'explicit' && parseSymbols(lane2SymbolsText).length === 0) {
      setError('Lane 2: add symbols or change universe type.');
      return;
    }
    setLoading(true);
    tradingApi.post('/admin/backtest-replay', payload)
      .then(r => {
        setResult(r.data);
        if (r.data.error) setError(r.data.error);
        setResultTab('combined');
      })
      .catch(e => {
        const d = e.response?.data?.detail;
        setError(typeof d === 'string' ? d : e.message);
      })
      .finally(() => setLoading(false));
  };

  const chartMtm = useMemo(() => {
    if (!result?.combined_timeline_compact?.length) return [];
    return result.combined_timeline_compact.map(r => ({
      date: r.date.slice(5),
      mtm: r.mtm_close,
      pnl: r.daily_pnl,
    }));
  }, [result]);

  const strategyKeys = result?.strategies ? Object.keys(result.strategies) : [];

  if (!tradingApiBase) {
    return (
      <div style={{ padding: '1rem 0' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', color: '#f1f5f9' }}>Backtest replay</h1>
        <p style={{ color: '#64748b', marginTop: '0.5rem' }}>
          Set <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>REACT_APP_TRADING_API_URL</code> to your trading-service (same as Trading page), then rebuild.
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem', color: '#f1f5f9' }}>Backtest replay</h1>
      <p style={{ color: '#64748b', margin: '0.35rem 0 1rem', fontSize: '0.85rem', maxWidth: '720px', lineHeight: 1.5 }}>
        Dry-run on daily OHLC in your market DB (<code style={{ background: '#0f172a', padding: '1px 4px', borderRadius: '4px' }}>ohlcv_1d</code>).
        Trading-service needs <code style={{ background: '#0f172a', padding: '1px 4px', borderRadius: '4px' }}>MARKET_DATABASE_URL</code>.
        Screener-accurate lists: paste <strong style={{ color: '#94a3b8' }}>daily_universe</strong> JSON from archived runs.
      </p>

      {error && (
        <div style={{
          padding: '0.65rem 1rem', marginBottom: '1rem', borderRadius: '8px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start' }}>
        <div style={{ ...cardStyle, flex: '1 1 300px', maxWidth: '100%', width: 'min(400px, 100%)' }}>
          <div style={{ padding: '0.65rem 0.85rem', borderBottom: '1px solid #334155', fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0' }}>
            Run parameters
          </div>
          <div style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={labelStyle}>Start date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>End date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Initial cash (₹)</label>
              <input type="number" value={initialCash} onChange={e => setInitialCash(Number(e.target.value))} style={inputStyle} min={1000} step={10000} />
            </div>
            <div>
              <label style={labelStyle}>Commission % per leg</label>
              <input type="number" value={commissionPct} onChange={e => setCommissionPct(Number(e.target.value))} style={inputStyle} min={0} step={0.01} />
            </div>
            <div>
              <label style={labelStyle}>Universe</label>
              <select value={universeType} onChange={e => setUniverseType(e.target.value)} style={inputStyle}>
                {UNIVERSE_TYPES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            {universeType === 'explicit' && (
              <div>
                <label style={labelStyle}>Symbols (comma or newline)</label>
                <textarea value={symbolsText} onChange={e => setSymbolsText(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }} />
              </div>
            )}
            {universeType === 'sector' && (
              <>
                <div>
                  <label style={labelStyle}>Sector text</label>
                  <input value={sector} onChange={e => setSector(e.target.value)} style={inputStyle} placeholder="e.g. Information Technology" />
                </div>
                <div>
                  <label style={labelStyle}>Match</label>
                  <select value={sectorMatch} onChange={e => setSectorMatch(e.target.value)} style={inputStyle}>
                    <option value="contains">Contains (ILIKE)</option>
                    <option value="exact">Exact</option>
                  </select>
                </div>
              </>
            )}
            {universeType === 'all_eq' && (
              <div>
                <label style={labelStyle}>Max symbols (cap)</label>
                <input type="number" value={allEqLimit} onChange={e => setAllEqLimit(Number(e.target.value))} style={inputStyle} min={10} max={5000} />
              </div>
            )}
            <div>
              <label style={labelStyle}>Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)} style={inputStyle}>
                {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {(mode === 'sequential_entries' || mode === 'daily_screen_rebalance') && (
              <>
                <div>
                  <label style={labelStyle}>Fallback entry ₹ (if fixed ₹ sizing value is 0)</label>
                  <input type="number" value={entryCashPerTrade} onChange={e => setEntryCashPerTrade(Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Max positions</label>
                  <input type="number" value={maxPositions} onChange={e => setMaxPositions(Number(e.target.value))} style={inputStyle} min={1} />
                </div>
              </>
            )}
            <div>
              <label style={labelStyle}>Deploy fraction</label>
              <input type="number" value={deployFraction} onChange={e => setDeployFraction(Number(e.target.value))} style={inputStyle} min={0.1} max={1} step={0.01} />
            </div>
            <div>
              <label style={labelStyle}>Position sizing (TradingView-style)</label>
              <select value={sizingMode} onChange={e => setSizingMode(e.target.value)} style={inputStyle}>
                {SIZING_MODES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sizing value</label>
              <input
                type="number"
                value={sizingValue}
                onChange={e => setSizingValue(Number(e.target.value))}
                style={inputStyle}
                min={0}
                step={sizingMode === 'percent_equity' ? 0.5 : sizingMode === 'fixed_qty' ? 0.01 : 1000}
              />
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.35rem', lineHeight: 1.4 }}>
                {sizingValueHint(mode, sizingMode)}
              </div>
            </div>
            {mode === 'sequential_entries' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={exitIfNotInUniverse} onChange={e => setExitIfNotInUniverse(e.target.checked)} />
                Exit if symbol leaves daily_universe
              </label>
            )}
            <div>
              <label style={labelStyle}>daily_universe JSON (optional)</label>
              <textarea
                value={dailyUniverseJson}
                onChange={e => setDailyUniverseJson(e.target.value)}
                rows={3}
                placeholder='{"2024-01-02": ["RELIANCE-EQ", "TCS-EQ"]}'
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.7rem' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#94a3b8', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeFullTimeline} onChange={e => setIncludeFullTimeline(e.target.checked)} />
              Include full timeline JSON (heavy)
            </label>

            <div style={{ borderTop: '1px solid #334155', paddingTop: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={dualLane} onChange={e => setDualLane(e.target.checked)} />
                Compare two lanes (split capital)
              </label>
              {dualLane && (
                <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div>
                    <label style={labelStyle}>Lane 1 cash fraction ({lane1Fraction.toFixed(2)})</label>
                    <input type="range" min={0.1} max={0.9} step={0.05} value={lane1Fraction} onChange={e => setLane1Fraction(Number(e.target.value))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Lane 2 universe</label>
                    <select value={lane2UniverseType} onChange={e => setLane2UniverseType(e.target.value)} style={inputStyle}>
                      {UNIVERSE_TYPES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  {lane2UniverseType === 'sector' && (
                    <input value={lane2Sector} onChange={e => setLane2Sector(e.target.value)} style={inputStyle} placeholder="Sector" />
                  )}
                  {lane2UniverseType === 'explicit' && (
                    <textarea value={lane2SymbolsText} onChange={e => setLane2SymbolsText(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.75rem' }} placeholder="Symbols" />
                  )}
                  <div>
                    <label style={labelStyle}>Lane 2 mode</label>
                    <select value={lane2Mode} onChange={e => setLane2Mode(e.target.value)} style={inputStyle}>
                      {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={runBacktest}
              disabled={loading}
              style={{
                marginTop: '0.25rem',
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: loading ? '#475569' : '#4f46e5',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'Running…' : 'Run backtest'}
            </button>
          </div>
        </div>

        <div style={{ flex: '3 1 400px', minWidth: 0 }}>
          {loading && (
            <div style={{ ...cardStyle, padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Running backtest…</div>
          )}
          {!result && !loading && (
            <div style={{ ...cardStyle, padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
              Results will appear here: equity curve, daily PnL, and activity days with entries/exits.
            </div>
          )}

          {result && !result.error && (
            <>
              <div style={{ ...cardStyle, padding: '0.85rem 1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                  <Stat label="Final MTM (combined)" value={`₹${Number(result.final_mtm_close_combined || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} accent />
                  <Stat
                    label="PnL"
                    value={`₹${Number(result.pnl_abs_combined || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${Number(result.pnl_pct_combined || 0).toFixed(2)}%)`}
                    pnlTone={(result.pnl_abs_combined || 0) >= 0}
                  />
                  <Stat label="Trading days" value={String(result.trading_days || 0)} />
                  <Stat label="OHLC symbols loaded" value={String(result.universe_symbol_count || 0)} />
                </div>
                {(result.warnings || []).length > 0 && (
                  <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.2rem', color: '#fbbf24', fontSize: '0.75rem' }}>
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </div>

              <div style={cardStyle}>
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #334155', fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0' }}>
                  Combined MTM (close)
                </div>
                <div style={{ width: '100%', height: 280, padding: '0.5rem' }}>
                  {chartMtm.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartMtm} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${(v / 1e5).toFixed(1)}L`} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: '0.75rem' }} labelStyle={{ color: '#94a3b8' }} />
                        <Legend />
                        <Line type="monotone" dataKey="mtm" name="MTM ₹" stroke="#818cf8" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ color: '#64748b', padding: '2rem', textAlign: 'center' }}>No timeline data</div>
                  )}
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #334155', fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0' }}>
                  Combined daily PnL (₹)
                </div>
                <div style={{ width: '100%', height: 220, padding: '0.5rem' }}>
                  {chartMtm.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartMtm} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: '0.75rem' }} />
                        <Bar dataKey="pnl" name="Daily PnL" fill="#34d399" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : null}
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #334155', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0', marginRight: '0.5rem' }}>Detail</span>
                  {['combined', 'activity', ...strategyKeys].filter((v, i, a) => a.indexOf(v) === i).map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setResultTab(key)}
                      style={{
                        padding: '0.25rem 0.55rem',
                        borderRadius: '6px',
                        border: resultTab === key ? '1px solid #6366f1' : '1px solid #334155',
                        background: resultTab === key ? 'rgba(99,102,241,0.2)' : '#0f172a',
                        color: '#e2e8f0',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                      }}
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '0.75rem', maxHeight: '420px', overflow: 'auto', fontSize: '0.78rem' }}>
                  {resultTab === 'combined' && (
                    <pre style={{ margin: 0, color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(result.combined_timeline_compact?.slice(-40) || [], null, 2)}
                      {(result.combined_timeline_compact?.length || 0) > 40 ? '\n… (truncated, last 40 days)' : ''}
                    </pre>
                  )}
                  {resultTab === 'activity' && (
                    <ActivityTable days={result.combined_activity_days || []} />
                  )}
                  {strategyKeys.includes(resultTab) && result.strategies[resultTab] && (
                    <StrategyBlock data={result.strategies[resultTab]} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, pnlTone }) {
  let color = '#cbd5e1';
  if (accent) color = '#e2e8f0';
  if (pnlTone === true) color = '#4ade80';
  if (pnlTone === false) color = '#f87171';
  return (
    <div>
      <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ActivityTable({ days }) {
  if (!days.length) return <div style={{ color: '#64748b' }}>No activity days (no trades / position changes).</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ color: '#64748b', fontSize: '0.65rem', textAlign: 'left' }}>
          <th style={{ padding: '0.35rem' }}>Date</th>
          <th style={{ padding: '0.35rem' }}>Daily PnL</th>
          <th style={{ padding: '0.35rem' }}>Lanes / events</th>
        </tr>
      </thead>
      <tbody>
        {days.map(d => (
          <tr key={d.date} style={{ borderTop: '1px solid #1e293b', verticalAlign: 'top' }}>
            <td style={{ padding: '0.45rem 0.35rem', color: '#e2e8f0', fontFamily: 'monospace' }}>{d.date}</td>
            <td style={{ padding: '0.45rem 0.35rem', color: d.daily_pnl >= 0 ? '#4ade80' : '#f87171' }}>{Number(d.daily_pnl).toFixed(0)}</td>
            <td style={{ padding: '0.45rem 0.35rem', color: '#94a3b8' }}>
              {(d.lanes || []).map((L, i) => (
                <div key={i} style={{ marginBottom: '0.35rem' }}>
                  <strong style={{ color: '#a5b4fc' }}>{L.strategy_key}</strong>
                  {L.entries?.length ? <span> +{L.entries.length} buy</span> : null}
                  {L.exits?.length ? <span> −{L.exits.length} sell</span> : null}
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StrategyBlock({ data }) {
  if (data.error) return <div style={{ color: '#f87171' }}>{data.error}</div>;
  return (
    <div>
      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#94a3b8' }}>
        <span>Final MTM <strong style={{ color: '#e2e8f0' }}>₹{Number(data.final_mtm_close || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong></span>
        <span>PnL <strong style={{ color: (data.pnl_abs || 0) >= 0 ? '#4ade80' : '#f87171' }}>₹{Number(data.pnl_abs || 0).toFixed(0)}</strong></span>
        <span>Trades {data.trades_count}</span>
      </div>
      <div style={{ fontWeight: 600, color: '#64748b', fontSize: '0.7rem', marginBottom: '0.35rem' }}>Activity (sample)</div>
      <pre style={{ margin: 0, color: '#94a3b8', fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
        {JSON.stringify((data.activity_days || []).slice(0, 15), null, 2)}
      </pre>
    </div>
  );
}
