import React, { useMemo, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import api from '../api';
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
  { value: 'screener_strategy', label: 'Screener strategy results (current)' },
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

const DATE_PRESETS = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'YTD', label: 'YTD' },
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

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRangeForPreset(preset) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  if (preset === 'YTD') {
    start.setMonth(0, 1);
  } else if (preset === '1M') {
    start.setMonth(start.getMonth() - 1);
  } else if (preset === '3M') {
    start.setMonth(start.getMonth() - 3);
  } else if (preset === '6M') {
    start.setMonth(start.getMonth() - 6);
  } else if (preset === '1Y') {
    start.setFullYear(start.getFullYear() - 1);
  }
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function fmtMoney(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

function fmtPct(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(digits)}%`;
}

function fmtNum(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(digits);
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
const smallBtnStyle = {
  padding: '0.35rem 0.6rem',
  borderRadius: '7px',
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export default function BacktestReplay() {
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialStrategyId = queryParams.get('strategy_id') || '';
  const defs = useMemo(() => defaultDates(), []);
  const [startDate, setStartDate] = useState(defs.start);
  const [endDate, setEndDate] = useState(defs.end);
  const [initialCash, setInitialCash] = useState(1000000);
  const [commissionPct, setCommissionPct] = useState(0.03);
  const [targetPortfolioSize, setTargetPortfolioSize] = useState(25);
  const [universeType, setUniverseType] = useState(initialStrategyId ? 'screener_strategy' : 'explicit');
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
  const [includeFullTimeline, setIncludeFullTimeline] = useState(true);
  const [financialFilterEnabled, setFinancialFilterEnabled] = useState(false);
  const [requireFinancials, setRequireFinancials] = useState(true);
  const [sectorTopPct, setSectorTopPct] = useState(30);
  const [minOpmPct, setMinOpmPct] = useState('');
  const [minRocePct, setMinRocePct] = useState('');
  const [minRoePct, setMinRoePct] = useState('');
  const [maxPeRatio, setMaxPeRatio] = useState('');
  const [maxPbRatio, setMaxPbRatio] = useState('');
  const [stopLossPct, setStopLossPct] = useState(0);
  const [exitOnEma, setExitOnEma] = useState(false);
  const [exitEmaPeriod, setExitEmaPeriod] = useState(100);
  const [exitOnRsi, setExitOnRsi] = useState(false);
  const [exitRsiBelow, setExitRsiBelow] = useState(35);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
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
  const [strategies, setStrategies] = useState([]);
  const [strategiesLoading, setStrategiesLoading] = useState(false);
  const [screenerStrategyId, setScreenerStrategyId] = useState(initialStrategyId);
  const [screenerResolved, setScreenerResolved] = useState(null);

  const tradingApi = tradingApiBase ? axios.create({ baseURL: tradingApiBase }) : null;

  useEffect(() => {
    setStrategiesLoading(true);
    api.get('/strategies/?market_type=stocks')
      .then(r => {
        setStrategies(r.data || []);
        if (!screenerStrategyId && r.data?.length) {
          setScreenerStrategyId(String(r.data[0].id));
        }
      })
      .catch(() => {})
      .finally(() => setStrategiesLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchScreenerDailyUniverse = useCallback(async () => {
    if (!screenerStrategyId) {
      throw new Error('Choose a screener strategy.');
    }
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      max_symbols: '0',
    });
    const res = await api.get(`/run/${screenerStrategyId}/daily-universe?${params.toString()}`);
    const daily = res.data?.daily_universe || {};
    setScreenerResolved({
      count: res.data?.symbols_seen || 0,
      total: res.data?.symbols_seen || 0,
      signalDays: res.data?.total_signal_days || 0,
      strategyId: screenerStrategyId,
    });
    return daily;
  }, [screenerStrategyId, startDate, endDate]);

  const buildPayload = useCallback(async () => {
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
    const advancedPayload = {
      financial_filters: {
        enabled: financialFilterEnabled,
        require_financials: requireFinancials,
        max_symbols: Number(targetPortfolioSize) || 0,
        sector_top_pct: financialFilterEnabled ? Number(sectorTopPct) || 0 : 0,
        min_opm_pct: minOpmPct === '' ? null : Number(minOpmPct),
        min_roce_pct: minRocePct === '' ? null : Number(minRocePct),
        min_roe_pct: minRoePct === '' ? null : Number(minRoePct),
        max_pe_ratio: maxPeRatio === '' ? null : Number(maxPeRatio),
        max_pb_ratio: maxPbRatio === '' ? null : Number(maxPbRatio),
      },
      stop_loss_pct: Number(stopLossPct) || 0,
      exit_rules: {
        exit_on_close_below_ema: exitOnEma,
        close_below_ema_period: Number(exitEmaPeriod) || 100,
        exit_on_rsi_below: exitOnRsi,
        rsi_below: Number(exitRsiBelow) || 35,
        rsi_period: 14,
      },
    };

    if (dualLane) {
      const screenerDailyUniverse = (universeType === 'screener_strategy' || lane2UniverseType === 'screener_strategy')
        ? await fetchScreenerDailyUniverse()
        : null;
      const sy1 = universeType === 'explicit'
        ? parseSymbols(symbolsText)
        : [];
      const sy2 = lane2UniverseType === 'explicit'
        ? parseSymbols(lane2SymbolsText)
        : [];
      return {
        start_date: startDate,
        end_date: endDate,
        initial_cash: initialCash,
        commission_pct: commissionPct,
        include_full_timeline: includeFullTimeline,
        ...sizingPayload,
        ...advancedPayload,
        strategies: [
          {
            strategy_key: 'lane_1',
            cash_fraction: f1,
            universe_type: universeType === 'screener_strategy' ? 'explicit' : universeType,
            symbols: sy1,
            sector: universeType === 'sector' ? sector : null,
            sector_match: sectorMatch,
            all_eq_limit: allEqLimit,
            daily_universe: universeType === 'screener_strategy' ? screenerDailyUniverse : daily_universe,
            mode: universeType === 'screener_strategy' && mode === 'buy_and_hold' ? 'sequential_entries' : mode,
            entry_cash_per_trade: entryCashPerTrade,
            max_positions: universeType === 'screener_strategy' ? Number(targetPortfolioSize) || maxPositions : maxPositions,
            deploy_fraction: deployFraction,
            exit_if_not_in_universe: exitIfNotInUniverse,
            ...sizingPayload,
            ...advancedPayload,
          },
          {
            strategy_key: 'lane_2',
            cash_fraction: f2,
            universe_type: lane2UniverseType === 'screener_strategy' ? 'explicit' : lane2UniverseType,
            symbols: sy2,
            sector: lane2UniverseType === 'sector' ? lane2Sector : null,
            sector_match: sectorMatch,
            all_eq_limit: allEqLimit,
            daily_universe: lane2UniverseType === 'screener_strategy' ? screenerDailyUniverse : null,
            mode: lane2UniverseType === 'screener_strategy' && lane2Mode === 'buy_and_hold' ? 'sequential_entries' : lane2Mode,
            entry_cash_per_trade: entryCashPerTrade,
            max_positions: lane2UniverseType === 'screener_strategy' ? Number(targetPortfolioSize) || maxPositions : maxPositions,
            deploy_fraction: deployFraction,
            exit_if_not_in_universe: false,
            ...sizingPayload,
            ...advancedPayload,
          },
        ],
      };
    }

    const sy = universeType === 'explicit'
      ? parseSymbols(symbolsText)
      : [];
    const screenerDailyUniverse = universeType === 'screener_strategy'
      ? await fetchScreenerDailyUniverse()
      : null;
    return {
      start_date: startDate,
      end_date: endDate,
      initial_cash: initialCash,
      commission_pct: commissionPct,
      include_full_timeline: includeFullTimeline,
      ...sizingPayload,
      ...advancedPayload,
      symbols: sy,
      universe_type: universeType === 'screener_strategy' ? 'explicit' : universeType,
      sector: universeType === 'sector' ? sector : null,
      sector_match: sectorMatch,
      all_eq_limit: allEqLimit,
      daily_universe: universeType === 'screener_strategy' ? screenerDailyUniverse : daily_universe,
      mode: universeType === 'screener_strategy' && mode === 'buy_and_hold' ? 'sequential_entries' : mode,
      entry_cash_per_trade: entryCashPerTrade,
      max_positions: universeType === 'screener_strategy' ? Number(targetPortfolioSize) || maxPositions : maxPositions,
      deploy_fraction: deployFraction,
      exit_if_not_in_universe: exitIfNotInUniverse,
    };
  }, [
    startDate, endDate, initialCash, commissionPct, includeFullTimeline, universeType, symbolsText,
    sector, sectorMatch, allEqLimit, dailyUniverseJson, mode, entryCashPerTrade, maxPositions,
    deployFraction, exitIfNotInUniverse, dualLane, lane1Fraction, lane2UniverseType, lane2Sector,
    lane2SymbolsText, lane2Mode, sizingMode, sizingValue, fetchScreenerDailyUniverse, financialFilterEnabled,
    requireFinancials, sectorTopPct, minOpmPct, minRocePct, minRoePct, maxPeRatio, maxPbRatio,
    stopLossPct, exitOnEma, exitEmaPeriod, exitOnRsi, exitRsiBelow, targetPortfolioSize,
  ]);

  const runBacktest = async () => {
    if (!tradingApi) return;
    setError(null);
    setResult(null);
    let payload;
    try {
      setLoading(true);
      payload = await buildPayload();
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    const hasDu = !!(payload.daily_universe && Object.keys(payload.daily_universe).length);
    if (universeType === 'explicit' && !dualLane && payload.symbols?.length === 0 && !hasDu) {
      setError('Add symbols (one per line) or paste daily_universe JSON.');
      setLoading(false);
      return;
    }
    if (universeType === 'screener_strategy' && !dualLane && payload.symbols?.length === 0 && !hasDu) {
      setError('Selected screener strategy returned no matched symbols.');
      setLoading(false);
      return;
    }
    if (dualLane && universeType === 'explicit' && parseSymbols(symbolsText).length === 0 && !hasDu) {
      setError('Lane 1: add symbols or daily_universe JSON.');
      setLoading(false);
      return;
    }
    if (dualLane && lane2UniverseType === 'explicit' && parseSymbols(lane2SymbolsText).length === 0) {
      setError('Lane 2: add symbols or change universe type.');
      setLoading(false);
      return;
    }
    tradingApi.post('/admin/backtest-replay', payload)
      .then(r => {
        setResult(r.data);
        if (r.data.error) setError(r.data.error);
        setResultTab('combined');
        setReplayIndex(0);
        setReplayPlaying(false);
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
      drawdown_pct: -(r.drawdown_pct || 0),
    }));
  }, [result]);

  const strategyKeys = useMemo(() => (
    result?.strategies ? Object.keys(result.strategies) : []
  ), [result]);
  const combinedAnalytics = result?.analytics_combined || null;
  const replayRows = useMemo(() => {
    if (!result) return [];
    const firstKey = strategyKeys.find(k => result.strategies?.[k]?.timeline?.length);
    if (firstKey) return result.strategies[firstKey].timeline.map(row => ({ ...row, strategy_key: firstKey }));
    return result.combined_timeline_compact || [];
  }, [result, strategyKeys]);
  const replayDay = replayRows[Math.min(replayIndex, Math.max(0, replayRows.length - 1))] || null;

  useEffect(() => {
    if (!replayPlaying || replayRows.length <= 1) return undefined;
    const id = setInterval(() => {
      setReplayIndex(i => {
        if (i >= replayRows.length - 1) {
          setReplayPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 650);
    return () => clearInterval(id);
  }, [replayPlaying, replayRows.length]);

  const applyPreset = (preset) => {
    const range = dateRangeForPreset(preset);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  if (!tradingApiBase) {
    return (
      <div style={{ padding: '1rem 0', maxWidth: '640px' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', color: '#f1f5f9' }}>Backtest replay</h1>
        <p style={{ color: '#94a3b8', marginTop: '0.5rem', lineHeight: 1.55, fontSize: '0.88rem' }}>
          This page calls the same <strong style={{ color: '#e2e8f0' }}>trading-service</strong> API as the Trading page.
        </p>
        <ol style={{ color: '#64748b', margin: '0.75rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.65, fontSize: '0.85rem' }}>
          <li>
            In <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>frontend/.env</code>, set{' '}
            <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>REACT_APP_TRADING_API_URL</code>
            {' '}to your trading-service base URL (e.g.{' '}
            <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>http://localhost:8001</code>).
            See <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>frontend/.env.example</code>.
          </li>
          <li>Restart <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>npm start</code> (dev) or run <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>npm run build</code> (production).</li>
        </ol>
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
              <label style={labelStyle}>Quick range</label>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => applyPreset(p.value)}
                    style={{
                      padding: '0.3rem 0.55rem',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Initial cash (₹)</label>
              <input type="number" value={initialCash} onChange={e => setInitialCash(Number(e.target.value))} style={inputStyle} min={1000} step={10000} />
            </div>
            <div>
              <label style={labelStyle}>Target portfolio size</label>
              <input type="number" value={targetPortfolioSize} onChange={e => setTargetPortfolioSize(e.target.value)} style={inputStyle} min={0} max={500} />
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.35rem', lineHeight: 1.4 }}>
                Caps the replay universe after screener + financial ranking. Use 20-25 to avoid over-diversifying.
              </div>
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
            {universeType === 'screener_strategy' && (
              <>
                <div>
                  <label style={labelStyle}>Screener strategy</label>
                  <select
                    value={screenerStrategyId}
                    onChange={e => {
                      setScreenerStrategyId(e.target.value);
                      setScreenerResolved(null);
                    }}
                    style={inputStyle}
                    disabled={strategiesLoading}
                  >
                    {strategies.map(s => (
                      <option key={s.id} value={String(s.id)}>{s.name} #{s.id}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.35rem', lineHeight: 1.5 }}>
                    The strategy's conditions (SuperTrend, RSI, EMA, etc.) are evaluated on every historical bar between the two dates.
                    A stock enters the portfolio <strong style={{ color: '#94a3b8' }}>only on the day its strategy signal first fires</strong> — not all at once on day one.
                    When a position is exited (SL / indicator rule), the freed slot is filled the next morning from that day's fresh signals.
                    Exit conditions are checked: SL intraday (at stop price), indicator exits (EMA/RSI) at day close → executed the next morning at open.
                  </div>
                </div>
                {screenerResolved && (
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4 }}>
                    Rebuilt {screenerResolved.signalDays} signal days with {screenerResolved.count} unique symbols from strategy #{screenerResolved.strategyId}.
                  </div>
                )}
              </>
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
              {universeType === 'screener_strategy' && mode === 'buy_and_hold' && (
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.35rem', lineHeight: 1.4 }}>
                  Screener strategies run as sequential signal entries so stocks are added only when they match on that day.
                </div>
              )}
            </div>
            {(mode === 'sequential_entries' || mode === 'daily_screen_rebalance' || universeType === 'screener_strategy') && (
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
                {sizingValueHint(universeType === 'screener_strategy' && mode === 'buy_and_hold' ? 'sequential_entries' : mode, sizingMode)}
              </div>
            </div>
            {(mode === 'sequential_entries' || universeType === 'screener_strategy') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={exitIfNotInUniverse} onChange={e => setExitIfNotInUniverse(e.target.checked)} />
                Exit if symbol leaves daily_universe
              </label>
            )}
            <div style={{ borderTop: '1px solid #334155', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={financialFilterEnabled} onChange={e => setFinancialFilterEnabled(e.target.checked)} />
                Apply financial quality filters before backtest
              </label>
              {financialFilterEnabled && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer' }}>
                    <input type="checkbox" checked={requireFinancials} onChange={e => setRequireFinancials(e.target.checked)} />
                    Require financial data
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label style={labelStyle}>Sector top %</label>
                      <input type="number" value={sectorTopPct} onChange={e => setSectorTopPct(e.target.value)} style={inputStyle} min={0} max={100} step={5} />
                    </div>
                    <div>
                      <label style={labelStyle}>Min OPM %</label>
                      <input type="number" value={minOpmPct} onChange={e => setMinOpmPct(e.target.value)} style={inputStyle} placeholder="optional" />
                    </div>
                    <div>
                      <label style={labelStyle}>Min ROCE %</label>
                      <input type="number" value={minRocePct} onChange={e => setMinRocePct(e.target.value)} style={inputStyle} placeholder="optional" />
                    </div>
                    <div>
                      <label style={labelStyle}>Min ROE %</label>
                      <input type="number" value={minRoePct} onChange={e => setMinRoePct(e.target.value)} style={inputStyle} placeholder="optional" />
                    </div>
                    <div>
                      <label style={labelStyle}>Max P/E</label>
                      <input type="number" value={maxPeRatio} onChange={e => setMaxPeRatio(e.target.value)} style={inputStyle} placeholder="optional" />
                    </div>
                    <div>
                      <label style={labelStyle}>Max P/B</label>
                      <input type="number" value={maxPbRatio} onChange={e => setMaxPbRatio(e.target.value)} style={inputStyle} placeholder="optional" />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{ borderTop: '1px solid #334155', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              <div>
                <label style={labelStyle}>Stop loss % from entry</label>
                <input type="number" value={stopLossPct} onChange={e => setStopLossPct(e.target.value)} style={inputStyle} min={0} step={0.5} placeholder="0 = disabled" />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={exitOnEma} onChange={e => setExitOnEma(e.target.checked)} />
                Exit long if close is below EMA
              </label>
              {exitOnEma && (
                <input type="number" value={exitEmaPeriod} onChange={e => setExitEmaPeriod(e.target.value)} style={inputStyle} min={2} placeholder="EMA period, e.g. 100" />
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={exitOnRsi} onChange={e => setExitOnRsi(e.target.checked)} />
                Exit long if RSI(14) is below
              </label>
              {exitOnRsi && (
                <input type="number" value={exitRsiBelow} onChange={e => setExitRsiBelow(e.target.value)} style={inputStyle} min={1} max={99} placeholder="e.g. 35" />
              )}
            </div>
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
                  {lane2UniverseType === 'screener_strategy' && (
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.4 }}>
                      Lane 2 uses the same selected screener strategy and scan-days settings above.
                    </div>
                  )}
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
                  <Stat label="Final MTM (combined)" value={fmtMoney(result.final_mtm_close_combined)} accent />
                  <Stat
                    label="PnL"
                    value={`${fmtMoney(result.pnl_abs_combined)} (${fmtPct(result.pnl_pct_combined)})`}
                    pnlTone={(result.pnl_abs_combined || 0) >= 0}
                  />
                  <Stat label="Trading days" value={String(result.trading_days || 0)} />
                  <Stat label="OHLC symbols loaded" value={String(result.universe_symbol_count || 0)} />
                  <Stat
                    label="Max Drawdown"
                    value={`${fmtMoney(combinedAnalytics?.max_drawdown_abs)} (${fmtPct(combinedAnalytics?.max_drawdown_pct)})`}
                    pnlTone={false}
                  />
                  <Stat label="Annualized" value={fmtPct(combinedAnalytics?.annualized_return_pct)} />
                  <Stat label="Sharpe-like" value={fmtNum(combinedAnalytics?.sharpe_like, 2)} />
                  <Stat label="Avg positions" value={fmtNum(combinedAnalytics?.avg_position_count, 1)} />
                  <Stat label="Best day" value={fmtMoney(combinedAnalytics?.best_day_pnl)} pnlTone />
                  <Stat label="Worst day" value={fmtMoney(combinedAnalytics?.worst_day_pnl)} pnlTone={false} />
                </div>
                {(result.warnings || []).length > 0 && (
                  <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.2rem', color: '#fbbf24', fontSize: '0.75rem' }}>
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </div>

              {replayRows.length > 0 && (
                <div style={{ ...cardStyle, padding: '0.85rem 1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.85rem' }}>Day-by-day replay</div>
                      <div style={{ color: '#64748b', fontSize: '0.72rem' }}>
                        Step through daily PnL, cash, positions, entries and exits.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button type="button" onClick={() => setReplayIndex(i => Math.max(0, i - 1))} style={smallBtnStyle}>Prev</button>
                      <button type="button" onClick={() => setReplayPlaying(p => !p)} style={{ ...smallBtnStyle, background: replayPlaying ? '#7f1d1d' : '#0f766e' }}>
                        {replayPlaying ? 'Pause' : 'Play'}
                      </button>
                      <button type="button" onClick={() => setReplayIndex(i => Math.min(replayRows.length - 1, i + 1))} style={smallBtnStyle}>Next</button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, replayRows.length - 1)}
                    value={Math.min(replayIndex, Math.max(0, replayRows.length - 1))}
                    onChange={e => setReplayIndex(Number(e.target.value))}
                    style={{ width: '100%', marginBottom: '0.75rem' }}
                  />
                  {replayDay && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.65rem' }}>
                      <Stat label="Replay date" value={replayDay.date} />
                      <Stat label="MTM close" value={fmtMoney(replayDay.mtm_at_close ?? replayDay.mtm_close)} accent />
                      <Stat label="Cash" value={fmtMoney(replayDay.cash)} />
                      <Stat label="Daily PnL" value={fmtMoney(replayDay.daily_pnl)} pnlTone={(replayDay.daily_pnl || 0) >= 0} />
                      <Stat label="Positions" value={String(Object.keys(replayDay.positions_detail || replayDay.positions || {}).length || replayDay.position_count || 0)} />
                    </div>
                  )}
                  {replayDay && (
                    <ReplayDayActivity day={replayDay} />
                  )}
                </div>
              )}

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
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #334155', fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0' }}>
                  Combined drawdown (%)
                </div>
                <div style={{ width: '100%', height: 220, padding: '0.5rem' }}>
                  {chartMtm.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartMtm} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: '0.75rem' }} />
                        <Line type="monotone" dataKey="drawdown_pct" name="Drawdown %" stroke="#f87171" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : null}
                </div>
              </div>

              {/* ── Position ledger — always visible ── */}
              {strategyKeys.length > 0 && (() => {
                const sk = strategyKeys[0];
                const strat = result.strategies?.[sk];
                return strat ? <PositionLedgerCard strat={strat} /> : null;
              })()}

              {/* ── Detail / raw data tabs ── */}
              <div style={cardStyle}>
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #334155', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0', marginRight: '0.5rem' }}>Detail</span>
                  {['activity', 'timeline'].filter((v, i, a) => a.indexOf(v) === i).map(key => (
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
                      {key === 'timeline' ? 'Raw timeline JSON' : 'Activity days'}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '0.75rem', maxHeight: '380px', overflow: 'auto', fontSize: '0.78rem' }}>
                  {resultTab === 'activity' && (
                    <ActivityTable days={result.combined_activity_days || []} />
                  )}
                  {resultTab === 'timeline' && (
                    <pre style={{ margin: 0, color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(result.combined_timeline_compact?.slice(-40) || [], null, 2)}
                      {(result.combined_timeline_compact?.length || 0) > 40 ? '\n… (truncated, last 40 days)' : ''}
                    </pre>
                  )}
                  {resultTab !== 'activity' && resultTab !== 'timeline' && (
                    <ActivityTable days={result.combined_activity_days || []} />
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

function PositionLedgerCard({ strat }) {
  const [tab, setTab] = React.useState('open');
  const ledgers = strat.position_ledgers || {};
  const analytics = strat.analytics || {};
  const openList = ledgers.open_positions || [];
  const closedList = ledgers.closed_positions || [];

  const closedPnl = ledgers.closed_pnl_abs || 0;
  const openPnl = ledgers.open_running_pnl_abs || 0;
  const wins = closedList.filter(p => (p.closed_pnl_abs || 0) > 0).length;
  const winRate = closedList.length ? Math.round((wins / closedList.length) * 100) : null;
  const avgHold = closedList.length
    ? Math.round(closedList.reduce((s, p) => {
        if (!p.entry_date || !p.exit_date) return s;
        const ms = new Date(p.exit_date) - new Date(p.entry_date);
        return s + ms / 86400000;
      }, 0) / closedList.length)
    : null;

  const tabBtn = (key, label, count) => (
    <button
      onClick={() => setTab(key)}
      style={{
        background: tab === key ? '#1e3a5f' : 'transparent',
        color: tab === key ? '#93c5fd' : '#64748b',
        border: tab === key ? '1px solid #2563eb' : '1px solid #334155',
        borderRadius: 6, padding: '0.28rem 0.85rem',
        fontSize: '0.73rem', fontWeight: 700, cursor: 'pointer',
      }}
    >
      {label} ({count})
    </button>
  );

  return (
    <div style={cardStyle}>
      {/* Header summary row */}
      <div style={{ padding: '0.65rem 1rem', borderBottom: '1px solid #1e293b', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Realised PnL</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: closedPnl >= 0 ? '#4ade80' : '#f87171' }}>{fmtMoney(closedPnl)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unrealised PnL</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: openPnl >= 0 ? '#4ade80' : '#f87171' }}>{fmtMoney(openPnl)}</div>
        </div>
        {winRate !== null && (
          <div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Win rate</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: winRate >= 50 ? '#4ade80' : '#f87171' }}>{winRate}%</div>
          </div>
        )}
        {avgHold !== null && (
          <div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg hold</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0' }}>{avgHold}d</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max DD</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f87171' }}>{fmtPct(analytics.max_drawdown_pct)}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          {tabBtn('open', 'Open', openList.length)}
          {tabBtn('closed', 'Closed', closedList.length)}
        </div>
      </div>

      {/* Tables */}
      <div style={{ padding: '0.6rem 0.8rem' }}>
        {tab === 'open' && <OpenPositionsTable positions={openList} />}
        {tab === 'closed' && <ClosedPositionsTable positions={closedList} />}
      </div>
    </div>
  );
}

function ReplayDayActivity({ day }) {
  const openPositions = Object.entries(day.positions_detail || {}).map(([symbol, detail]) => ({ symbol, ...detail }));
  const exits = day.exits_today || [];
  const entries = day.entries_today || [];
  const hasOpen = openPositions.length > 0;
  const hasExits = exits.length > 0;
  const hasEntries = entries.length > 0;

  if (!hasOpen && !hasExits && !hasEntries) return null;

  const sectionLabel = {
    fontWeight: 700, color: '#64748b', fontSize: '0.68rem',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    margin: '0.85rem 0 0.35rem',
  };
  const pillStyle = (good) => ({
    display: 'inline-block', borderRadius: 4, padding: '0.1rem 0.45rem',
    fontSize: '0.65rem', fontWeight: 700,
    background: good ? '#14532d' : '#450a0a',
    color: good ? '#4ade80' : '#f87171',
  });

  return (
    <div style={{ marginTop: '0.85rem' }}>
      {hasEntries && (
        <>
          <div style={sectionLabel}>
            Entered today ({entries.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {entries.map((t, i) => (
              <span key={i} style={pillStyle(true)}>
                {t.symbol?.replace(/^NSE:/, '').replace(/-EQ$/, '')} @ {fmtMoney(t.price, 2)} × {fmtNum(t.qty, 2)}
              </span>
            ))}
          </div>
        </>
      )}
      {hasExits && (
        <>
          <div style={sectionLabel}>Exited today ({exits.length})</div>
          <div style={{ overflow: 'auto', maxHeight: 200 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ color: '#64748b', fontSize: '0.63rem', textAlign: 'left' }}>
                  <th style={{ padding: '0.25rem 0.3rem' }}>Symbol</th>
                  <th style={{ padding: '0.25rem 0.3rem' }}>Entry → Exit</th>
                  <th style={{ padding: '0.25rem 0.3rem' }}>Qty</th>
                  <th style={{ padding: '0.25rem 0.3rem' }}>Closed PnL</th>
                  <th style={{ padding: '0.25rem 0.3rem' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {exits.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #1e293b' }}>
                    <td style={{ padding: '0.3rem', color: '#cbd5e1', fontSize: '0.72rem' }}>
                      {t.symbol?.replace(/^NSE:/, '').replace(/-EQ$/, '')}
                    </td>
                    <td style={{ padding: '0.3rem', color: '#94a3b8', fontSize: '0.72rem' }}>
                      {t.entry_price != null ? fmtMoney(t.entry_price, 2) : '-'} → {fmtMoney(t.price, 2)}
                    </td>
                    <td style={{ padding: '0.3rem', color: '#94a3b8', fontSize: '0.72rem' }}>
                      {fmtNum(t.qty, 2)}
                    </td>
                    <td style={{ padding: '0.3rem', fontSize: '0.72rem', color: (t.pnl_abs || 0) >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                      {t.pnl_abs != null ? `${fmtMoney(t.pnl_abs)} (${fmtPct(t.pnl_pct)})` : '-'}
                    </td>
                    <td style={{ padding: '0.3rem', color: '#64748b', fontSize: '0.67rem' }}>{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {hasOpen && (
        <>
          <div style={sectionLabel}>Open positions ({openPositions.length})</div>
          <OpenPositionsTable positions={openPositions} />
        </>
      )}
    </div>
  );
}


function OpenPositionsTable({ positions, fallbackPositions }) {
  const rows = positions?.length
    ? positions
    : Object.entries(fallbackPositions || {}).map(([symbol, qty]) => ({ symbol, qty }));
  if (!rows.length) return <div style={{ color: '#64748b' }}>No open positions.</div>;
  return (
    <div style={{ overflow: 'auto', maxHeight: 260 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ color: '#64748b', fontSize: '0.65rem', textAlign: 'left' }}>
            <th style={{ padding: '0.35rem' }}>Symbol</th>
            <th style={{ padding: '0.35rem' }}>Qty</th>
            <th style={{ padding: '0.35rem' }}>Entry</th>
            <th style={{ padding: '0.35rem' }}>Current</th>
            <th style={{ padding: '0.35rem' }}>Value</th>
            <th style={{ padding: '0.35rem' }}>Running PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 120).map((p, i) => (
            <tr key={`${p.symbol}-${i}`} style={{ borderTop: '1px solid #1e293b' }}>
              <td style={{ padding: '0.38rem 0.35rem', color: '#cbd5e1' }}>{p.symbol}</td>
              <td style={{ padding: '0.38rem 0.35rem', color: '#94a3b8' }}>{fmtNum(p.qty, 2)}</td>
              <td style={{ padding: '0.38rem 0.35rem', color: '#94a3b8' }}>{p.entry_price == null ? '-' : fmtMoney(p.entry_price, 2)}</td>
              <td style={{ padding: '0.38rem 0.35rem', color: '#94a3b8' }}>{p.current_price == null ? '-' : fmtMoney(p.current_price, 2)}</td>
              <td style={{ padding: '0.38rem 0.35rem', color: '#94a3b8' }}>{p.current_value == null ? '-' : fmtMoney(p.current_value)}</td>
              <td style={{ padding: '0.38rem 0.35rem', color: (p.running_pnl_abs || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                {p.running_pnl_abs == null ? '-' : `${fmtMoney(p.running_pnl_abs)} (${fmtPct(p.running_pnl_pct)})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 120 && (
        <div style={{ color: '#fbbf24', fontSize: '0.7rem', marginTop: '0.4rem' }}>
          Showing first 120 open positions.
        </div>
      )}
    </div>
  );
}

