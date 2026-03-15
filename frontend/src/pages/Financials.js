import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import api from '../api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const PAGE_SIZE = 20;

function fmtCr(v) {
  if (v == null) return '-';
  if (Math.abs(v) >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(0);
}

/* fmtPct available for future use */

function GrowthBadge({ value }) {
  if (value == null) return <span style={{ color: '#475569' }}>-</span>;
  const pos = value >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '2px',
      padding: '1px 5px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600,
      background: pos ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
      color: pos ? '#4ade80' : '#f87171',
    }}>
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function SourceBadge({ source }) {
  const colors = {
    'screener.in': { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
    'nse': { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
    'moneycontrol': { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24' },
  };
  const c = colors[source] || { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8' };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: '4px',
      fontSize: '0.6rem', fontWeight: 600, background: c.bg, color: c.color,
    }}>{source || 'unknown'}</span>
  );
}

function DetailModal({ nse_symbol, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('quarterly');

  useEffect(() => {
    setLoading(true);
    api.get(`/financials/${nse_symbol}?result_type=${tab}`)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [nse_symbol, tab]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const results = data?.results || [];
  const chartData = results.slice(-12).map(r => ({
    period: r.period,
    Revenue: r.revenue,
    'Net Profit': r.net_profit,
    'OPM %': r.opm_pct,
    EPS: r.eps,
  }));

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
        width: '100%', maxWidth: 1100, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 24px 48px rgba(0,0,0,0.6)', padding: '1.5rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#f1f5f9' }}>{data?.company_name || nse_symbol}</h2>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{nse_symbol} &bull; Financial Results</span>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            {['quarterly', 'annual'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '0.3rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                border: t === tab ? '1.5px solid #6366f1' : '1px solid #334155',
                background: t === tab ? '#6366f1' : '#334155',
                color: t === tab ? 'white' : '#94a3b8', cursor: 'pointer', textTransform: 'capitalize',
              }}>{t}</button>
            ))}
            <button onClick={onClose} style={{
              marginLeft: '0.5rem', padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem',
              background: '#334155', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer', fontWeight: 600,
            }}>✕</button>
          </div>
        </div>

        {loading ? (
          <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <span style={{ animation: 'pulse 1.5s infinite' }}>Loading...</span>
          </div>
        ) : results.length === 0 ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>No data available</div>
        ) : (
          <>
            <div style={{ width: '100%', height: 280, marginBottom: '1rem' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="period" tick={{ fontSize: 9, fill: '#64748b' }} interval="preserveStartEnd" stroke="#475569" />
                  <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#64748b' }} stroke="#475569" tickFormatter={v => fmtCr(v)} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} stroke="#475569" />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '0.75rem', color: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
                  <Bar yAxisId="left" dataKey="Revenue" fill="rgba(99,102,241,0.4)" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="Net Profit" fill="rgba(34,197,94,0.5)" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="OPM %" stroke="#fbbf24" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                <thead>
                  <tr style={{ background: '#0f172a' }}>
                    {['Period', 'Revenue', 'Expenses', 'Op. Profit', 'OPM%', 'Net Profit', 'NPM%', 'EPS', 'Rev Growth', 'Profit Growth'].map(h => (
                      <th key={h} style={{ padding: '0.5rem 0.4rem', textAlign: 'center', fontSize: '0.62rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #334155' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.slice().reverse().map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: '#94a3b8', fontWeight: 600, fontSize: '0.72rem' }}>{r.period}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: '#e2e8f0' }}>{fmtCr(r.revenue)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: '#94a3b8' }}>{fmtCr(r.expenses)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: r.operating_profit >= 0 ? '#4ade80' : '#f87171' }}>{fmtCr(r.operating_profit)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: '#fbbf24' }}>{r.opm_pct != null ? `${r.opm_pct}%` : '-'}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: r.net_profit >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>{fmtCr(r.net_profit)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: '#94a3b8' }}>{r.npm_pct != null ? `${r.npm_pct}%` : '-'}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center', color: '#e2e8f0', fontWeight: 600 }}>{r.eps != null ? r.eps.toFixed(2) : '-'}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'center' }}><GrowthBadge value={r.revenue_growth_pct} /></td>
                      <td style={{ padding: '0.4rem', textAlign: 'center' }}><GrowthBadge value={r.profit_growth_pct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function LatestResultsPanel({ onSelectSymbol }) {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('all');

  const fetchLatest = useCallback((p, d, src) => {
    setLoading(true);
    let url = `/financials/latest-results?days=${d}&page=${p}&page_size=15`;
    if (src && src !== 'all') url += `&source=${encodeURIComponent(src)}`;
    api.get(url)
      .then(r => {
        setResults(r.data.results);
        setTotal(r.data.total);
        setPage(r.data.page);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLatest(1, days, source); }, [days, source, fetchLatest]);

  const totalPages = Math.ceil(total / 15);

  return (
    <div style={{
      borderRadius: '12px', border: '1px solid #334155', background: '#1e293b',
      overflow: 'hidden', marginBottom: '1rem',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.75rem 1rem', borderBottom: '1px solid #334155', background: '#0f172a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1rem' }}>📢</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>Latest Result Announcements</span>
          <span style={{
            padding: '1px 6px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 700,
            background: 'rgba(251,191,36,0.15)', color: '#fbbf24',
          }}>{total}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase' }}>Source</span>
          {[
            { key: 'all', label: 'All' },
            { key: 'nse', label: 'NSE' },
            { key: 'screener.in', label: 'Screener.in' },
          ].map(s => (
            <button key={s.key} onClick={() => { setSource(s.key); setPage(1); }} style={{
              padding: '0.25rem 0.5rem', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 600,
              border: source === s.key ? '1.5px solid #6366f1' : '1px solid #334155',
              background: source === s.key ? '#6366f1' : '#334155',
              color: source === s.key ? 'white' : '#94a3b8', cursor: 'pointer',
            }}>{s.label}</button>
          ))}
          <span style={{ color: '#334155', margin: '0 0.2rem' }}>|</span>
          <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase' }}>Days</span>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => { setDays(d); setPage(1); }} style={{
              padding: '0.25rem 0.5rem', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 600,
              border: d === days ? '1.5px solid #6366f1' : '1px solid #334155',
              background: d === days ? '#6366f1' : '#334155',
              color: d === days ? 'white' : '#94a3b8', cursor: 'pointer',
            }}>{d}d</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', animation: 'pulse 1.5s infinite' }}>Loading...</div>
      ) : results.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
          {source === 'screener.in' ? (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>No Screener.in results in the last {days} days.</p>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>
                Screener.in data comes from the <strong>Financial Results</strong> scraper (Admin page) — it adds entries when scraping company pages.
                Their <a href="https://www.screener.in/results/latest/" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>/results/latest/</a> page requires login and cannot be scraped directly.
              </p>
            </>
          ) : source === 'nse' ? (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>No NSE announcements in the last {days} days.</p>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>Run the <strong>Latest Results</strong> scraper from the Admin page (or select &quot;All&quot; to see combined results).</p>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>No result announcements in the last {days} days.</p>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>Run the <strong>Latest Results</strong> scraper from the Admin page.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  {['Date', 'Symbol', 'Quarter', 'Revenue', 'Net Profit', 'OPM%', 'EPS', 'Rev Gr%', 'Profit Gr%', 'PE', 'MCap', 'Source', ''].map(h => (
                    <th key={h} style={{
                      padding: '0.45rem 0.35rem', textAlign: 'center', fontWeight: 600, fontSize: '0.6rem',
                      color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderBottom: '1px solid #334155', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={`${r.nse_symbol}-${r.result_date}-${i}`}
                    style={{ borderBottom: '1px solid rgba(51,65,85,0.5)', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(15,23,42,0.5)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                      {r.result_date}
                    </td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'left' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.76rem' }}>{r.nse_symbol}</span>
                        {r.company_name && (
                          <span style={{ color: '#475569', fontSize: '0.6rem', lineHeight: 1.2 }}>
                            {r.company_name.length > 28 ? r.company_name.slice(0, 28) + '...' : r.company_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.68rem' }}>
                      {r.quarter ? (r.quarter.length > 20 ? r.quarter.slice(0, 20) + '...' : r.quarter) : '-'}
                    </td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#e2e8f0' }}>{fmtCr(r.revenue)}</td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: r.net_profit >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>{fmtCr(r.net_profit)}</td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#fbbf24' }}>{r.opm_pct != null ? `${r.opm_pct}%` : '-'}</td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#e2e8f0', fontWeight: 600 }}>{r.eps != null ? r.eps.toFixed(2) : '-'}</td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center' }}><GrowthBadge value={r.revenue_growth_pct} /></td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center' }}><GrowthBadge value={r.profit_growth_pct} /></td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#94a3b8' }}>{r.pe_ratio != null ? r.pe_ratio.toFixed(1) : '-'}</td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.68rem' }}>{r.market_cap_cr != null ? `${fmtCr(r.market_cap_cr)}Cr` : '-'}</td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center' }}><SourceBadge source={r.source} /></td>
                    <td style={{ padding: '0.4rem 0.35rem', textAlign: 'center' }}>
                      <button onClick={() => onSelectSymbol(r.nse_symbol)} style={{
                        padding: '2px 7px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 600,
                        background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                        color: '#818cf8', cursor: 'pointer',
                      }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.3rem', padding: '0.6rem' }}>
              <PgBtn disabled={page <= 1} onClick={() => fetchLatest(page - 1, days, source)}>←</PgBtn>
              {pgNums(page, totalPages).map((p, i) =>
                p === '...' ? <span key={`e${i}`} style={{ color: '#475569', padding: '0 0.2rem', fontSize: '0.8rem' }}>...</span> :
                <PgBtn key={p} active={p === page} onClick={() => fetchLatest(p, days, source)}>{p}</PgBtn>
              )}
              <PgBtn disabled={page >= totalPages} onClick={() => fetchLatest(page + 1, days, source)}>→</PgBtn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Financials() {
  const [activeTab, setActiveTab] = useState('all');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('revenue');
  const [sortDir, setSortDir] = useState('desc');
  const [resultType, setResultType] = useState('quarterly');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get('/financials/summary').then(r => setSummary(r.data)).catch(() => {});
  }, []);

  const fetchData = useCallback((p, sb, sd, rt, q) => {
    setLoading(true);
    let url = `/financials?page=${p}&page_size=${PAGE_SIZE}&sort_by=${sb}&sort_dir=${sd}&result_type=${rt}`;
    if (q) url += `&search=${encodeURIComponent(q)}`;
    api.get(url).then(r => {
      setResults(r.data.results);
      setTotal(r.data.total);
      setPage(r.data.page);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(1, sortBy, sortDir, resultType, search); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (col) => {
    const nd = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(col); setSortDir(nd);
    fetchData(1, col, nd, resultType, search);
  };

  const handleResultType = (rt) => { setResultType(rt); fetchData(1, sortBy, sortDir, rt, search); };

  const handleSearch = () => { setSearch(searchInput); fetchData(1, sortBy, sortDir, resultType, searchInput); };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const sortIcon = (col) => sortBy !== col ? ' ↕' : sortDir === 'desc' ? ' ↓' : ' ↑';

  return (
    <div>
      {detailSymbol && <DetailModal nse_symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}

      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: '0.15rem', fontSize: '1.3rem', color: '#f1f5f9' }}>Financials</h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
          Quarterly & annual results — revenue, profit, EPS, PE, margins
          {summary && <span style={{ color: '#475569' }}> &bull; {summary.total_symbols} companies</span>}
          {summary?.sources && Object.keys(summary.sources).length > 0 && (
            <span style={{ color: '#475569' }}>
              {' '}from {Object.entries(summary.sources).map(([src, cnt]) => `${src} (${cnt})`).join(', ')}
            </span>
          )}
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
          <MiniCard label="Companies" value={summary.total_symbols} color="#818cf8" />
          <MiniCard label="Quarterly" value={summary.quarterly_rows} color="#4ade80" />
          <MiniCard label="Annual" value={summary.annual_rows} color="#fbbf24" />
          <MiniCard label="Last Updated" value={summary.last_scraped ? summary.last_scraped.slice(0, 10) : '-'} color="#94a3b8" />
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: '0.25rem', marginBottom: '0.75rem',
        padding: '0.3rem', borderRadius: '10px', background: '#0f172a', border: '1px solid #334155',
        width: 'fit-content',
      }}>
        {[
          { key: 'latest', label: 'Latest Results', icon: '📢' },
          { key: 'all', label: 'All Financials', icon: '📊' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '0.4rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
            border: 'none',
            background: activeTab === t.key ? '#6366f1' : 'transparent',
            color: activeTab === t.key ? 'white' : '#64748b',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {activeTab === 'latest' && (
        <LatestResultsPanel onSelectSymbol={setDetailSymbol} />
      )}

      {activeTab === 'all' && (
        <>
          {/* Filter bar */}
          <div style={{
            display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap',
            padding: '0.6rem 0.75rem', borderRadius: '10px',
            background: '#1e293b', border: '1px solid #334155',
          }}>
            {['quarterly', 'annual'].map(rt => (
              <button key={rt} onClick={() => handleResultType(rt)} style={{
                padding: '0.35rem 0.7rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                border: rt === resultType ? '1.5px solid #6366f1' : '1px solid #334155',
                background: rt === resultType ? '#6366f1' : '#0f172a',
                color: rt === resultType ? 'white' : '#94a3b8', cursor: 'pointer', textTransform: 'capitalize',
              }}>{rt}</button>
            ))}

            <span style={{ color: '#334155', margin: '0 0.15rem' }}>|</span>

            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="Search symbol or company..."
              style={{
                padding: '0.35rem 0.6rem', fontSize: '0.75rem', width: 200,
                background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px',
              }}
            />
            <button onClick={handleSearch} style={{
              padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
              background: '#334155', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer',
            }}>Search</button>

            <span style={{ flex: 1 }} />
            <span style={{ color: '#475569', fontSize: '0.75rem' }}>{total} results</span>
          </div>

          {/* Results table */}
          {total === 0 && !loading ? (
            <div style={{
              textAlign: 'center', padding: '4rem 2rem', borderRadius: '14px',
              background: '#1e293b', border: '1px solid #334155',
            }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
              <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
                No financial data yet. Go to the <a href="/admin" style={{ color: '#818cf8', textDecoration: 'underline' }}>Admin</a> page and run the Financial Results scraper.
              </p>
            </div>
          ) : (
            <>
              <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #334155' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                    <thead>
                      <tr style={{ background: '#0f172a' }}>
                        <Th w={36}>#</Th>
                        <Th align="left">Symbol</Th>
                        <Th>Period</Th>
                        <Th clickable onClick={() => handleSort('revenue')}>Revenue{sortIcon('revenue')}</Th>
                        <Th clickable onClick={() => handleSort('operating_profit')}>Op. Profit{sortIcon('operating_profit')}</Th>
                        <Th clickable onClick={() => handleSort('opm_pct')}>OPM%{sortIcon('opm_pct')}</Th>
                        <Th clickable onClick={() => handleSort('net_profit')}>Net Profit{sortIcon('net_profit')}</Th>
                        <Th clickable onClick={() => handleSort('npm_pct')}>NPM%{sortIcon('npm_pct')}</Th>
                        <Th clickable onClick={() => handleSort('eps')}>EPS{sortIcon('eps')}</Th>
                        <Th clickable onClick={() => handleSort('pe_ratio')}>PE{sortIcon('pe_ratio')}</Th>
                        <Th clickable onClick={() => handleSort('roce_pct')}>ROCE%{sortIcon('roce_pct')}</Th>
                        <Th clickable onClick={() => handleSort('revenue_growth_pct')}>Rev Gr%{sortIcon('revenue_growth_pct')}</Th>
                        <Th clickable onClick={() => handleSort('profit_growth_pct')}>Profit Gr%{sortIcon('profit_growth_pct')}</Th>
                        <Th clickable onClick={() => handleSort('market_cap_cr')}>MCap{sortIcon('market_cap_cr')}</Th>
                        <Th w={50}>Detail</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && results.length === 0 ? (
                        <tr><td colSpan={15} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                          <span style={{ animation: 'pulse 1.5s infinite' }}>Loading...</span>
                        </td></tr>
                      ) : results.map((r, idx) => {
                        const n = (page - 1) * PAGE_SIZE + idx + 1;
                        return (
                          <tr key={r.tradingsymbol} style={{ borderBottom: '1px solid #1e293b', transition: 'background 0.1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <Td muted>{n}</Td>
                            <Td align="left">
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.78rem' }}>{r.nse_symbol}</span>
                                {r.company_name && <span style={{ color: '#475569', fontSize: '0.62rem', lineHeight: 1.2 }}>{r.company_name.length > 22 ? r.company_name.slice(0, 22) + '...' : r.company_name}</span>}
                              </div>
                            </Td>
                            <Td muted small>{r.period}</Td>
                            <Td>{fmtCr(r.revenue)}</Td>
                            <Td color={r.operating_profit >= 0 ? '#4ade80' : '#f87171'}>{fmtCr(r.operating_profit)}</Td>
                            <Td color="#fbbf24">{r.opm_pct != null ? `${r.opm_pct}%` : '-'}</Td>
                            <Td bold color={r.net_profit >= 0 ? '#4ade80' : '#f87171'}>{fmtCr(r.net_profit)}</Td>
                            <Td muted>{r.npm_pct != null ? `${r.npm_pct}%` : '-'}</Td>
                            <Td bold>{r.eps != null ? r.eps.toFixed(2) : '-'}</Td>
                            <Td>{r.pe_ratio != null ? r.pe_ratio.toFixed(1) : '-'}</Td>
                            <Td color="#22d3ee">{r.roce_pct != null ? `${r.roce_pct}%` : '-'}</Td>
                            <Td><GrowthBadge value={r.revenue_growth_pct} /></Td>
                            <Td><GrowthBadge value={r.profit_growth_pct} /></Td>
                            <Td small>{r.market_cap_cr != null ? `${fmtCr(r.market_cap_cr)} Cr` : '-'}</Td>
                            <Td>
                              <button onClick={() => setDetailSymbol(r.nse_symbol)} style={{
                                padding: '3px 8px', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 600,
                                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                                color: '#818cf8', cursor: 'pointer',
                              }}>📊</button>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.3rem', marginTop: '1rem' }}>
                  <PgBtn disabled={page <= 1} onClick={() => fetchData(page - 1, sortBy, sortDir, resultType, search)}>←</PgBtn>
                  {pgNums(page, totalPages).map((p, i) =>
                    p === '...' ? <span key={`e${i}`} style={{ color: '#475569', padding: '0 0.2rem', fontSize: '0.8rem' }}>...</span> :
                    <PgBtn key={p} active={p === page} onClick={() => fetchData(p, sortBy, sortDir, resultType, search)}>{p}</PgBtn>
                  )}
                  <PgBtn disabled={page >= totalPages} onClick={() => fetchData(page + 1, sortBy, sortDir, resultType, search)}>→</PgBtn>
                  <span style={{ color: '#475569', fontSize: '0.72rem', marginLeft: '0.5rem' }}>Page {page} of {totalPages}</span>
                </div>
              )}

              {loading && results.length > 0 && (
                <div style={{ textAlign: 'center', padding: '0.5rem', color: '#64748b', fontSize: '0.75rem', animation: 'pulse 1.5s infinite' }}>Updating...</div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function MiniCard({ label, value, color }) {
  return (
    <div style={{ padding: '0.6rem 0.75rem', borderRadius: '10px', background: '#1e293b', border: '1px solid #334155' }}>
      <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Th({ children, align, clickable, onClick, w }) {
  return (
    <th onClick={onClick} style={{
      padding: '0.5rem 0.35rem', textAlign: align || 'center', fontWeight: 600, fontSize: '0.62rem',
      color: '#475569', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
      cursor: clickable ? 'pointer' : 'default', userSelect: clickable ? 'none' : 'auto',
      borderBottom: '1px solid #334155', width: w ? `${w}px` : undefined,
    }}>{children}</th>
  );
}

function Td({ children, align, bold, muted, small, color }) {
  return (
    <td style={{
      padding: '0.4rem 0.35rem', textAlign: align || 'center', whiteSpace: 'nowrap',
      fontWeight: bold ? 600 : 400, color: color || (muted ? '#475569' : '#e2e8f0'),
      fontSize: small ? '0.68rem' : '0.76rem',
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

function pgNums(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
