import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import api from '../api';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const PAGE_SIZE = 20;
const SIGNAL_COLORS = { bullish: '#4ade80', bearish: '#f87171', neutral: '#fbbf24' };
const SIGNAL_BG = { bullish: 'rgba(34,197,94,0.15)', bearish: 'rgba(239,68,68,0.15)', neutral: 'rgba(251,191,36,0.15)' };
const STRENGTH_LABELS = { 1: 'Weak', 2: 'Medium', 3: 'Strong' };
const STRENGTH_COLORS = { 1: '#64748b', 2: '#fbbf24', 3: '#4ade80' };

function SignalBadge({ signal }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600,
      background: SIGNAL_BG[signal] || SIGNAL_BG.neutral, color: SIGNAL_COLORS[signal] || SIGNAL_COLORS.neutral,
    }}>
      {signal === 'bullish' ? '▲' : signal === 'bearish' ? '▼' : '●'} {signal}
    </span>
  );
}

function StrengthDots({ strength }) {
  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
      {[1, 2, 3].map(i => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: i <= strength ? STRENGTH_COLORS[strength] : '#334155',
        }} />
      ))}
      <span style={{ fontSize: '0.65rem', color: '#64748b', marginLeft: '4px' }}>{STRENGTH_LABELS[strength]}</span>
    </span>
  );
}

function formatMCap(v) {
  if (!v || v <= 0) return '-';
  const cr = v / 1e7;
  if (cr >= 100000) return `${(cr / 100000).toFixed(1)}L Cr`;
  if (cr >= 1000) return `${(cr / 1000).toFixed(1)}K Cr`;
  return `${cr.toFixed(0)} Cr`;
}

function CapBadge({ category }) {
  if (!category || category === 'Unknown') return <span className="badge badge-micro">-</span>;
  const cls = category.includes('Large') ? 'badge-large' : category.includes('Mid') ? 'badge-mid' : category.includes('Small') ? 'badge-small' : 'badge-micro';
  return <span className={`badge ${cls}`}>{category}</span>;
}

