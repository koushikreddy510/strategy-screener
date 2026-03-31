import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const TAB_ORDERS = 'orders';
const TAB_POSITIONS = 'positions';
const TAB_PNL = 'pnl';
const TAB_STRATEGIES = 'strategies';

const tradingApiBase = process.env.REACT_APP_TRADING_API_URL || '';

const UNIVERSE_SOURCES = [
  { value: 'screener_filtered', label: 'Screener filtered (/run/{id})' },
  { value: 'full_universe', label: 'Full universe (market DB)' },
  { value: 'pattern_52w', label: '52w band (config_json)' },
  { value: 'screen_52w', label: 'Screen: 52w chart' },
  { value: 'screen_structural', label: 'Screen: structural patterns' },
  { value: 'screen_candle', label: 'Screen: candle patterns' },
  { value: 'union_screener_screen', label: 'Union: screener + one screen' },
];

export default function Trading() {
  const [tab, setTab] = useState(TAB_ORDERS);
  const [accounts, setAccounts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [positions, setPositions] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [executionStrategies, setExecutionStrategies] = useState([]);
  const [accountStrategies, setAccountStrategies] = useState([]);
  const [strategyToggleBusy, setStrategyToggleBusy] = useState(null);
  const [universeDrafts, setUniverseDrafts] = useState({});
  const [screenerDrafts, setScreenerDrafts] = useState({});
  const [universeSavingId, setUniverseSavingId] = useState(null);
  const [universePreview, setUniversePreview] = useState(null);

  const tradingApi = tradingApiBase ? axios.create({ baseURL: tradingApiBase }) : null;

  const fetchAccounts = useCallback(() => {
    if (!tradingApi) return;
    tradingApi.get('/trading/accounts')
      .then(r => setAccounts(r.data.accounts || []))
      .catch(() => setAccounts([]));
  }, [tradingApi]);

  const fetchOrders = useCallback(() => {
    if (!tradingApi) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (accountFilter) params.set('account_id', accountFilter);
    if (orderStatusFilter) params.set('status', orderStatusFilter);
    tradingApi.get(`/trading/orders?${params}`)
      .then(r => { setOrders(r.data.orders || []); setError(r.data.error); })
      .catch(e => { setOrders([]); setError(e.message); })
      .finally(() => setLoading(false));
  }, [tradingApi, accountFilter, orderStatusFilter]);

  const fetchPositions = useCallback(() => {
    if (!tradingApi) return;
    setLoading(true);
    const params = accountFilter ? `?account_id=${accountFilter}` : '';
    tradingApi.get(`/trading/positions${params}`)
      .then(r => { setPositions(r.data.positions || []); setError(r.data.error); })
      .catch(e => { setPositions([]); setError(e.message); })
      .finally(() => setLoading(false));
  }, [tradingApi, accountFilter]);

  const fetchPnl = useCallback(() => {
    if (!tradingApi) return;
    setLoading(true);
    const params = accountFilter ? `?account_id=${accountFilter}&limit=90` : '?limit=90';
    tradingApi.get(`/trading/pnl${params}`)
      .then(r => { setSnapshots(r.data.snapshots || []); setError(r.data.error); })
      .catch(e => { setSnapshots([]); setError(e.message); })
      .finally(() => setLoading(false));
  }, [tradingApi, accountFilter]);

  const fetchExecutionStrategies = useCallback(() => {
    if (!tradingApi) return;
    setLoading(true);
    tradingApi.get('/trading/execution-strategies')
      .then(r => { setExecutionStrategies(r.data.strategies || []); setError(r.data.error); })
      .catch(e => { setExecutionStrategies([]); setError(e.message); })
      .finally(() => setLoading(false));
  }, [tradingApi]);

  const fetchAccountStrategies = useCallback(() => {
    if (!tradingApi || !accountFilter) {
      setAccountStrategies([]);
      return;
    }
    tradingApi.get(`/trading/accounts/${accountFilter}/execution-strategies`)
      .then(r => setAccountStrategies(r.data.strategies || []))
      .catch(() => setAccountStrategies([]));
  }, [tradingApi, accountFilter]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  useEffect(() => {
    if (tab === TAB_ORDERS) fetchOrders();
    else if (tab === TAB_POSITIONS) fetchPositions();
    else if (tab === TAB_PNL) fetchPnl();
    else if (tab === TAB_STRATEGIES) {
      fetchExecutionStrategies();
      fetchAccountStrategies();
    }
  }, [tab, accountFilter, orderStatusFilter, fetchOrders, fetchPositions, fetchPnl, fetchExecutionStrategies, fetchAccountStrategies]);

  const toggleAccountStrategy = (strategyId, enabled) => {
    if (!tradingApi || !accountFilter) return;
    setStrategyToggleBusy(strategyId);
    tradingApi.patch(`/trading/accounts/${accountFilter}/execution-strategies/${strategyId}`, { is_enabled: enabled })
      .then(() => fetchAccountStrategies())
      .catch(e => setError(e.message))
      .finally(() => setStrategyToggleBusy(null));
  };

  const saveStrategyUniverse = (strategy) => {
    if (!tradingApi) return;
    const payload = {};
    const nextU = universeDrafts[strategy.id];
    if (nextU !== undefined && nextU !== strategy.universe_source) {
      payload.universe_source = nextU;
    }
    const scDraft = screenerDrafts[strategy.id];
    if (scDraft !== undefined) {
      const t = String(scDraft).trim();
      const nextSid = t === '' ? null : parseInt(t, 10);
      if (t !== '' && Number.isNaN(nextSid)) {
        setError('Screener strategy ID must be empty or a valid integer.');
        return;
      }
      const cur = strategy.screener_strategy_id ?? null;
      if (nextSid !== cur) payload.screener_strategy_id = nextSid;
    }
    if (Object.keys(payload).length === 0) return;
    setUniverseSavingId(strategy.id);
    tradingApi.patch(`/trading/execution-strategies/${strategy.id}`, payload)
      .then(() => {
        setUniverseDrafts(d => {
          const copy = { ...d };
          delete copy[strategy.id];
          return copy;
        });
        setScreenerDrafts(d => {
          const copy = { ...d };
          delete copy[strategy.id];
          return copy;
        });
        fetchExecutionStrategies();
      })
      .catch(e => {
        const msg = e.response?.data?.detail || e.message;
        setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      })
      .finally(() => setUniverseSavingId(null));
  };

  const openUniversePreview = (strategy) => {
    if (!tradingApi) return;
    setUniversePreview({ loading: true, title: strategy.display_name, strategyId: strategy.id });
    tradingApi.get(`/trading/execution-strategies/${strategy.id}/universe-preview?limit=250`)
      .then(r => setUniversePreview({
        loading: false,
        title: strategy.display_name,
        strategyId: strategy.id,
        symbolCount: r.data.symbol_count,
        truncated: r.data.truncated,
        symbols: r.data.symbols || [],
        meta: r.data.meta || {},
      }))
      .catch(e => {
        const msg = e.response?.data?.detail || e.message;
        setUniversePreview({
          loading: false,
          title: strategy.display_name,
          strategyId: strategy.id,
          error: typeof msg === 'string' ? msg : JSON.stringify(msg),
        });
      });
  };

  const groupPositionsByStrategy = (list) => {
    const map = new Map();
    for (const p of list) {
      const slug = p.execution_strategy_slug || '';
      const key = slug || '_none';
      const title = slug
        ? (p.execution_strategy_name || slug)
        : 'Unassigned (broker sync)';
      if (!map.has(key)) map.set(key, { title, slug: slug || null, rows: [] });
      map.get(key).rows.push(p);
    }
    return Array.from(map.values());
  };

  const cardStyle = {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: '1rem',
  };
  const thStyle = {
    padding: '0.5rem 0.6rem',
    textAlign: 'left',
    fontSize: '0.65rem',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #334155',
    background: '#0f172a',
  };
  const tdStyle = {
    padding: '0.5rem 0.6rem',
    fontSize: '0.8rem',
    color: '#e2e8f0',
    borderBottom: '1px solid #1e293b',
  };

  if (!tradingApiBase) {
    return (
      <div>
        <div style={{ marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem', color: '#f1f5f9' }}>Trading</h1>
          <p style={{ color: '#64748b', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            Orders, positions & PnL across brokers (Flattrade, Paytm Money, Kotak)
          </p>
        </div>
        <div style={{
          padding: '2rem', borderRadius: '12px', background: '#1e293b', border: '1px solid #334155',
          color: '#94a3b8', fontSize: '0.9rem',
        }}>
          <strong style={{ color: '#e2e8f0' }}>Trading service not configured.</strong>
          <p style={{ margin: '0.5rem 0 0' }}>
            Set <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>REACT_APP_TRADING_API_URL</code> to your trading-service URL (e.g. <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>http://localhost:8001</code>) and rebuild. The trading service runs as a separate app (see Desktop/trading-service).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', color: '#f1f5f9' }}>Trading</h1>
        <p style={{ color: '#64748b', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
          Orders, positions & PnL across brokers (Flattrade, Paytm Money, Kotak)
        </p>
      </div>

      {error && (
        <div style={{
          padding: '0.6rem 1rem', marginBottom: '1rem', borderRadius: '8px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: '0.25rem',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {[TAB_ORDERS, TAB_POSITIONS, TAB_PNL, TAB_STRATEGIES].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              border: 'none',
              background: tab === t ? '#6366f1' : '#334155',
              color: tab === t ? 'white' : '#94a3b8',
              cursor: 'pointer',
              textTransform: t === TAB_STRATEGIES ? 'none' : 'capitalize',
            }}
          >
            {t === TAB_STRATEGIES ? 'Strategies' : t}
          </button>
        ))}
        <span style={{ width: '1rem' }} />
        <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Account:</label>
        <select
          value={accountFilter}
          onChange={e => setAccountFilter(e.target.value)}
          style={{
            padding: '0.35rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.75rem',
            background: '#0f172a',
            border: '1px solid #334155',
            color: '#e2e8f0',
          }}
        >
          <option value="">All</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.display_name || `${a.broker} ${a.account_id}`}</option>
          ))}
        </select>
        {tab === TAB_ORDERS && (
          <>
            <label style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>Status:</label>
            <select
              value={orderStatusFilter}
              onChange={e => setOrderStatusFilter(e.target.value)}
              style={{
                padding: '0.35rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#e2e8f0',
              }}
            >
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="PLACED">Placed</option>
              <option value="FILLED">Filled</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </>
        )}
      </div>

      {loading && orders.length === 0 && positions.length === 0 && snapshots.length === 0 && (tab !== TAB_STRATEGIES || executionStrategies.length === 0) ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>Loading...</div>
      ) : tab === TAB_ORDERS ? (
        <div style={cardStyle}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  {['Account', 'Symbol', 'Side', 'Qty', 'Type', 'Status', 'Filled', 'Price', 'Placed', 'Broker ID'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No orders yet. Add broker accounts and place orders via the trading service.</td></tr>
                ) : orders.map(o => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={tdStyle}>{o.display_name || o.broker}</td>
                    <td style={tdStyle}>{o.symbol}</td>
                    <td style={{ ...tdStyle, color: o.side === 'BUY' ? '#4ade80' : '#f87171', fontWeight: 600 }}>{o.side}</td>
                    <td style={tdStyle}>{o.quantity}</td>
                    <td style={tdStyle}>{o.order_type}</td>
                    <td style={tdStyle}><StatusBadge status={o.status} /></td>
                    <td style={tdStyle}>{o.filled_qty ?? '-'}</td>
                    <td style={tdStyle}>{o.filled_price != null ? Number(o.filled_price).toFixed(2) : '-'}</td>
                    <td style={{ ...tdStyle, color: '#94a3b8', fontSize: '0.72rem' }}>{o.placed_at ? new Date(o.placed_at).toLocaleString() : '-'}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.7rem' }}>{o.broker_order_id || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === TAB_POSITIONS ? (
        <div>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
            Positions are <strong style={{ color: '#cbd5e1' }}>one row per symbol per account</strong> from the broker. Strategy tags come from{' '}
            <code style={{ background: '#0f172a', padding: '1px 4px', borderRadius: '4px' }}>execution_strategy_id</code> when set (e.g. after automated entries).{' '}
            The broker gives one <strong style={{ color: '#cbd5e1' }}>net qty and average price</strong> per symbol — the same stock cannot appear in two strategies in one row; overlapping strategy intent requires separate accounts or internal lot tracking (future).
          </p>
          {positions.length > 0 && groupPositionsByStrategy(positions).map((g) => (
            <div key={g.slug || g.title} style={{ ...cardStyle, marginBottom: '0.75rem' }}>
              <div style={{
                padding: '0.5rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#a5b4fc',
                borderBottom: '1px solid #334155', background: '#0f172a',
              }}>
                {g.title}
                <span style={{ marginLeft: '0.5rem', fontWeight: 500, color: '#64748b' }}>({g.rows.length})</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr>
                      {['Account', 'Symbol', 'Side', 'Qty', 'Avg', 'LTP', 'P&L', 'Synced'].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(p => (
                      <tr key={p.id}>
                        <td style={tdStyle}>{p.display_name || p.broker}</td>
                        <td style={tdStyle}>{p.symbol}</td>
                        <td style={{ ...tdStyle, color: p.side === 'BUY' ? '#4ade80' : '#f87171', fontWeight: 600 }}>{p.side}</td>
                        <td style={tdStyle}>{p.quantity}</td>
                        <td style={tdStyle}>{Number(p.avg_price).toFixed(2)}</td>
                        <td style={tdStyle}>{p.current_price != null ? Number(p.current_price).toFixed(2) : '-'}</td>
                        <td style={{ ...tdStyle, color: (p.unrealized_pnl || 0) >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                          {p.unrealized_pnl != null ? Number(p.unrealized_pnl).toFixed(2) : '-'}
                        </td>
                        <td style={{ ...tdStyle, color: '#94a3b8', fontSize: '0.72rem' }}>{p.last_synced_at ? new Date(p.last_synced_at).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {positions.length === 0 && (
            <div style={cardStyle}>
              <div style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No open positions.</div>
            </div>
          )}
        </div>
      ) : tab === TAB_STRATEGIES ? (
        <div>
          <div style={{
            padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '10px',
            background: '#0f172a', border: '1px solid #334155', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5,
          }}>
            <strong style={{ color: '#e2e8f0' }}>Universe:</strong> Most strategies use <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '4px' }}>screener_filtered</code> (symbols from a strategy-screener run).{' '}
            <strong style={{ color: '#e2e8f0' }}>Same stock, multiple strategies:</strong> the broker usually nets one position per symbol; we store one tag per row. Use separate accounts or future &quot;lots&quot; to split attribution.{' '}
            <strong style={{ color: '#e2e8f0' }}>Tracking:</strong> avg price and qty come from the broker; sync time is <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '4px' }}>last_synced_at</code>. Entry time per strategy can be added via order history later.
          </div>
          <div style={cardStyle}>
            <div style={{ padding: '0.5rem 0.75rem', fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0', borderBottom: '1px solid #334155' }}>
              Execution strategies (catalog)
            </div>
            <p style={{ margin: 0, padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: '#64748b', borderBottom: '1px solid #334155' }}>
              Entry universe source per strategy. While <strong style={{ color: '#94a3b8' }}>open positions</strong> exist for a strategy,
              universe source, screener link, and universe-related config are locked server-side (HTTP 409).
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                <thead>
                  <tr>
                    {['Slug', 'Name', 'Profile', 'Entry', 'Open', 'Universe source', 'Screener ID', ''].map(h => (
                      <th key={h || 'actions'} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {executionStrategies.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>No strategies (upgrade trading-service & run migrations).</td></tr>
                  ) : executionStrategies.map(s => {
                    const locked = (s.open_positions_count || 0) > 0;
                    const selectVal = universeDrafts[s.id] ?? s.universe_source;
                    const uDirty = selectVal !== s.universe_source;
                    const scInput = screenerDrafts[s.id] !== undefined
                      ? screenerDrafts[s.id]
                      : (s.screener_strategy_id != null ? String(s.screener_strategy_id) : '');
                    const curSc = s.screener_strategy_id != null ? String(s.screener_strategy_id) : '';
                    const scT = scInput.trim();
                    const scParsed = scT === '' ? null : parseInt(scT, 10);
                    const scInvalid = scT !== '' && Number.isNaN(scParsed);
                    const scDirty = screenerDrafts[s.id] !== undefined && scT !== curSc;
                    const dirty = uDirty || scDirty;
                    return (
                      <tr key={s.slug}>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.7rem' }}>{s.slug}</td>
                        <td style={tdStyle}>{s.display_name}</td>
                        <td style={tdStyle}>{s.profile}</td>
                        <td style={tdStyle}>{s.entry_style}</td>
                        <td style={tdStyle}>
                          <span title={locked ? 'Universe locked while open positions exist' : 'Open positions for this strategy'}>
                            {s.open_positions_count || 0}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={selectVal}
                            disabled={locked || universeSavingId === s.id}
                            onChange={e => setUniverseDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                            style={{
                              maxWidth: '220px',
                              fontSize: '0.72rem',
                              padding: '0.25rem',
                              background: '#0f172a',
                              color: '#e2e8f0',
                              border: '1px solid #334155',
                              borderRadius: '6px',
                            }}
                          >
                            {UNIVERSE_SOURCES.map(u => (
                              <option key={u.value} value={u.value}>{u.label}</option>
                            ))}
                            {!UNIVERSE_SOURCES.some(u => u.value === selectVal) && (
                              <option value={selectVal}>{selectVal} (current)</option>
                            )}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="id"
                            value={scInput}
                            disabled={locked || universeSavingId === s.id}
                            onChange={e => setScreenerDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                            title="strategy-screener strategy id for /run/{id} (screener_filtered, union_screener_screen)"
                            style={{
                              width: '3.25rem',
                              fontSize: '0.72rem',
                              padding: '0.2rem 0.35rem',
                              background: scInvalid ? 'rgba(239,68,68,0.12)' : '#0f172a',
                              color: '#e2e8f0',
                              border: `1px solid ${scInvalid ? '#f87171' : '#334155'}`,
                              borderRadius: '6px',
                              fontFamily: 'monospace',
                            }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => openUniversePreview(s)}
                              style={{
                                fontSize: '0.68rem',
                                padding: '0.2rem 0.45rem',
                                borderRadius: '6px',
                                border: '1px solid #475569',
                                background: '#334155',
                                color: '#e2e8f0',
                                cursor: 'pointer',
                              }}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              disabled={locked || !dirty || scInvalid || universeSavingId === s.id}
                              onClick={() => saveStrategyUniverse(s)}
                              style={{
                                fontSize: '0.68rem',
                                padding: '0.2rem 0.45rem',
                                borderRadius: '6px',
                                border: '1px solid #475569',
                                background: dirty && !locked && !scInvalid ? '#4f46e5' : '#1e293b',
                                color: '#e2e8f0',
                                cursor: locked || !dirty || scInvalid ? 'not-allowed' : 'pointer',
                                opacity: locked || !dirty || scInvalid ? 0.5 : 1,
                              }}
                            >
                              Save
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {universePreview && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15,23,42,0.75)',
                zIndex: 50,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
              }}
              onClick={() => setUniversePreview(null)}
            >
              <div
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  maxWidth: '560px',
                  width: '100%',
                  maxHeight: '80vh',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #334155', fontWeight: 700, color: '#f1f5f9' }}>
                  Universe preview — {universePreview.title}
                </div>
                <div style={{ padding: '0.75rem 1rem', overflow: 'auto', fontSize: '0.8rem', color: '#cbd5e1' }}>
                  {universePreview.loading && <p style={{ margin: 0 }}>Loading…</p>}
                  {universePreview.error && (
                    <p style={{ margin: 0, color: '#f87171' }}>{universePreview.error}</p>
                  )}
                  {!universePreview.loading && !universePreview.error && (
                    <>
                      <p style={{ margin: '0 0 0.5rem', color: '#94a3b8' }}>
                        <strong style={{ color: '#e2e8f0' }}>{universePreview.symbolCount}</strong> symbols
                        {universePreview.truncated ? ' (list truncated in preview)' : ''}
                      </p>
                      {universePreview.meta && Object.keys(universePreview.meta).length > 0 && (
                        <pre style={{
                          margin: '0 0 0.75rem',
                          fontSize: '0.65rem',
                          background: '#0f172a',
                          padding: '0.5rem',
                          borderRadius: '8px',
                          overflow: 'auto',
                          color: '#94a3b8',
                        }}
                        >
                          {JSON.stringify(universePreview.meta, null, 2)}
                        </pre>
                      )}
                      <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.5, color: '#e2e8f0' }}>
                        {(universePreview.symbols || []).join(', ')}
                      </div>
                    </>
                  )}
                </div>
                <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid #334155' }}>
                  <button
                    type="button"
                    onClick={() => setUniversePreview(null)}
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      background: '#334155',
                      color: '#f1f5f9',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          <div style={{ ...cardStyle, marginTop: '1rem' }}>
            <div style={{ padding: '0.5rem 0.75rem', fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0', borderBottom: '1px solid #334155' }}>
              Enable strategies per account
            </div>
            {!accountFilter ? (
              <p style={{ ...tdStyle, color: '#64748b', padding: '1rem' }}>Select an account above to toggle which execution strategies may trade on it.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      {['Strategy', 'Enabled', ''].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accountStrategies.map(s => (
                      <tr key={s.id}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{s.display_name}</div>
                          <div style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace' }}>{s.slug}</div>
                        </td>
                        <td style={tdStyle}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!!s.enabled_for_account}
                              disabled={strategyToggleBusy === s.id}
                              onChange={e => toggleAccountStrategy(s.id, e.target.checked)}
                            />
                            <span style={{ color: '#94a3b8' }}>{s.enabled_for_account ? 'On' : 'Off'}</span>
                          </label>
                        </td>
                        <td style={tdStyle} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  {['Account', 'Date', 'Realized', 'Unrealized', 'Total P&L'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshots.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No PnL snapshots yet.</td></tr>
                ) : snapshots.map(s => (
                  <tr key={s.id}>
                    <td style={tdStyle}>{s.display_name || s.broker}</td>
                    <td style={tdStyle}>{s.snapshot_date}</td>
                    <td style={{ ...tdStyle, color: (s.realized_pnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>{Number(s.realized_pnl || 0).toFixed(2)}</td>
                    <td style={{ ...tdStyle, color: (s.unrealized_pnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>{Number(s.unrealized_pnl || 0).toFixed(2)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: (s.total_pnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>{Number(s.total_pnl || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    PENDING: { bg: 'rgba(148,163,184,0.2)', color: '#94a3b8' },
    PLACED: { bg: 'rgba(99,102,241,0.2)', color: '#818cf8' },
    FILLED: { bg: 'rgba(34,197,94,0.2)', color: '#4ade80' },
    CANCELLED: { bg: 'rgba(239,68,68,0.2)', color: '#f87171' },
  };
  const c = colors[status] || colors.PENDING;
  return (
    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, background: c.bg, color: c.color }}>
      {status}
    </span>
  );
}
