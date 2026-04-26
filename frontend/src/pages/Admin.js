import React, { useEffect, useState, useCallback } from 'react';
import api from '../api';
import axios from 'axios';

const tradingApiBase = process.env.REACT_APP_TRADING_API_URL || '';
const tradingApi = tradingApiBase ? axios.create({ baseURL: tradingApiBase }) : null;

const cardStyle = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
  padding: '1.25rem', marginBottom: '1rem',
};
const labelStyle = {
  fontSize: '0.65rem', fontWeight: 600, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.15rem',
};
const valStyle = { fontSize: '1.15rem', fontWeight: 700, color: '#f1f5f9' };
const subStyle = { fontSize: '0.72rem', color: '#475569', marginTop: '0.1rem' };
const btnBase = {
  padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
};
const btnPrimary = { ...btnBase, background: '#6366f1', color: 'white' };
const btnSecondary = { ...btnBase, background: '#334155', color: '#94a3b8', border: '1px solid #475569' };
const btnDanger = { ...btnBase, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' };
const sectionTitle = { fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.75rem' };

function StatusBadge({ status }) {
  const map = {
    running: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'Running...' },
    completed: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80', label: 'Completed' },
    failed: { bg: 'rgba(239,68,68,0.15)', color: '#f87171', label: 'Failed' },
    started: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: 'Started' },
    starting: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: 'Starting' },
    already_running: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'Already Running' },
  };
  const s = map[status] || { bg: 'rgba(148,163,184,0.1)', color: '#94a3b8', label: status || '-' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function JobCard({ jobId, job, onRefresh }) {
  if (!job) return null;
  return (
    <div style={{ padding: '0.5rem 0.75rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #1e293b', marginTop: '0.5rem', fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <StatusBadge status={job.status} />
        <button onClick={onRefresh} style={{ ...btnBase, padding: '0.25rem 0.5rem', fontSize: '0.7rem', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>↻ Refresh</button>
      </div>
      {job.progress && <div style={{ color: '#94a3b8', marginTop: '0.35rem' }}>{job.progress}</div>}
      {job.error && <div style={{ color: '#f87171', marginTop: '0.35rem' }}>{job.error}</div>}
      {job.started_at && <div style={{ color: '#475569', marginTop: '0.2rem' }}>Started: {job.started_at}</div>}
      {job.finished_at && <div style={{ color: '#475569' }}>Finished: {job.finished_at}</div>}
    </div>
  );
}

export default function Admin() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState({});
  const [actionResult, setActionResult] = useState(null);
  const [symbolCheck, setSymbolCheck] = useState(null);
  const [fyersStatus, setFyersStatus] = useState(null);
  const [fyersLoading, setFyersLoading] = useState(false);
  const [tradingStatus, setTradingStatus] = useState(null);
  const [tradingJobs, setTradingJobs] = useState({});
  const [tradingActionResult, setTradingActionResult] = useState(null);

  const fetchStatus = useCallback(() => {
    api.get('/admin/data-status')
      .then(r => { setStatus(r.data); setLoading(false); })
      .catch(e => { setLoading(false); setActionResult({ error: e.message }); });
  }, []);

  const fetchJobs = useCallback(() => {
    api.get('/admin/jobs').then(r => setJobs(r.data || {})).catch(() => {});
  }, []);

  const refreshJob = (jobId) => {
    api.get(`/admin/job/${jobId}`).then(r => {
      setJobs(prev => ({ ...prev, [jobId]: r.data }));
    }).catch(() => {});
  };

  const fetchTradingStatus = useCallback(() => {
    if (!tradingApi) return;
    tradingApi.get('/admin/data-status')
      .then(r => setTradingStatus(r.data))
      .catch(() => setTradingStatus({ error: 'Trading API unreachable' }));
  }, []);
  const fetchTradingJobs = useCallback(() => {
    if (!tradingApi) return;
    tradingApi.get('/admin/jobs').then(r => setTradingJobs(r.data || {})).catch(() => {});
  }, []);

  useEffect(() => { fetchStatus(); fetchJobs(); }, [fetchStatus, fetchJobs]);
  useEffect(() => { fetchTradingStatus(); fetchTradingJobs(); }, [fetchTradingStatus, fetchTradingJobs]);

  useEffect(() => {
    const hasRunning = Object.values(jobs).some(j => j.status === 'running' || j.status === 'starting');
    if (!hasRunning) return;
    const interval = setInterval(() => { fetchJobs(); fetchStatus(); }, 5000);
    return () => clearInterval(interval);
  }, [jobs, fetchJobs, fetchStatus]);

  useEffect(() => {
    if (!tradingApi) return;
    const hasRunning = Object.values(tradingJobs).some(j => j?.status === 'running' || j?.status === 'starting');
    if (!hasRunning) return;
    const interval = setInterval(() => { fetchTradingJobs(); fetchTradingStatus(); }, 5000);
    return () => clearInterval(interval);
  }, [tradingApi, tradingJobs, fetchTradingJobs, fetchTradingStatus]);

  const doAction = (url, params = '') => {
    setActionResult(null);
    api.post(`${url}${params ? '?' + params : ''}`)
      .then(r => { setActionResult(r.data); fetchJobs(); })
      .catch(e => setActionResult({ error: e.response?.data?.detail || e.message }));
  };

  const checkSymbols = () => {
    api.post('/admin/sync-symbols?mode=check')
      .then(r => setSymbolCheck(r.data))
      .catch(e => setSymbolCheck({ error: e.message }));
  };

  const doTradingAction = (url, params = '') => {
    if (!tradingApi) return;
    setTradingActionResult(null);
    tradingApi.post(`${url}${params ? '?' + params : ''}`)
      .then(r => { setTradingActionResult(r.data); fetchTradingJobs(); fetchTradingStatus(); })
      .catch(e => setTradingActionResult({ error: e.response?.data?.detail || e.message }));
  };
  const refreshTradingJob = (jobId) => {
    if (!tradingApi) return;
    tradingApi.get(`/admin/job/${jobId}`).then(r => {
      setTradingJobs(prev => ({ ...prev, [jobId]: r.data }));
    }).catch(() => {});
  };

  const validateFyers = () => {
    setFyersLoading(true);
    api.get('/admin/fyers-token/validate')
      .then(r => { setFyersStatus(r.data); setFyersLoading(false); })
      .catch(e => { setFyersStatus({ valid: false, error: e.message }); setFyersLoading(false); });
  };

  const generateFyersToken = () => {
    setFyersLoading(true);
    api.post('/admin/fyers-token/generate')
      .then(r => { setFyersStatus(r.data); setFyersLoading(false); })
      .catch(e => { setFyersStatus({ status: 'failed', error: e.message }); setFyersLoading(false); });
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '6rem 0', color: '#64748b' }}>Loading data status...</div>
  );

  const s = status || {};
  const sym = s.symbols || {};
  const ohlcv = s.ohlcv || {};
  const fin = s.financials || {};
  const ann = s.result_announcements || {};

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', color: '#f1f5f9' }}>Data Management</h1>
        <p style={{ color: '#64748b', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
          Sync symbols, OHLCV, financials, sectors; manage Fyers token; sync trading positions & PnL (when trading-service URL is set)
        </p>
      </div>

      {actionResult && (
        <div style={{
          ...cardStyle, padding: '0.75rem 1rem',
          borderColor: actionResult.error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)',
          background: actionResult.error ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)',
        }}>
          <pre style={{ margin: 0, fontSize: '0.75rem', color: actionResult.error ? '#f87171' : '#4ade80', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(actionResult, null, 2)}
          </pre>
          <button onClick={() => setActionResult(null)} style={{ ...btnBase, padding: '0.2rem 0.5rem', fontSize: '0.65rem', background: '#334155', color: '#94a3b8', marginTop: '0.5rem' }}>Dismiss</button>
        </div>
      )}

      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Total Symbols</div>
          <div style={valStyle}>{sym.total || 0}</div>
          <div style={subStyle}>{sym.with_sector || 0} with sector</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>OHLCV Coverage</div>
          <div style={valStyle}>{ohlcv.symbols_with_data || 0}</div>
          <div style={subStyle}>Latest: {ohlcv.latest_date || 'none'}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Financials</div>
          <div style={valStyle}>{fin.symbols_with_data || 0}</div>
          <div style={subStyle}>Last scrape: {fin.latest_scraped ? fin.latest_scraped.slice(0, 10) : 'never'}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Missing Sectors</div>
          <div style={{ ...valStyle, color: sym.without_sector > 0 ? '#fbbf24' : '#4ade80' }}>{sym.without_sector || 0}</div>
          <div style={subStyle}>{sym.total > 0 ? ((sym.with_sector / sym.total * 100).toFixed(0) + '% covered') : '-'}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Result Announcements</div>
          <div style={valStyle}>{ann.total || 0}</div>
          <div style={subStyle}>Latest: {ann.latest_date || 'none'}</div>
        </div>
      </div>

      {/* Symbols Section */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Symbols (Fyers Master)</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Downloads NSE equity symbols from Fyers. "Check" shows new/removed without writing. "Sync" upserts all.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={checkSymbols} style={btnSecondary}>Check for Changes</button>
          <button onClick={() => doAction('/admin/sync-symbols', 'mode=full')} style={btnPrimary}>Sync All Symbols</button>
        </div>
        {symbolCheck && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px', background: '#0f172a', fontSize: '0.78rem', color: '#94a3b8' }}>
            <div>Fyers total: <b style={{ color: '#e2e8f0' }}>{symbolCheck.fyers_total}</b> | DB total: <b style={{ color: '#e2e8f0' }}>{symbolCheck.db_total}</b></div>
            <div style={{ color: '#4ade80' }}>New: {symbolCheck.new || 0}</div>
            <div style={{ color: '#f87171' }}>Removed from Fyers: {symbolCheck.removed || 0}</div>
            {symbolCheck.new_symbols?.length > 0 && (
              <div style={{ marginTop: '0.4rem', color: '#64748b', fontSize: '0.7rem' }}>
                New: {symbolCheck.new_symbols.slice(0, 20).join(', ')}{symbolCheck.new_symbols.length > 20 ? '...' : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* OHLCV Section */}
      <div style={cardStyle}>
        <div style={sectionTitle}>OHLCV Data (Fyers API)</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          "Incremental" fetches from the last available date. "Full" fetches 365 days for all symbols. Requires valid Fyers token.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => doAction('/admin/update-ohlcv', 'mode=incremental')} style={btnPrimary}>Update (Incremental)</button>
          <button onClick={() => doAction('/admin/update-ohlcv', 'mode=full')} style={btnDanger}>Fetch Full (365d)</button>
        </div>
        <JobCard jobId="ohlcv" job={jobs.ohlcv} onRefresh={() => refreshJob('ohlcv')} />
      </div>

      {/* Financials Section */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Financial Results (screener.in)</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          <strong>Scrape Latest Announcements Only</strong> — fills financials for symbols that announced recently (run Latest Results scraper first). <strong>Incremental</strong> skips last 7 days. <strong>Full</strong> scrapes all. Uses <code>SCREENER_SESSION_COOKIE</code> when set and backs off on 429 rate limits. Job state resets on server restart.
          {(!status || (fin.symbols_with_data || 0) === 0) && (
            <span style={{ display: 'block', color: '#fbbf24', marginTop: '0.5rem' }}>
              ⚠ No financial data yet — Latest Results and AI report will show nulls until you run this.
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => doAction('/admin/update-financials', 'mode=incremental')} style={btnPrimary}>Update (Incremental)</button>
          <button onClick={() => doAction('/admin/update-financials', 'mode=announcements_only')} style={btnSecondary}>Scrape Latest Announcements Only</button>
          <button onClick={() => doAction('/admin/update-financials', 'mode=full')} style={btnDanger}>Scrape Full</button>
        </div>
        <JobCard jobId="financials" job={jobs.financials} onRefresh={() => refreshJob('financials')} />
      </div>

      {/* Latest Result Announcements - NSE */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Latest Result Announcements (NSE)</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Fetches financial result announcements from NSE Corporate Announcements API. These show up in the
          "Latest Results" tab on the Financials page. NSE gives announcement metadata, not revenue/profit tables; run the Screener.in financial scraper to fill financial values.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => doAction('/admin/scrape-latest-results', 'days=7')} style={btnPrimary}>Last 7 Days</button>
          <button onClick={() => doAction('/admin/scrape-latest-results', 'days=14')} style={btnSecondary}>Last 14 Days</button>
          <button onClick={() => doAction('/admin/scrape-latest-results', 'days=30')} style={btnSecondary}>Last 30 Days</button>
        </div>
        <JobCard jobId="latest_results" job={jobs.latest_results} onRefresh={() => refreshJob('latest_results')} />
      </div>

      {/* Screener.in Latest Results - separate from financials */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Screener.in Latest Results</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Attempts to fetch screener.in/results/latest/. Uses 3s delay + 429 retry. <strong>Requires login</strong> — set <code>SCREENER_SESSION_COOKIE</code> (copy cookies from browser after login) to bypass the registration wall.
          <br />
          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Screener.in entries in Latest Results (filter by source) come from the <strong>Financial Results</strong> scraper when it processes company pages.</span>
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => doAction('/admin/scrape-screener-latest')} style={btnPrimary}>Scrape Screener.in Latest</button>
        </div>
        <JobCard jobId="screener_latest" job={jobs.screener_latest} onRefresh={() => refreshJob('screener_latest')} />
      </div>

      {/* Trading Service (when REACT_APP_TRADING_API_URL is set) */}
      {tradingApi && (
        <>
          <div style={cardStyle}>
            <div style={sectionTitle}>Trading Service (Positions & PnL)</div>
            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
              Sync positions from brokers (Flattrade, Paytm, Kotak) and PnL snapshots. Requires broker credentials in env.
            </p>
            {tradingStatus?.error && (
              <div style={{ color: '#f87171', marginBottom: '0.5rem' }}>{tradingStatus.error}</div>
            )}
            {tradingStatus && !tradingStatus.error && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ padding: '0.5rem', background: '#0f172a', borderRadius: '8px', fontSize: '0.75rem' }}>
                  <div style={labelStyle}>Accounts</div>
                  <div style={valStyle}>{tradingStatus.accounts?.length || 0}</div>
                </div>
                <div style={{ padding: '0.5rem', background: '#0f172a', borderRadius: '8px', fontSize: '0.75rem' }}>
                  <div style={labelStyle}>Positions</div>
                  <div style={valStyle}>{tradingStatus.positions?.total || 0}</div>
                  <div style={subStyle}>Last sync: {tradingStatus.positions?.last_synced_at ? tradingStatus.positions.last_synced_at.slice(0, 19) : 'never'}</div>
                </div>
                <div style={{ padding: '0.5rem', background: '#0f172a', borderRadius: '8px', fontSize: '0.75rem' }}>
                  <div style={labelStyle}>PnL Snapshots</div>
                  <div style={valStyle}>{tradingStatus.pnl?.snapshots_count || 0}</div>
                  <div style={subStyle}>Latest: {tradingStatus.pnl?.latest_date || 'none'}</div>
                </div>
                <div style={{ padding: '0.5rem', background: '#0f172a', borderRadius: '8px', fontSize: '0.75rem' }}>
                  <div style={labelStyle}>Config</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    DB: {tradingStatus.config?.env_database || '-'} | Brokers: {(tradingStatus.config?.brokers_configured || []).join(', ') || '-'}
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={() => doTradingAction('/admin/sync-positions')} style={btnPrimary}>Sync Positions</button>
              <button onClick={() => doTradingAction('/admin/sync-pnl')} style={btnSecondary}>Sync PnL Snapshots</button>
            </div>
            {tradingActionResult && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem', borderRadius: '8px', background: '#0f172a', fontSize: '0.75rem' }}>
                <pre style={{ margin: 0, color: tradingActionResult.error ? '#f87171' : '#4ade80' }}>{JSON.stringify(tradingActionResult, null, 2)}</pre>
                <button onClick={() => setTradingActionResult(null)} style={{ ...btnBase, marginTop: '0.35rem', padding: '0.2rem 0.5rem', fontSize: '0.65rem' }}>Dismiss</button>
              </div>
            )}
            <JobCard jobId="sync_positions" job={tradingJobs.sync_positions} onRefresh={() => refreshTradingJob('sync_positions')} />
            <JobCard jobId="sync_pnl" job={tradingJobs.sync_pnl} onRefresh={() => refreshTradingJob('sync_pnl')} />
          </div>
        </>
      )}

      {/* Daily AI Report */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Daily AI Screener Report (→ Slack)</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Runs all stock strategies, collects passed stocks, top 10 per sector, then AI analyzes (financials, themes, govt schemes, global macro) and picks best sector + stocks. Posts full report to Slack. Requires <code style={{ background: '#0f172a', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>OPENAI_API_KEY</code> and <code style={{ background: '#0f172a', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>SLACK_WEBHOOK_URL</code>.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => doAction('/admin/daily-ai-report')} style={btnPrimary}>Run Daily AI Report → Slack</button>
        </div>
        <JobCard jobId="daily_ai_report" job={jobs.daily_ai_report} onRefresh={() => refreshJob('daily_ai_report')} />
      </div>

      {/* Sector Enrichment */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Sector & Market Cap Enrichment (NSE API)</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Fills missing sector and market_cap for symbols without them. Rate-limited (~2 req/sec).
          Currently <b style={{ color: sym.without_sector > 0 ? '#fbbf24' : '#4ade80' }}>{sym.without_sector || 0}</b> symbols missing sector.
        </p>
        <button onClick={() => doAction('/admin/enrich-sectors')} style={btnPrimary}>Enrich Missing Sectors</button>
        <JobCard jobId="sectors" job={jobs.sectors} onRefresh={() => refreshJob('sectors')} />
      </div>

      {/* Fyers Token */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Fyers API Token</div>
        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          OHLCV data requires a valid Fyers access token. Tokens expire daily. You can auto-generate via TOTP
          (set <code style={{ background: '#0f172a', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>FYERS_TOTP_KEY</code>,
          <code style={{ background: '#0f172a', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>FYERS_USERNAME</code>,
          <code style={{ background: '#0f172a', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>FYERS_PIN</code>,
          <code style={{ background: '#0f172a', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>FYERS_SECRET_KEY</code> env vars).
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={validateFyers} disabled={fyersLoading} style={btnSecondary}>
            {fyersLoading ? 'Checking...' : 'Validate Current Token'}
          </button>
          <button onClick={generateFyersToken} disabled={fyersLoading} style={btnPrimary}>
            {fyersLoading ? 'Generating...' : 'Auto-Generate Token (TOTP)'}
          </button>
        </div>
        {fyersStatus && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px', background: '#0f172a', fontSize: '0.78rem' }}>
            {fyersStatus.valid !== undefined && (
              <div style={{ color: fyersStatus.valid ? '#4ade80' : '#f87171' }}>
                Token: {fyersStatus.valid ? 'Valid' : 'Invalid / Expired'}
              </div>
            )}
            {fyersStatus.status && (
              <div style={{ color: fyersStatus.status === 'ok' ? '#4ade80' : '#f87171' }}>
                {fyersStatus.status === 'ok' ? 'Token generated and saved!' : `Failed: ${fyersStatus.error}`}
              </div>
            )}
            {fyersStatus.profile && (
              <div style={{ color: '#94a3b8', marginTop: '0.3rem' }}>
                Profile: {fyersStatus.profile.name || fyersStatus.profile.fy_id || JSON.stringify(fyersStatus.profile)}
              </div>
            )}
            {fyersStatus.error && !fyersStatus.status && (
              <div style={{ color: '#f87171', marginTop: '0.2rem' }}>{fyersStatus.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Refresh */}
      <div style={{ textAlign: 'center', padding: '0.5rem' }}>
        <button onClick={() => { fetchStatus(); fetchJobs(); if (tradingApi) { fetchTradingStatus(); fetchTradingJobs(); } }} style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: '#334155', color: '#94a3b8' }}>
          ↻ Refresh All
        </button>
      </div>
    </div>
  );
}