/** Inline candlestick chart with pattern trendlines drawn on top */
function PatternChart({ chartData, patternLines, signal, width = 140, height = 56 }) {
  if (!chartData || chartData.length < 2) return null;
  const pad = 4;
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  const lows = chartData.map(d => d.low).filter(Boolean);
  const highs = chartData.map(d => d.high).filter(Boolean);
  const pMin = Math.min(...lows, ...highs);
  const pMax = Math.max(...lows, ...highs);
  const range = pMax - pMin || 1;
  const n = chartData.length;
  const cw = Math.max(1, (w / n) * 0.7);

  const y = (price) => pad + h - ((price - pMin) / range) * h;
  const x = (i) => pad + (i / (n - 1)) * w;

  const stroke = signal === 'bullish' ? '#4ade80' : signal === 'bearish' ? '#f87171' : '#fbbf24';

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {chartData.map((d, i) => {
        const cx = x(i);
        const isUp = d.close >= d.open;
        const bodyTop = y(Math.max(d.open, d.close));
        const bodyBot = y(Math.min(d.open, d.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const lowY = y(d.low);
        const highY = y(d.high);
        return (
          <g key={i}>
            <line x1={cx} y1={highY} x2={cx} y2={lowY} stroke="#94a3b8" strokeWidth={0.8} />
            <rect x={cx - cw / 2} y={bodyTop} width={cw} height={bodyH}
              fill={isUp ? '#22c55e' : '#ef4444'} stroke={isUp ? '#4ade80' : '#f87171'} strokeWidth={0.5} />
          </g>
        );
      })}
      {patternLines && patternLines.map((line, li) => {
        const pts = (line.points || []).filter(p => p.i >= 0 && p.i < n);
        if (pts.length < 2) return null;
        const color = line.type === 'resistance' ? '#f97316' : line.type === 'support' ? '#06b6d4' : '#a855f7';
        const pathD = pts.map((p, pi) => `${pi === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.value)}`).join(' ');
        return <path key={li} d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 2" />;
      })}
    </svg>
  );
}

/** Full-size candlestick chart with pattern lines (SVG, uses viewBox for scaling) */
function FullCandlestickChart({ data, patternLines }) {
  if (!data?.length) return null;
  const vw = 900;
  const vh = 420;
  const pad = { top: 20, right: 15, bottom: 32, left: 58 };
  const w = vw - pad.left - pad.right;
  const h = vh - pad.top - pad.bottom;
  const lows = data.map(d => d.low).filter(Boolean);
  const highs = data.map(d => d.high).filter(Boolean);
  const pMin = Math.min(...lows, ...highs);
  const pMax = Math.max(...lows, ...highs);
  const range = pMax - pMin || 1;
  const n = data.length;
  const cw = Math.max(1.5, (w / n) * 0.75);
  const y = (price) => pad.top + h - ((price - pMin) / range) * h;
  const x = (i) => pad.left + (i / Math.max(1, n - 1)) * w;
  const dtKey = data[0]?.date !== undefined ? 'date' : 'datetime';
  const ticks = [];
  for (let i = 0; i <= 4; i++) ticks.push(pMin + (range * i) / 4);

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 420, display: 'block' }}>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={pad.left} y1={y(v)} x2={pad.left + w} y2={y(v)} stroke="#334155" strokeDasharray="2 2" strokeWidth={0.5} />
          <text x={pad.left - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#64748b">{v.toFixed(0)}</text>
        </g>
      ))}
      {[0, Math.floor(n / 2), n - 1].map(i => (
        <text key={i} x={x(i)} y={vh - 8} textAnchor="middle" fontSize={9} fill="#64748b">
          {data[i]?.[dtKey] ? String(data[i][dtKey]).slice(0, 10) : ''}
        </text>
      ))}
      {data.map((d, i) => {
        const cx = x(i);
        const isUp = d.close >= d.open;
        const bodyTop = y(Math.max(d.open, d.close));
        const bodyBot = y(Math.min(d.open, d.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={i}>
            <line x1={cx} y1={y(d.high)} x2={cx} y2={y(d.low)} stroke="#94a3b8" strokeWidth={1.2} />
            <rect x={cx - cw / 2} y={bodyTop} width={cw} height={bodyH}
              fill={isUp ? '#22c55e' : '#ef4444'} stroke={isUp ? '#4ade80' : '#f87171'} strokeWidth={1} />
          </g>
        );
      })}
      {(patternLines || []).map((line, li) => {
        const pts = (line.points || []).filter(p => p.i >= 0 && p.i < n);
        if (pts.length < 2) return null;
        const color = line.type === 'resistance' ? '#f97316' : line.type === 'support' ? '#06b6d4' : '#a855f7';
        const pathD = pts.map((p, pi) => `${pi === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.value)}`).join(' ');
        return <path key={li} d={pathD} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" />;
      })}
    </svg>
  );
}

