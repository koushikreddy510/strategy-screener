import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useParams, Link, useLocation } from 'react-router-dom';
import api from '../api';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const PAGE_SIZE = 20;
const COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

const MCAP_RANGES = [
  { label: 'All Market Caps', value: 'all' },
  { label: 'Large Cap (> 20K Cr)', value: 'large_cap' },
  { label: 'Mid Cap (5K–20K Cr)', value: 'mid_cap' },
  { label: 'Small Cap (1K–5K Cr)', value: 'small_cap' },
  { label: 'Micro Cap (< 1K Cr)', value: 'micro_cap' },
];

function formatMCap(v) {
  if (!v || v <= 0) return '-';
  const cr = v / 1e7;
  if (cr >= 100000) return `${(cr / 100000).toFixed(1)}L Cr`;
  if (cr >= 1000) return `${(cr / 1000).toFixed(1)}K Cr`;
  return `${cr.toFixed(0)} Cr`;
}

function formatVol(v) {
  if (!v) return '-';
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v;
}

function ChangeBadge({ pct }) {
  if (pct == null) return <span style={{ color: '#64748b' }}>-</span>;
  const pos = pct >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '2px',
      padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600,
      background: pos ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
      color: pos ? '#4ade80' : '#f87171',
    }}>
      {pos ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

function DirectionBadge({ value }) {
  if (!value) return null;
  const bull = value === 'bullish';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: '4px',
      fontSize: '0.65rem', fontWeight: 600,
      background: bull ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: bull ? '#4ade80' : '#f87171',
    }}>
      {bull ? '▲' : '▼'}
    </span>
  );
}

