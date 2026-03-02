import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const PAGE_SIZE = 20;

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

function StockChartModal({ symbol, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.post('/chart', { symbol, market_type: 'stocks', timeframe: '1D', indicators: [], limit: 120 })
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const dtKey = data?.[0]?.date !== undefined ? 'date' : 'datetime';
  const priceMin = data ? Math.min(...data.map(d => d.low).filter(Boolean)) : 0;
  const priceMax = data ? Math.max(...data.map(d => d.high).filter(Boolean)) : 0;
  const pad = (priceMax - priceMin) * 0.05;

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
                <YAxis domain={[priceMin - pad, priceMax + pad]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => typeof v === 'number' ? v.toFixed(0) : v} width={65} stroke="#475569" />
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

const MCAP_RANGES = [
  { label: 'All Market Caps', value: 'all', min: 0, max: Infinity },
  { label: '> 2L Cr (Large)', value: 'large', min: 2e12, max: Infinity },
  { label: '50K–2L Cr (Mid)', value: 'mid', min: 5e11, max: 2e12 },
  { label: '10K–50K Cr (Small)', value: 'small', min: 1e11, max: 5e11 },
  { label: '1K–10K Cr (Micro)', value: 'micro', min: 1e10, max: 1e11 },
  { label: '< 1K Cr (Nano)', value: 'nano', min: 0, max: 1e10 },
];

export default function SectorExplorer() {
  const [stocks, setStocks] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sectors, setSectors] = useState([]);
  const [sectorCounts, setSectorCounts] = useState({});
  const [sector, setSector] = useState('all');
  const [mcapRange, setMcapRange] = useState('all');
  const [sortBy, setSortBy] = useState('market_cap');
  const [sortDir, setSortDir] = useState('desc');
  const [chartSymbol, setChartSymbol] = useState(null);
  const [showAllSectors, setShowAllSectors] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [runStrategyId, setRunStrategyId] = useState('');
  const [groupSectors, setGroupSectors] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/strategies/?market_type=stocks').then(r => setStrategies(r.data)).catch(() => {});
  }, []);

  const fetchData = useCallback((p, sec, mr, sb, sd, grouped) => {
    setLoading(true);
    const range = MCAP_RANGES.find(r => r.value === mr) || MCAP_RANGES[0];
    let url = `/sectors?page=${p}&page_size=${PAGE_SIZE}&sort_by=${sb}&sort_dir=${sd}`;
    url += `&group_sectors=${grouped}`;
    if (sec && sec !== 'all') {
      if (grouped) url += `&parent_sector=${encodeURIComponent(sec)}`;
      else url += `&sector=${encodeURIComponent(sec)}`;
    }
    if (mr !== 'all') url += `&mcap_min=${range.min}&mcap_max=${range.max}`;
    api.get(url).then(r => {
      setStocks(r.data.stocks);
      setTotal(r.data.total);
      setPage(r.data.page);
      setSectors(r.data.sectors || []);
      setSectorCounts(r.data.sector_counts || {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(1, sector, mcapRange, sortBy, sortDir, groupSectors); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (col) => {
    const nd = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(col); setSortDir(nd);
    fetchData(1, sector, mcapRange, col, nd, groupSectors);
  };

  const handleSector = (v) => { setSector(v); fetchData(1, v, mcapRange, sortBy, sortDir, groupSectors); };
  const handleMcap = (v) => { setMcapRange(v); fetchData(1, sector, v, sortBy, sortDir, groupSectors); };

  const handleGroupToggle = () => {
    const next = !groupSectors;
    setGroupSectors(next);
    setSector('all');
    setShowAllSectors(false);
    fetchData(1, 'all', mcapRange, sortBy, sortDir, next);
  };

  const handleRunOnSector = () => {
    if (!runStrategyId) return;
    let url = `/run/${runStrategyId}?scan_days=0`;
    if (sector !== 'all') url += `&sector_filter=${encodeURIComponent(sector)}`;
    navigate(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const sortIcon = (col) => sortBy !== col ? ' ↕' : sortDir === 'desc' ? ' ↓' : ' ↑';

  const visibleSectors = sectors.filter(s => s && s !== 'Unknown');
  const displayedSectors = showAllSectors ? visibleSectors : visibleSectors.slice(0, 30);
  const hasMore = visibleSectors.length > 30;

  return (
    <div>
      {chartSymbol && <StockChartModal symbol={chartSymbol} onClose={() => setChartSymbol(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.15rem', fontSize: '1.3rem' }}>Sector Explorer</h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
            Browse NSE stocks by {groupSectors ? 'industry group' : 'sector'}, market cap, and listing recency
          </p>
        </div>
        <button onClick={handleGroupToggle} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600,
          background: groupSectors ? 'rgba(99,102,241,0.15)' : 'rgba(148,163,184,0.08)',
          border: groupSectors ? '1px solid #6366f1' : '1px solid #475569',
          color: groupSectors ? '#818cf8' : '#94a3b8', cursor: 'pointer',
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: groupSectors ? '#6366f1' : '#475569' }} />
          {groupSectors ? 'Grouped (25 groups)' : 'All Sectors (185)'}
        </button>
      </div>

      {/* Sector chips */}
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <SectorChip label="All" count={Object.values(sectorCounts).reduce((a, b) => a + b, 0)} active={sector === 'all'} onClick={() => handleSector('all')} />
        {displayedSectors.map(s => (
          <SectorChip key={s} label={s.length > 24 ? s.slice(0, 24) + '...' : s} fullLabel={s} count={sectorCounts[s] || 0} active={sector === s} onClick={() => handleSector(s)} />
        ))}
        {hasMore && !showAllSectors && (
          <button onClick={() => setShowAllSectors(true)} style={{
            padding: '0.25rem 0.6rem', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600,
            border: '1px dashed #475569', background: 'transparent', color: '#6366f1', cursor: 'pointer',
          }}>+{visibleSectors.length - 30} more</button>
        )}
        {showAllSectors && hasMore && (
          <button onClick={() => setShowAllSectors(false)} style={{
            padding: '0.25rem 0.6rem', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600,
            border: '1px dashed #475569', background: 'transparent', color: '#94a3b8', cursor: 'pointer',
          }}>Show less</button>
        )}
      </div>

      {/* Filters + Run Strategy row */}
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={mcapRange} onChange={e => handleMcap(e.target.value)}
          style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}>
          {MCAP_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <span style={{ color: '#475569', margin: '0 0.25rem' }}>|</span>

        {strategies.length > 0 && (
          <>
            <select value={runStrategyId} onChange={e => setRunStrategyId(e.target.value)}
              style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem', width: 'auto', maxWidth: 220 }}>
              <option value="">Run strategy on {sector !== 'all' ? sector : 'sector'}...</option>
              {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={handleRunOnSector} disabled={!runStrategyId} style={{
              padding: '0.4rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
              background: runStrategyId ? '#6366f1' : '#334155', color: runStrategyId ? 'white' : '#64748b',
              border: 'none', cursor: runStrategyId ? 'pointer' : 'default', opacity: runStrategyId ? 1 : 0.5,
            }}>Run</button>
          </>
        )}

        <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
          {total} stock{total !== 1 ? 's' : ''}
          {sector !== 'all' && ` in ${sector}`}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155' }}>
                <Th>#</Th>
                <Th align="left">Symbol</Th>
                <Th align="left">Company</Th>
                {groupSectors && <Th align="left">Group</Th>}
                <Th align="left">Sector</Th>
                <Th clickable onClick={() => handleSort('close')}>Close{sortIcon('close')}</Th>
                <Th clickable onClick={() => handleSort('volume')}>Vol{sortIcon('volume')}</Th>
                <Th clickable onClick={() => handleSort('market_cap')}>MCap{sortIcon('market_cap')}</Th>
                <Th>Cap</Th>
                <Th clickable onClick={() => handleSort('listing_date')}>Listed{sortIcon('listing_date')}</Th>
                <Th>Chart</Th>
              </tr>
            </thead>
            <tbody>
              {loading && stocks.length === 0 ? (
                <tr><td colSpan={groupSectors ? 11 : 10} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  <span style={{ animation: 'pulse 1.5s infinite' }}>Loading...</span>
                </td></tr>
              ) : stocks.length === 0 ? (
                <tr><td colSpan={groupSectors ? 11 : 10} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>No stocks found</td></tr>
              ) : stocks.map((s, idx) => {
                const n = (page - 1) * PAGE_SIZE + idx + 1;
                return (
                  <tr key={s.symbol} style={{ borderBottom: '1px solid #334155', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#334155'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={tdS}>{n}</td>
                    <td style={{ ...tdS, textAlign: 'left', fontWeight: 600, color: '#818cf8' }}>{s.symbol}</td>
                    <td style={{ ...tdS, textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.company_name || '-'}</td>
                    {groupSectors && <td style={{ ...tdS, textAlign: 'left', fontSize: '0.7rem', color: '#818cf8' }}>{s.parent_sector || '-'}</td>}
                    <td style={{ ...tdS, textAlign: 'left', color: '#64748b', fontSize: '0.7rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.sector}>{s.sector || '-'}</td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{s.close ?? '-'}</td>
                    <td style={tdS}>{s.volume >= 1e6 ? `${(s.volume / 1e6).toFixed(1)}M` : s.volume >= 1e3 ? `${(s.volume / 1e3).toFixed(0)}K` : s.volume}</td>
                    <td style={{ ...tdS, fontSize: '0.75rem' }}>{formatMCap(s.market_cap)}</td>
                    <td style={tdS}><CapBadge category={s.market_cap_category} /></td>
                    <td style={{ ...tdS, fontSize: '0.75rem', color: '#64748b' }}>{s.listing_date || '-'}</td>
                    <td style={tdS}>
                      <button onClick={() => setChartSymbol(s.symbol)} style={{
                        padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600,
                        background: 'rgba(99,102,241,0.12)', border: '1px solid #6366f1', color: '#818cf8', cursor: 'pointer',
                      }}>View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.35rem', marginTop: '1.25rem' }}>
          <PgBtn disabled={page <= 1} onClick={() => fetchData(page - 1, sector, mcapRange, sortBy, sortDir, groupSectors)}>←</PgBtn>
          {pgNums(page, totalPages).map((p, i) =>
            p === '...' ? <span key={`e${i}`} style={{ color: '#64748b', padding: '0 0.25rem' }}>...</span> :
            <PgBtn key={p} active={p === page} onClick={() => fetchData(p, sector, mcapRange, sortBy, sortDir, groupSectors)}>{p}</PgBtn>
          )}
          <PgBtn disabled={page >= totalPages} onClick={() => fetchData(page + 1, sector, mcapRange, sortBy, sortDir, groupSectors)}>→</PgBtn>
        </div>
      )}

      {loading && stocks.length > 0 && (
        <div style={{ textAlign: 'center', padding: '0.75rem', color: '#64748b', fontSize: '0.8rem', animation: 'pulse 1.5s infinite' }}>Loading...</div>
      )}
    </div>
  );
}

const tdS = { padding: '0.5rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap', color: '#f1f5f9', fontSize: '0.82rem' };

function Th({ children, align, clickable, onClick }) {
  return (
    <th onClick={onClick} style={{
      padding: '0.6rem 0.5rem', textAlign: align || 'center', fontWeight: 600, fontSize: '0.7rem',
      color: '#64748b', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em',
      cursor: clickable ? 'pointer' : 'default', userSelect: clickable ? 'none' : 'auto',
    }}>{children}</th>
  );
}

function SectorChip({ label, fullLabel, count, active, onClick }) {
  return (
    <button onClick={onClick} title={fullLabel || label} style={{
      padding: '0.25rem 0.55rem', borderRadius: '8px', fontSize: '0.7rem', fontWeight: active ? 700 : 500,
      border: active ? '1.5px solid #6366f1' : '1px solid #334155',
      background: active ? '#6366f1' : '#1e293b',
      color: active ? 'white' : '#94a3b8', cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {label} <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>({count})</span>
    </button>
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