function ClosedPositionsTable({ positions }) {
  if (!positions.length) return <div style={{ color: '#64748b', fontSize: '0.8rem' }}>No closed positions yet.</div>;
  const holdDays = (p) => {
    if (!p.entry_date || !p.exit_date) return null;
    return Math.round((new Date(p.exit_date) - new Date(p.entry_date)) / 86400000);
  };
  const th = { padding: '0.3rem 0.4rem', fontWeight: 600, whiteSpace: 'nowrap' };
  const td = (extra = {}) => ({ padding: '0.35rem 0.4rem', ...extra });
  return (
    <div style={{ overflow: 'auto', maxHeight: 420 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
        <thead style={{ position: 'sticky', top: 0, background: '#0f172a', zIndex: 1 }}>
          <tr style={{ color: '#64748b', fontSize: '0.63rem', textAlign: 'left' }}>
            <th style={th}>Symbol</th>
            <th style={th}>Entry date</th>
            <th style={th}>Entry ₹</th>
            <th style={th}>Exit date</th>
            <th style={th}>Exit ₹</th>
            <th style={th}>Hold</th>
            <th style={th}>Qty</th>
            <th style={th}>Invested</th>
            <th style={th}>Realised</th>
            <th style={th}>PnL</th>
            <th style={th}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            const pnl = p.closed_pnl_abs || 0;
            const days = holdDays(p);
            return (
              <tr key={`${p.exit_date}-${p.symbol}-${i}`} style={{ borderTop: '1px solid #1e293b', fontSize: '0.72rem' }}>
                <td style={td({ color: '#cbd5e1', fontWeight: 600 })}>
                  {(p.symbol || '').replace(/^NSE:/, '').replace(/-EQ$/, '')}
                </td>
                <td style={td({ color: '#94a3b8', fontFamily: 'monospace' })}>{p.entry_date || '—'}</td>
                <td style={td({ color: '#94a3b8' })}>{p.entry_price == null ? '—' : fmtMoney(p.entry_price, 2)}</td>
                <td style={td({ color: '#94a3b8', fontFamily: 'monospace' })}>{p.exit_date || '—'}</td>
                <td style={td({ color: '#94a3b8' })}>{fmtMoney(p.exit_price, 2)}</td>
                <td style={td({ color: '#64748b' })}>{days != null ? `${days}d` : '—'}</td>
                <td style={td({ color: '#64748b' })}>{fmtNum(p.qty, 2)}</td>
                <td style={td({ color: '#94a3b8' })}>{fmtMoney(p.entry_value)}</td>
                <td style={td({ color: '#94a3b8' })}>{fmtMoney(p.exit_value)}</td>
                <td style={td({ color: pnl >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 })}>
                  {fmtMoney(pnl)}<br />
                  <span style={{ fontSize: '0.62rem', fontWeight: 400 }}>({fmtPct(p.closed_pnl_pct)})</span>
                </td>
                <td style={td({ color: '#475569', fontSize: '0.65rem' })}>{p.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {positions.length > 200 && (
        <div style={{ color: '#fbbf24', fontSize: '0.7rem', marginTop: '0.4rem' }}>
          Showing all {positions.length} closed positions.
        </div>
      )}
    </div>
  );
}