function ChartModal({ symbol, pattern, patternLines, chartData, signal }) {
  const [chartMode, setChartMode] = useState('candlesticks');
  const data = chartData;

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const onClose = () => window.dispatchEvent(new CustomEvent('chart-modal-close'));

  const loading = !data;
  const dtKey = data?.[0]?.date !== undefined ? 'date' : 'datetime';
  const pMin = data ? Math.min(...data.map(d => d.low).filter(Boolean)) : 0;
  const pMax = data ? Math.max(...data.map(d => d.high).filter(Boolean)) : 0;
  const pad = (pMax - pMin) * 0.05;

  const chartWithLines = data ? data.map((d, i) => {
    const out = { ...d };
    (patternLines || []).forEach((line, li) => {
      const pt = (line.points || []).find(p => p.i === i);
      if (pt) out[`_line_${line.type}_${li}`] = pt.value;
    });
    return out;
  }) : [];

  const lineKeys = [];
  (patternLines || []).forEach((line, li) => {
    const hasAny = chartWithLines.some(d => d[`_line_${line.type}_${li}`] != null);
    if (hasAny) lineKeys.push({ key: `_line_${line.type}_${li}`, type: line.type });
  });

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
        width: '100%', maxWidth: 920, padding: '1.5rem', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#f1f5f9' }}>
            {symbol} — {pattern}
            <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: SIGNAL_COLORS[signal] }}>({signal})</span>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ display: 'flex', background: '#334155', borderRadius: '8px', padding: '2px' }}>
              <button onClick={() => setChartMode('candlesticks')} style={{
                padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                background: chartMode === 'candlesticks' ? '#6366f1' : 'transparent',
                color: chartMode === 'candlesticks' ? 'white' : '#94a3b8', border: 'none', cursor: 'pointer',
              }}>Candlesticks</button>
              <button onClick={() => setChartMode('line')} style={{
                padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                background: chartMode === 'line' ? '#6366f1' : 'transparent',
                color: chartMode === 'line' ? 'white' : '#94a3b8', border: 'none', cursor: 'pointer',
              }}>Line</button>
            </div>
            <button onClick={onClose} style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem',
              background: '#334155', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}>✕ Close</button>
          </div>
        </div>
        {loading ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <span style={{ animation: 'pulse 1.5s infinite' }}>Loading chart...</span>
          </div>
        ) : !data?.length ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>No data</div>
        ) : chartMode === 'candlesticks' ? (
          <FullCandlestickChart data={data} patternLines={patternLines} />
        ) : (
          <div style={{ width: '100%', height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartWithLines} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey={dtKey} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v ? String(v).slice(5, 10) : ''} interval="preserveStartEnd" stroke="#475569" />
                <YAxis domain={[pMin - pad, pMax + pad]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => typeof v === 'number' ? v.toFixed(0) : v} width={65} stroke="#475569" />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '0.8rem', color: '#f1f5f9' }}
                  labelStyle={{ fontSize: '0.75rem', color: '#94a3b8' }}
                  formatter={(v, n) => [v != null && typeof v === 'number' ? v.toFixed(2) : '-', n]} />
                <Line type="monotone" dataKey="close" stroke="#fbbf24" strokeWidth={2} dot={false} name="Close" connectNulls />
                {lineKeys.map((lk, idx) => (
                  <Line key={lk.key} type="monotone" dataKey={lk.key} stroke={lk.type === 'resistance' ? '#f97316' : lk.type === 'support' ? '#06b6d4' : '#a855f7'}
                    strokeWidth={2} dot={false} connectNulls strokeDasharray="5 3" name={lk.type} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
          Orange: resistance · Cyan: support · Purple: cup/handle
        </p>
      </div>
    </div>,
    document.body
  );
}

export default function ChartPatterns() {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [patterns, setPatterns] = useState([]);
  const [patternCounts, setPatternCounts] = useState({});
  const [signalCounts, setSignalCounts] = useState({});
  const [sectors, setSectors] = useState([]);
  const [parentSectors, setParentSectors] = useState([]);
  const [signal, setSignal] = useState('all');
  const [pattern, setPattern] = useState('all');
  const [capFilter, setCapFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [sortBy, setSortBy] = useState('strength');
  const [sortDir, setSortDir] = useState('desc');
  const [lookback, setLookback] = useState(25);
  const [viewRow, setViewRow] = useState(null);
  const [screen, setScreen] = useState('structural');
  const [timeframe, setTimeframe] = useState('1D');
  const [chartBars, setChartBars] = useState(120);

  const fetchData = useCallback((p, sig, pat, cf, sf, sb, sd, lb, sc, tf, cb) => {
    setLoading(true);
    const s = sc ?? screen;
    const t = tf ?? timeframe;
    const b = cb ?? chartBars;
    if (s === '52w' || s === 'near52w' || s === 'band_5_10' || s === 'at_high') {
      let url = `/patterns/52w?page=${p}&page_size=${PAGE_SIZE}&sort_by=${sb}&sort_dir=${sd}&chart_bars=${b}&chart_timeframe=${t}`;
      if (s === 'near52w') url += '&near_pct=5';
      if (s === 'band_5_10') url += '&pct_from_high_min=5&pct_from_high_max=10';
      if (s === 'at_high') url += '&at_52w_high=true';
      if (cf && cf !== 'all') url += `&cap_filter=${cf}`;
      if (sf && sf !== 'all') url += `&sector_filter=${encodeURIComponent(sf)}`;
      api.get(url).then(r => {
        setResults(r.data.results);
        setTotal(r.data.total);
        setPage(r.data.page);
        setPatterns([]);
        setPatternCounts({});
        setSignalCounts({});
        setSectors(r.data.sectors || []);
        setParentSectors(r.data.parent_sectors || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      let url = `/patterns/structural?page=${p}&page_size=${PAGE_SIZE}&sort_by=${sb}&sort_dir=${sd}&lookback=${lb}&timeframe=${t}&chart_bars=${b}`;
      if (sig && sig !== 'all') url += `&signal=${sig}`;
      if (pat && pat !== 'all') url += `&pattern=${encodeURIComponent(pat)}`;
      if (cf && cf !== 'all') url += `&cap_filter=${cf}`;
      if (sf && sf !== 'all') url += `&sector_filter=${encodeURIComponent(sf)}`;
      api.get(url).then(r => {
        setResults(r.data.results);
        setTotal(r.data.total);
        setPage(r.data.page);
        setPatterns(r.data.patterns || []);
        setPatternCounts(r.data.pattern_counts || {});
        setSignalCounts(r.data.signal_counts || {});
        setSectors(r.data.sectors || []);
        setParentSectors(r.data.parent_sectors || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [screen, timeframe, chartBars]);

  useEffect(() => {
    const defSort = ['52w', 'near52w', 'band_5_10', 'at_high'].includes(screen) ? 'pct_from_high' : 'strength';
    fetchData(1, signal, pattern, capFilter, sectorFilter, defSort, sortDir, lookback, screen, timeframe, chartBars);
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = () => setViewRow(null);
    window.addEventListener('chart-modal-close', h);
    return () => window.removeEventListener('chart-modal-close', h);
  }, []);

  const handleSignal = (v) => { setSignal(v); setPattern('all'); fetchData(1, v, 'all', capFilter, sectorFilter, sortBy, sortDir, lookback); };
  const handlePattern = (v) => { setPattern(v); fetchData(1, signal, v, capFilter, sectorFilter, sortBy, sortDir, lookback); };
  const handleCap = (v) => { setCapFilter(v); fetchData(1, signal, pattern, v, sectorFilter, sortBy, sortDir, lookback); };
  const handleSector = (v) => { setSectorFilter(v); fetchData(1, signal, pattern, capFilter, v, sortBy, sortDir, lookback); };
  const handleLookback = (v) => { setLookback(v); fetchData(1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, v); };
  const handleScreen = (v) => {
    setScreen(v);
    setSortBy(['52w', 'near52w', 'band_5_10', 'at_high'].includes(v) ? 'pct_from_high' : 'strength');
  };
  const handleTimeframe = (v) => { setTimeframe(v); fetchData(1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, lookback, undefined, v); };
  const handleChartBars = (v) => { setChartBars(v); fetchData(1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, lookback, undefined, undefined, v); };

  const handleSort = (col) => {
    const nd = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(col); setSortDir(nd);
    fetchData(1, signal, pattern, capFilter, sectorFilter, col, nd, lookback);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const sortIcon = (col) => sortBy !== col ? ' ↕' : sortDir === 'desc' ? ' ↓' : ' ↑';
  const bullCount = signalCounts.bullish || 0;
  const bearCount = signalCounts.bearish || 0;
  const neutCount = signalCounts.neutral || 0;
  const is52wScreen = ['52w', 'near52w', 'band_5_10', 'at_high'].includes(screen);

  return (
    <div>
      {viewRow && (
        <ChartModal
          symbol={viewRow.symbol}
          pattern={viewRow.pattern || viewRow.screen}
          patternLines={viewRow.pattern_lines}
          chartData={viewRow.chart_data}
          signal={viewRow.signal || 'neutral'}
        />
      )}

      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: '0.15rem', fontSize: '1.3rem' }}>Chart Patterns</h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
          Structural patterns, 52-week high/low, distance bands, sector filters (NSE + parent groups) · 1D & 1W
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button onClick={() => handleScreen('structural')} style={{
          padding: '0.35rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          border: screen === 'structural' ? '1.5px solid #6366f1' : '1px solid #334155',
          background: screen === 'structural' ? '#6366f1' : '#1e293b',
          color: screen === 'structural' ? 'white' : '#94a3b8', cursor: 'pointer',
        }}>Structural</button>
        <button onClick={() => handleScreen('52w')} style={{
          padding: '0.35rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          border: screen === '52w' ? '1.5px solid #6366f1' : '1px solid #334155',
          background: screen === '52w' ? '#6366f1' : '#1e293b',
          color: screen === '52w' ? 'white' : '#94a3b8', cursor: 'pointer',
        }}>52-Week H/L</button>
        <button onClick={() => handleScreen('near52w')} style={{
          padding: '0.35rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          border: screen === 'near52w' ? '1.5px solid #6366f1' : '1px solid #334155',
          background: screen === 'near52w' ? '#6366f1' : '#1e293b',
          color: screen === 'near52w' ? 'white' : '#94a3b8', cursor: 'pointer',
        }}>Near High (≤5%)</button>
        <button onClick={() => handleScreen('band_5_10')} style={{
          padding: '0.35rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          border: screen === 'band_5_10' ? '1.5px solid #6366f1' : '1px solid #334155',
          background: screen === 'band_5_10' ? '#6366f1' : '#1e293b',
          color: screen === 'band_5_10' ? 'white' : '#94a3b8', cursor: 'pointer',
        }}>5–10% Below High</button>
        <button onClick={() => handleScreen('at_high')} style={{
          padding: '0.35rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          border: screen === 'at_high' ? '1.5px solid #6366f1' : '1px solid #334155',
          background: screen === 'at_high' ? '#6366f1' : '#1e293b',
          color: screen === 'at_high' ? 'white' : '#94a3b8', cursor: 'pointer',
        }}>At 52w High (~1%)</button>
      </div>

      {!is52wScreen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
          <SummaryCard label="Bullish" count={bullCount} color="#4ade80" bg="rgba(34,197,94,0.1)" active={signal === 'bullish'} onClick={() => handleSignal(signal === 'bullish' ? 'all' : 'bullish')} />
          <SummaryCard label="Bearish" count={bearCount} color="#f87171" bg="rgba(239,68,68,0.1)" active={signal === 'bearish'} onClick={() => handleSignal(signal === 'bearish' ? 'all' : 'bearish')} />
          <SummaryCard label="Neutral" count={neutCount} color="#fbbf24" bg="rgba(251,191,36,0.1)" active={signal === 'neutral'} onClick={() => handleSignal(signal === 'neutral' ? 'all' : 'neutral')} />
          <SummaryCard label="All" count={bullCount + bearCount + neutCount} color="#818cf8" bg="rgba(99,102,241,0.1)" active={signal === 'all'} onClick={() => handleSignal('all')} />
        </div>
      )}

      {!is52wScreen && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <PatternChip label="All" count={bullCount + bearCount + neutCount} active={pattern === 'all'} onClick={() => handlePattern('all')} />
          {patterns.map(p => (
            <PatternChip key={p} label={p} count={patternCounts[p] || 0} active={pattern === p} onClick={() => handlePattern(p)} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={timeframe} onChange={e => handleTimeframe(e.target.value)} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
          <option value="1D">1D</option>
          <option value="1W">1W</option>
        </select>
        <select value={chartBars} onChange={e => handleChartBars(parseInt(e.target.value))} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
          <option value={60}>60 bars</option>
          <option value={90}>90 bars</option>
          <option value={120}>120 bars</option>
          <option value={150}>150 bars</option>
        </select>
        <select value={capFilter} onChange={e => handleCap(e.target.value)} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
          <option value="all">All Caps</option>
          <option value="large_cap">Large Cap</option>
          <option value="mid_cap">Mid Cap</option>
          <option value="small_cap">Small Cap</option>
          <option value="micro_cap">Micro Cap</option>
        </select>
        {(sectors.length > 0 || parentSectors.length > 0) && (
          <select value={sectorFilter} onChange={e => handleSector(e.target.value)} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto', maxWidth: 260 }}>
            <option value="all">All sectors</option>
            {parentSectors.length > 0 && (
              <optgroup label="Parent groups (sector rotation)">
                {parentSectors.map(ps => <option key={`p:${ps}`} value={ps}>{ps}</option>)}
              </optgroup>
            )}
            {sectors.length > 0 && (
              <optgroup label="NSE industry (granular)">
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            )}
          </select>
        )}
        {!is52wScreen && (
          <select value={lookback} onChange={e => handleLookback(parseInt(e.target.value))} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
            <option value={20}>20 bars</option>
            <option value={25}>25 bars</option>
            <option value={30}>30 bars</option>
            <option value={40}>40 bars</option>
          </select>
        )}
        <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{total} result{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155' }}>
                <Th>#</Th>
                <Th>Chart</Th>
                <Th align="left">Symbol</Th>
                {!is52wScreen && <Th align="left">Pattern</Th>}
                {!is52wScreen && <Th>Signal</Th>}
                {!is52wScreen && <Th clickable onClick={() => handleSort('strength')}>Strength{sortIcon('strength')}</Th>}
                {is52wScreen && <Th clickable onClick={() => handleSort('pct_from_high')}>% from High{sortIcon('pct_from_high')}</Th>}
                {is52wScreen && <Th clickable onClick={() => handleSort('pct_from_low')}>% from Low{sortIcon('pct_from_low')}</Th>}
                {is52wScreen && <Th>52w High</Th>}
                {is52wScreen && <Th>52w Low</Th>}
                <Th clickable onClick={() => handleSort('close')}>Close{sortIcon('close')}</Th>
                {!is52wScreen && <Th clickable onClick={() => handleSort('volume')}>Vol{sortIcon('volume')}</Th>}
                <Th clickable onClick={() => handleSort('market_cap')}>MCap{sortIcon('market_cap')}</Th>
                <Th>Cap</Th>
                {is52wScreen && <Th>Parent</Th>}
                <Th>Sector</Th>
                <Th>View</Th>
              </tr>
            </thead>
            <tbody>
              {loading && results.length === 0 ? (
                <tr><td colSpan={is52wScreen ? 13 : 12} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  <span style={{ animation: 'pulse 1.5s infinite' }}>Scanning...</span>
                </td></tr>
              ) : results.length === 0 ? (
                <tr><td colSpan={is52wScreen ? 13 : 12} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>No results</td></tr>
              ) : results.map((r, idx) => {
                const n = (page - 1) * PAGE_SIZE + idx + 1;
                return (
                  <tr key={`${r.symbol}-${r.pattern || idx}-${idx}`} style={{ borderBottom: '1px solid #334155', transition: 'background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#334155'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <Td muted>{n}</Td>
                    <Td style={{ padding: '0.25rem', verticalAlign: 'middle' }}>
                      <PatternChart chartData={r.chart_data} patternLines={r.pattern_lines} signal={r.signal || 'neutral'} />
                    </Td>
                    <Td align="left" bold primary>{r.symbol}</Td>
                    {!is52wScreen && <Td align="left" bold>{r.pattern}</Td>}
                    {!is52wScreen && <Td><SignalBadge signal={r.signal} /></Td>}
                    {!is52wScreen && <Td><StrengthDots strength={r.strength} /></Td>}
                    {is52wScreen && <Td bold style={{ color: r.pct_from_high <= 5 ? '#4ade80' : '#94a3b8' }}>{r.pct_from_high}%</Td>}
                    {is52wScreen && <Td>{r.pct_from_low}%</Td>}
                    {is52wScreen && <Td small>{r.high_52w}</Td>}
                    {is52wScreen && <Td small>{r.low_52w}</Td>}
                    <Td bold>{r.close}</Td>
                    {!is52wScreen && <Td>{r.volume >= 1e6 ? `${(r.volume / 1e6).toFixed(1)}M` : `${(r.volume / 1e3).toFixed(0)}K`}</Td>}
                    <Td small>{formatMCap(r.market_cap)}</Td>
                    <Td><CapBadge category={r.market_cap_category} /></Td>
                    {is52wScreen && <Td small>{r.parent_sector || '-'}</Td>}
                    <Td small muted>{r.sector ? (r.sector.length > 18 ? r.sector.slice(0, 18) + '…' : r.sector) : '-'}</Td>
                    <Td>
                      <button onClick={() => setViewRow({ ...r, pattern: r.pattern || '52-Week' })} style={{
                        padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600,
                        background: 'rgba(99,102,241,0.12)', border: '1px solid #6366f1', color: '#818cf8', cursor: 'pointer',
                      }}>View</button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.35rem', marginTop: '1.25rem' }}>
          <PgBtn disabled={page <= 1} onClick={() => fetchData(page - 1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, lookback)}>←</PgBtn>
          {pgNums(page, totalPages).map((p, i) =>
            p === '...' ? <span key={`e${i}`} style={{ color: '#64748b', padding: '0 0.25rem' }}>...</span> :
            <PgBtn key={p} active={p === page} onClick={() => fetchData(p, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, lookback)}>{p}</PgBtn>
          )}
          <PgBtn disabled={page >= totalPages} onClick={() => fetchData(page + 1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, lookback)}>→</PgBtn>
        </div>
      )}

      {loading && results.length > 0 && (
        <div style={{ textAlign: 'center', padding: '0.75rem', color: '#64748b', fontSize: '0.8rem', animation: 'pulse 1.5s infinite' }}>Loading...</div>
      )}
    </div>
  );
}

function SummaryCard({ label, count, color, bg, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '0.75rem 1rem', borderRadius: '10px', textAlign: 'left', cursor: 'pointer',
      background: active ? bg : '#1e293b', border: active ? `1.5px solid ${color}` : '1px solid #334155',
      transition: 'all 0.15s',
    }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>{label}</div>
    </button>
  );
}

function PatternChip({ label, count, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '0.25rem 0.6rem', borderRadius: '8px', fontSize: '0.7rem', fontWeight: active ? 700 : 500,
      border: active ? '1.5px solid #6366f1' : '1px solid #334155',
      background: active ? '#6366f1' : '#1e293b',
      color: active ? 'white' : '#94a3b8', cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {label} <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>({count})</span>
    </button>
  );
}

function Th({ children, align, clickable, onClick }) {
  return (
    <th onClick={onClick} style={{
      padding: '0.6rem 0.5rem', textAlign: align || 'center', fontWeight: 600, fontSize: '0.7rem',
      color: '#64748b', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em',
      cursor: clickable ? 'pointer' : 'default', userSelect: clickable ? 'none' : 'auto',
    }}>{children}</th>
  );
}

function Td({ children, align, bold, muted, small, primary }) {
  return (
    <td style={{
      padding: '0.5rem 0.5rem', textAlign: align || 'center', whiteSpace: 'nowrap',
      fontWeight: bold ? 600 : 400, color: primary ? '#818cf8' : muted ? '#64748b' : '#f1f5f9',
      fontSize: small ? '0.75rem' : '0.82rem',
    }}>{children}</td>
  );
}

function PgBtn({ children, active, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '0.35rem 0.6rem', borderRadius: '6px', minWidth: '32px', fontSize: '0.8rem', fontWeight: active ? 700 : 400,
      border: active ? '1.5px solid #6366f1' : '1px solid #334155',
      background: active ? '#6366f1' : '#334155',
      color: active ? 'white' : '#94a3b8',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  );
}

function pgNums(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
