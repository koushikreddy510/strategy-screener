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

function MiniChartModal({ symbol, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.post('/chart', { symbol, market_type: 'stocks', timeframe: '1D', indicators: [], limit: 60 })
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const dtKey = data?.[0]?.date !== undefined ? 'date' : 'datetime';
  const pMin = data ? Math.min(...data.map(d => d.low).filter(Boolean)) : 0;
  const pMax = data ? Math.max(...data.map(d => d.high).filter(Boolean)) : 0;
  const pad = (pMax - pMin) * 0.05;

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
        width: '100%', maxWidth: 900, padding: '1.5rem', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#f1f5f9' }}>{symbol} — 1D</h2>
          <button onClick={onClose} style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem',
            background: '#334155', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}>✕ Close</button>
        </div>
        {loading ? (
          <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <span style={{ animation: 'pulse 1.5s infinite' }}>Loading...</span>
          </div>
        ) : !data?.length ? (
          <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>No data</div>
        ) : (
          <div style={{ width: '100%', height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey={dtKey} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v ? v.slice(5) : ''} interval="preserveStartEnd" stroke="#475569" />
                <YAxis domain={[pMin - pad, pMax + pad]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => typeof v === 'number' ? v.toFixed(0) : v} width={65} stroke="#475569" />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '0.8rem', color: '#f1f5f9' }}
                  labelStyle={{ fontSize: '0.75rem', color: '#94a3b8' }}
                  formatter={(v, n) => [v != null && typeof v === 'number' ? v.toFixed(2) : '-', n]} />
                <Line type="monotone" dataKey="close" stroke="#fbbf24" strokeWidth={2} dot={false} name="Close" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function CandlePatterns() {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [patterns, setPatterns] = useState([]);
  const [patternCounts, setPatternCounts] = useState({});
  const [signalCounts, setSignalCounts] = useState({});
  const [sectors, setSectors] = useState([]);
  const [signal, setSignal] = useState('all');
  const [pattern, setPattern] = useState('all');
  const [capFilter, setCapFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [sortBy, setSortBy] = useState('strength');
  const [sortDir, setSortDir] = useState('desc');
  const [lookback, setLookback] = useState(3);
  const [chartSymbol, setChartSymbol] = useState(null);

  const fetchData = useCallback((p, sig, pat, cf, sf, sb, sd, lb) => {
    setLoading(true);
    let url = `/patterns?page=${p}&page_size=${PAGE_SIZE}&sort_by=${sb}&sort_dir=${sd}&lookback=${lb}`;
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
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, lookback); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignal = (v) => { setSignal(v); setPattern('all'); fetchData(1, v, 'all', capFilter, sectorFilter, sortBy, sortDir, lookback); };
  const handlePattern = (v) => { setPattern(v); fetchData(1, signal, v, capFilter, sectorFilter, sortBy, sortDir, lookback); };
  const handleCap = (v) => { setCapFilter(v); fetchData(1, signal, pattern, v, sectorFilter, sortBy, sortDir, lookback); };
  const handleSector = (v) => { setSectorFilter(v); fetchData(1, signal, pattern, capFilter, v, sortBy, sortDir, lookback); };
  const handleLookback = (v) => { setLookback(v); fetchData(1, signal, pattern, capFilter, sectorFilter, sortBy, sortDir, v); };

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

  return (
    <div>
      {chartSymbol && <MiniChartModal symbol={chartSymbol} onClose={() => setChartSymbol(null)} />}

      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: '0.15rem', fontSize: '1.3rem' }}>Candlestick Patterns</h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
          1D timeframe &bull; Last {lookback} bar{lookback > 1 ? 's' : ''} scanned across all NSE stocks
        </p>
      </div>

      {/* Signal summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
        <SummaryCard label="Bullish" count={bullCount} color="#4ade80" bg="rgba(34,197,94,0.1)" active={signal === 'bullish'} onClick={() => handleSignal(signal === 'bullish' ? 'all' : 'bullish')} />
        <SummaryCard label="Bearish" count={bearCount} color="#f87171" bg="rgba(239,68,68,0.1)" active={signal === 'bearish'} onClick={() => handleSignal(signal === 'bearish' ? 'all' : 'bearish')} />
        <SummaryCard label="Neutral" count={neutCount} color="#fbbf24" bg="rgba(251,191,36,0.1)" active={signal === 'neutral'} onClick={() => handleSignal(signal === 'neutral' ? 'all' : 'neutral')} />
        <SummaryCard label="All" count={bullCount + bearCount + neutCount} color="#818cf8" bg="rgba(99,102,241,0.1)" active={signal === 'all'} onClick={() => handleSignal('all')} />
      </div>

      {/* Pattern chips */}
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <PatternChip label="All Patterns" count={bullCount + bearCount + neutCount} active={pattern === 'all'} onClick={() => handlePattern('all')} />
        {patterns.map(p => (
          <PatternChip key={p} label={p} count={patternCounts[p] || 0} active={pattern === p} onClick={() => handlePattern(p)} />
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={capFilter} onChange={e => handleCap(e.target.value)} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
          <option value="all">All Caps</option>
          <option value="large_cap">Large Cap</option>
          <option value="mid_cap">Mid Cap</option>
          <option value="small_cap">Small Cap</option>
          <option value="micro_cap">Micro Cap</option>
        </select>
        {sectors.length > 0 && (
          <select value={sectorFilter} onChange={e => handleSector(e.target.value)} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto', maxWidth: 200 }}>
            <option value="all">All Sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select value={lookback} onChange={e => handleLookback(parseInt(e.target.value))} style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
          <option value={1}>Last 1 bar</option>
          <option value={2}>Last 2 bars</option>
          <option value={3}>Last 3 bars</option>
          <option value={5}>Last 5 bars</option>
        </select>
        <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
          {total} result{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Results table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155' }}>
                <Th>#</Th>
                <Th align="left">Symbol</Th>
                <Th align="left">Pattern</Th>
                <Th>Signal</Th>
                <Th clickable onClick={() => handleSort('strength')}>Strength{sortIcon('strength')}</Th>
                <Th clickable onClick={() => handleSort('close')}>Close{sortIcon('close')}</Th>
                <Th clickable onClick={() => handleSort('volume')}>Vol{sortIcon('volume')}</Th>
                <Th clickable onClick={() => handleSort('market_cap')}>MCap{sortIcon('market_cap')}</Th>
                <Th>Cap</Th>
                <Th>Sector</Th>
                <Th>Detected</Th>
                <Th>Chart</Th>
              </tr>
            </thead>
            <tbody>
              {loading && results.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  <span style={{ animation: 'pulse 1.5s infinite' }}>Scanning patterns across all stocks...</span>
                </td></tr>
              ) : results.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>No patterns detected</td></tr>
              ) : results.map((r, idx) => {
                const n = (page - 1) * PAGE_SIZE + idx + 1;
                return (
                  <tr key={`${r.symbol}-${r.pattern}-${idx}`} style={{ borderBottom: '1px solid #334155', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#334155'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <Td muted>{n}</Td>
                    <Td align="left" bold primary>{r.symbol}</Td>
                    <Td align="left" bold>{r.pattern}</Td>
                    <Td><SignalBadge signal={r.signal} /></Td>
                    <Td><StrengthDots strength={r.strength} /></Td>
                    <Td bold>{r.close}</Td>
                    <Td>{r.volume >= 1e6 ? `${(r.volume / 1e6).toFixed(1)}M` : `${(r.volume / 1e3).toFixed(0)}K`}</Td>
                    <Td small>{formatMCap(r.market_cap)}</Td>
                    <Td><CapBadge category={r.market_cap_category} /></Td>
                    <Td small muted>{r.sector ? (r.sector.length > 16 ? r.sector.slice(0, 16) + '...' : r.sector) : '-'}</Td>
                    <Td small muted>{r.bar_date?.slice(0, 10)}</Td>
                    <Td>
                      <button onClick={() => setChartSymbol(r.symbol)} style={{
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