function MarketCapBadge({ category }) {
  if (!category || category === 'Unknown') return <span style={{ color: '#475569', fontSize: '0.7rem' }}>-</span>;
  const colors = {
    'Large Cap': { bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
    'Mid Cap': { bg: 'rgba(34,211,238,0.15)', color: '#22d3ee' },
    'Small Cap': { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
    'Micro Cap': { bg: 'rgba(148,163,184,0.1)', color: '#94a3b8' },
  };
  const c = colors[category] || colors['Micro Cap'];
  return (
    <span style={{
      padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600,
      background: c.bg, color: c.color,
    }}>{category.replace(' Cap', '')}</span>
  );
}

function ChartModal({ symbol, strategy, onClose }) {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartTf, setChartTf] = useState(strategy?.timeframe || '1D');

  const mt = strategy?.market_type || 'stocks';
  const tfs = mt === 'commodities' ? ['1D', '4H', '2H', '1H'] : ['1D'];

  const indConfigs = (strategy?.conditions || []).map(c => {
    const params = typeof c.params === 'string' ? JSON.parse(c.params) : (c.params || {});
    const ps = Object.values(params).length > 0 ? `(${Object.values(params).join(', ')})` : '';
    return { type: c.indicator_type, params, label: `${c.indicator_type.toUpperCase()}${ps}` };
  });

  useEffect(() => {
    setLoading(true);
    api.post('/chart', { symbol, market_type: mt, timeframe: chartTf, indicators: indConfigs, limit: 200 })
      .then(res => { setChartData(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, chartTf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const dtKey = chartData?.[0]?.date !== undefined ? 'date' : 'datetime';
  const indKeys = chartData ? Object.keys(chartData[0] || {}).filter(k =>
    !['date', 'datetime', 'open', 'high', 'low', 'close', 'volume'].includes(k) && !k.endsWith('_dir')
  ) : [];

  const priceMin = chartData ? Math.min(...chartData.map(d => d.low).filter(Boolean)) : 0;
  const priceMax = chartData ? Math.max(...chartData.map(d => d.high).filter(Boolean)) : 0;
  const pad = (priceMax - priceMin) * 0.05;

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
        width: '100%', maxWidth: 1100, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 24px 48px rgba(0,0,0,0.6)', padding: '1.5rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#f1f5f9' }}>{symbol}</h2>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{mt === 'commodities' ? 'MCX' : 'NSE'} &bull; {chartTf}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {tfs.length > 1 && tfs.map(tf => (
              <button key={tf} onClick={() => setChartTf(tf)} style={{
                padding: '0.3rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                border: tf === chartTf ? '1.5px solid #6366f1' : '1px solid #334155',
                background: tf === chartTf ? '#6366f1' : '#334155',
                color: tf === chartTf ? 'white' : '#94a3b8', cursor: 'pointer',
              }}>{tf}</button>
            ))}
            <button onClick={onClose} style={{
              marginLeft: '0.5rem', padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem',
              background: '#334155', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer', fontWeight: 600,
            }}>✕ Close</button>
          </div>
        </div>

        {loading ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <span style={{ animation: 'pulse 1.5s infinite' }}>Loading chart...</span>
          </div>
        ) : !chartData?.length ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>No data</div>
        ) : (
          <div style={{ width: '100%', height: 440 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey={dtKey} tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={v => v ? (v.length > 10 ? v.slice(11, 16) : v.slice(5)) : ''} interval="preserveStartEnd" stroke="#475569" />
                <YAxis domain={[priceMin - pad, priceMax + pad]} tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={v => typeof v === 'number' ? v.toFixed(0) : v} width={65} stroke="#475569" />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '0.8rem', color: '#f1f5f9' }}
                  labelStyle={{ fontSize: '0.75rem', color: '#94a3b8' }}
                  formatter={(v, n) => [v != null && typeof v === 'number' ? v.toFixed(2) : '-', n]} />
                <Legend wrapperStyle={{ fontSize: '0.7rem', color: '#94a3b8' }} />
                <Line type="monotone" dataKey="close" stroke="#fbbf24" strokeWidth={2} dot={false} name="Close" />
                {indKeys.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={1.5} dot={false}
                    strokeDasharray={k.includes('SAR') || k.includes('PSAR') ? '4 2' : undefined} name={k} connectNulls={false} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function ConditionPill({ condition }) {
  const params = typeof condition.params === 'string' ? JSON.parse(condition.params) : (condition.params || {});
  const threshold = typeof condition.threshold === 'string' ? JSON.parse(condition.threshold) : (condition.threshold || {});
  const paramStr = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ');
  const threshStr = threshold.value != null ? threshold.value : threshold.field || '';
  const opMap = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '==': '=', 'cross_above': '↗ crosses above', 'cross_below': '↘ crosses below' };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem',
      background: '#0f172a', border: '1px solid #334155', color: '#94a3b8',
    }}>
      <span style={{ color: '#818cf8', fontWeight: 600 }}>{condition.indicator_type.toUpperCase()}</span>
      {paramStr && <span style={{ color: '#475569' }}>({paramStr})</span>}
      <span style={{ color: '#f59e0b' }}>{opMap[condition.operator] || condition.operator}</span>
      <span style={{ color: '#e2e8f0' }}>{threshStr}</span>
    </span>
  );
}

export default function RunScreen() {
  const { id } = useParams();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const scanDays = parseInt(qp.get('scan_days') || '0', 10);
  const initialSector = qp.get('sector_filter') || 'all';

  const [matches, setMatches] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [strategy, setStrategy] = useState(null);
  const [chartSymbol, setChartSymbol] = useState(null);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const [capFilter, setCapFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState(initialSector);
  const [sectors, setSectors] = useState([]);
  const [matchedOnly, setMatchedOnly] = useState(true);
  const [totalScanned, setTotalScanned] = useState(0);
  const [totalMatched, setTotalMatched] = useState(0);

  useEffect(() => {
    api.get(`/strategies/${id}`).then(r => setStrategy(r.data)).catch(() => {});
  }, [id]);

  const fetchResults = useCallback((p, sb, sd, cf, sf, mo) => {
    setLoading(true);
    setError(null);
    let url = `/run/${id}?scan_days=${scanDays}&page=${p}&page_size=${PAGE_SIZE}`;
    if (sb) url += `&sort_by=${sb}&sort_dir=${sd}`;
    if (cf && cf !== 'all') url += `&cap_filter=${cf}`;
    if (sf && sf !== 'all') url += `&sector_filter=${encodeURIComponent(sf)}`;
    url += `&matched_only=${mo}`;
    api.get(url)
      .then(r => {
        setMatches(r.data.matches);
        setTotal(r.data.total);
        setPage(r.data.page);
        if (r.data.sectors) setSectors(r.data.sectors);
        setTotalScanned(r.data.total_scanned || r.data.total);
        setTotalMatched(r.data.total_matched || r.data.total);
        setLoading(false);
      })
      .catch(e => { setError(e.response?.data?.detail || e.toString()); setLoading(false); });
  }, [id, scanDays]);

  useEffect(() => { fetchResults(1, sortBy, sortDir, capFilter, sectorFilter, matchedOnly); }, [fetchResults]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (col) => {
    const nd = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(col); setSortDir(nd);
    fetchResults(1, col, nd, capFilter, sectorFilter, matchedOnly);
  };

  const handleCapFilter = (v) => { setCapFilter(v); fetchResults(1, sortBy, sortDir, v, sectorFilter, matchedOnly); };
  const handleSectorFilter = (v) => { setSectorFilter(v); fetchResults(1, sortBy, sortDir, capFilter, v, matchedOnly); };
  const handleMatchedToggle = () => {
    const next = !matchedOnly;
    setMatchedOnly(next);
    fetchResults(1, sortBy, sortDir, capFilter, sectorFilter, next);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const mt = strategy?.market_type || 'stocks';
  const isStocks = mt === 'stocks';
  const indKeys = matches.length > 0 ? Object.keys(matches[0].indicators || {}).filter(k => !k.endsWith('_dir')) : [];
  const sortIcon = (col) => sortBy !== col ? ' ↕' : sortDir === 'desc' ? ' ↓' : ' ↑';
  const passRate = totalScanned > 0 ? ((totalMatched / totalScanned) * 100).toFixed(1) : 0;

  if (loading && matches.length === 0 && !error) return (
    <div style={{ textAlign: 'center', padding: '6rem 0' }}>
      <div style={{
        maxWidth: 400, margin: 'auto', padding: '2.5rem', borderRadius: '14px',
        background: '#1e293b', border: '1px solid #334155',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⏳</div>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem', color: '#f1f5f9' }}>Running Screener</h2>
        <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 1.25rem' }}>
          Scanning {isStocks ? 'NSE stocks' : 'MCX commodities'} against {strategy?.conditions?.length || 0} condition{(strategy?.conditions?.length || 0) !== 1 ? 's' : ''}...
        </p>
        <div style={{ width: '100%', background: '#0f172a', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            background: 'linear-gradient(90deg, #6366f1, #818cf8)', height: '100%', width: '60%',
            animation: 'loading 1.5s infinite ease-in-out', borderRadius: '2px',
          }} />
        </div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{
      maxWidth: 500, margin: '4rem auto', padding: '2rem', borderRadius: '14px',
      background: '#1e293b', border: '1px solid #7f1d1d', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⚠️</div>
      <h2 style={{ color: '#f87171', fontSize: '1rem', margin: '0 0 0.5rem' }}>Screener Error</h2>
      <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 1rem' }}>{error}</p>
      <Link to={`/strategies?market=${mt}`} style={{
        display: 'inline-block', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
        background: '#334155', color: '#f1f5f9', textDecoration: 'none', fontWeight: 600,
      }}>← Back to Strategies</Link>
    </div>
  );

  return (
    <div>
      {chartSymbol && <ChartModal symbol={chartSymbol} strategy={strategy} onClose={() => setChartSymbol(null)} />}

      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.25rem' }}>{strategy?.name || 'Results'}</h1>
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700,
                background: '#6366f1', color: 'white', letterSpacing: '0.04em',
              }}>{isStocks ? 'NSE' : 'MCX'}</span>
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600,
                background: '#0f172a', border: '1px solid #334155', color: '#94a3b8',
              }}>{strategy?.timeframe || '1D'}</span>
            </div>
            {strategy?.description && (
              <p style={{ color: '#64748b', margin: 0, fontSize: '0.8rem' }}>{strategy.description}</p>
            )}
          </div>
          <Link to={`/strategies?market=${mt}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
            background: '#334155', border: '1px solid #475569', color: '#94a3b8', textDecoration: 'none',
          }}>← Back</Link>
        </div>
      </div>

      {/* Conditions display */}
      {strategy?.conditions?.length > 0 && (
        <div style={{
          display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center',
          marginBottom: '1rem', padding: '0.75rem', borderRadius: '10px',
          background: '#0f172a', border: '1px solid #1e293b',
        }}>
          <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '0.25rem' }}>
            Conditions:
          </span>
          {strategy.conditions.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && <span style={{ color: '#334155', fontSize: '0.7rem', fontWeight: 600 }}>AND</span>}
              <ConditionPill condition={c} />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
        <StatCard label="Scanned" value={totalScanned} color="#94a3b8" />
        <StatCard label="Matched" value={totalMatched} color="#4ade80" />
        <StatCard label="Pass Rate" value={`${passRate}%`} color="#fbbf24" />
        <StatCard label="Showing" value={total} color="#818cf8" subtitle={matchedOnly ? 'matched only' : 'all stocks'} />
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap',
        padding: '0.6rem 0.75rem', borderRadius: '10px',
        background: '#1e293b', border: '1px solid #334155',
      }}>
        {/* Matched toggle */}
        <button onClick={handleMatchedToggle} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '0.35rem 0.7rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
          background: matchedOnly ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.1)',
          border: matchedOnly ? '1px solid #4ade80' : '1px solid #475569',
          color: matchedOnly ? '#4ade80' : '#94a3b8', cursor: 'pointer',
        }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: matchedOnly ? '#4ade80' : '#475569',
          }} />
          {matchedOnly ? 'Matched Only' : 'All Stocks'}
        </button>

        <span style={{ color: '#334155', margin: '0 0.15rem' }}>|</span>

        {isStocks && (
          <select value={capFilter} onChange={e => handleCapFilter(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', width: 'auto', background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px' }}>
            {MCAP_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}

        {isStocks && sectors.length > 0 && (
          <select value={sectorFilter} onChange={e => handleSectorFilter(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', width: 'auto', maxWidth: 200, background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px' }}>
            <option value="all">All Sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        <span style={{ flex: 1 }} />

        <span style={{ color: '#475569', fontSize: '0.75rem' }}>
          {scanDays === 0 ? 'Latest data' : `Last ${scanDays} days`}
        </span>
      </div>

      {/* Results table */}
      {total === 0 && !loading ? (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem', borderRadius: '14px',
          background: '#1e293b', border: '1px solid #334155',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
          <p style={{ color: '#64748b', margin: '0 0 1rem', fontSize: '0.9rem' }}>No symbols matched the conditions.</p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <Link to={`/strategies/${id}/edit`} style={{
              padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
              background: '#6366f1', color: 'white', textDecoration: 'none', fontWeight: 600,
            }}>Adjust Conditions</Link>
            {matchedOnly && (
              <button onClick={handleMatchedToggle} style={{
                padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                background: '#334155', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer', fontWeight: 600,
              }}>Show All Stocks</button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #334155' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#0f172a' }}>
                    <Th w={36}>#</Th>
                    {!matchedOnly && <Th w={32}>✓</Th>}
                    <Th align="left">Symbol</Th>
                    <Th clickable onClick={() => handleSort('close')}>Close{sortIcon('close')}</Th>
                    <Th clickable onClick={() => handleSort('change_pct')}>Chg%{sortIcon('change_pct')}</Th>
                    <Th>O / H / L</Th>
                    <Th clickable onClick={() => handleSort('volume')}>Volume{sortIcon('volume')}</Th>
                    {isStocks && <Th clickable onClick={() => handleSort('market_cap')}>MCap{sortIcon('market_cap')}</Th>}
                    {isStocks && <Th>Cap</Th>}
                    {isStocks && <Th>Sector</Th>}
                    {indKeys.map(k => <Th key={k}>{k}</Th>)}
                    <Th>Date</Th>
                    <Th w={50}>Chart</Th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, idx) => {
                    const n = (page - 1) * PAGE_SIZE + idx + 1;
                    const isMatch = m.matched !== false;
                    return (
                      <tr key={m.symbol} style={{
                        borderBottom: '1px solid #1e293b', transition: 'background 0.1s',
                        background: !matchedOnly && !isMatch ? 'transparent' : 'transparent',
                        opacity: !matchedOnly && !isMatch ? 0.5 : 1,
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <Td muted>{n}</Td>
                        {!matchedOnly && (
                          <Td>
                            {isMatch ? (
                              <span style={{ color: '#4ade80', fontSize: '0.85rem' }}>●</span>
                            ) : (
                              <span style={{ color: '#334155', fontSize: '0.85rem' }}>○</span>
                            )}
                          </Td>
                        )}
                        <Td align="left">
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.8rem' }}>{m.symbol?.replace('NSE:', '').replace('-EQ', '')}</span>
                            {m.company_name && <span style={{ color: '#475569', fontSize: '0.65rem', lineHeight: 1.2 }}>{m.company_name.length > 20 ? m.company_name.slice(0, 20) + '...' : m.company_name}</span>}
                          </div>
                        </Td>
                        <Td bold>{m.close}</Td>
                        <Td><ChangeBadge pct={m.change_pct} /></Td>
                        <Td muted small>{m.open} / {m.high} / {m.low}</Td>
                        <Td>{formatVol(m.volume)}</Td>
                        {isStocks && <Td small>{formatMCap(m.market_cap)}</Td>}
                        {isStocks && <Td><MarketCapBadge category={m.market_cap_category} /></Td>}
                        {isStocks && <Td small muted title={m.sector}>{m.sector ? (m.sector.length > 16 ? m.sector.slice(0, 16) + '...' : m.sector) : '-'}</Td>}
                        {indKeys.map(k => {
                          const dir = m.indicators?.[k + '_dir'];
                          return (
                            <Td key={k}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'center' }}>
                                <span style={{ fontSize: '0.78rem' }}>{m.indicators?.[k] ?? '-'}</span>
                                {dir && <DirectionBadge value={dir} />}
                              </div>
                            </Td>
                          );
                        })}
                        <Td muted small>{m.date?.slice(0, 10)}</Td>
                        <Td>
                          <button onClick={() => setChartSymbol(m.symbol)} style={{
                            padding: '3px 8px', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 600,
                            background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8', cursor: 'pointer', transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.25)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
                          >📈</button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.3rem', marginTop: '1rem' }}>
              <PgBtn disabled={page <= 1} onClick={() => fetchResults(page - 1, sortBy, sortDir, capFilter, sectorFilter, matchedOnly)}>←</PgBtn>
              {pageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? <span key={`e${i}`} style={{ color: '#475569', padding: '0 0.2rem', fontSize: '0.8rem' }}>...</span> :
                <PgBtn key={p} active={p === page} onClick={() => fetchResults(p, sortBy, sortDir, capFilter, sectorFilter, matchedOnly)}>{p}</PgBtn>
              )}
              <PgBtn disabled={page >= totalPages} onClick={() => fetchResults(page + 1, sortBy, sortDir, capFilter, sectorFilter, matchedOnly)}>→</PgBtn>
              <span style={{ color: '#475569', fontSize: '0.72rem', marginLeft: '0.5rem' }}>
                Page {page} of {totalPages}
              </span>
            </div>
          )}

          {loading && matches.length > 0 && (
            <div style={{ textAlign: 'center', padding: '0.5rem', color: '#64748b', fontSize: '0.75rem', animation: 'pulse 1.5s infinite' }}>Updating...</div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color, subtitle }) {
  return (
    <div style={{
      padding: '0.75rem 1rem', borderRadius: '10px',
      background: '#1e293b', border: '1px solid #334155',
    }}>
      <div style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
      {subtitle && <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '0.1rem' }}>{subtitle}</div>}
    </div>
  );
}

function Th({ children, align, clickable, onClick, w }) {
  return (
    <th onClick={onClick} style={{
      padding: '0.55rem 0.4rem', textAlign: align || 'center', fontWeight: 600, fontSize: '0.65rem',
      color: '#475569', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
      cursor: clickable ? 'pointer' : 'default', userSelect: clickable ? 'none' : 'auto',
      borderBottom: '1px solid #334155', width: w ? `${w}px` : undefined,
    }}>{children}</th>
  );
}

function Td({ children, align, bold, muted, small, title }) {
  return (
    <td title={title} style={{
      padding: '0.45rem 0.4rem', textAlign: align || 'center', whiteSpace: 'nowrap',
      fontWeight: bold ? 600 : 400, color: muted ? '#475569' : '#e2e8f0',
      fontSize: small ? '0.7rem' : '0.78rem',
    }}>{children}</td>
  );
}

function PgBtn({ children, active, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '0.3rem 0.55rem', borderRadius: '6px', minWidth: '30px', fontSize: '0.75rem', fontWeight: active ? 700 : 400,
      border: active ? '1.5px solid #6366f1' : '1px solid #334155',
      background: active ? '#6366f1' : '#1e293b',
      color: active ? 'white' : '#64748b',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
    }}>{children}</button>
  );
}

function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
