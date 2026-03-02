import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const TAB_ORDERS = 'orders';
const TAB_POSITIONS = 'positions';
const TAB_PNL = 'pnl';

const tradingApiBase = process.env.REACT_APP_TRADING_API_URL || '';

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

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  useEffect(() => {
    if (tab === TAB_ORDERS) fetchOrders();
    else if (tab === TAB_POSITIONS) fetchPositions();
    else if (tab === TAB_PNL) fetchPnl();
  }, [tab, accountFilter, orderStatusFilter, fetchOrders, fetchPositions, fetchPnl]);

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
        {[TAB_ORDERS, TAB_POSITIONS, TAB_PNL].map(t => (
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
              textTransform: 'capitalize',
            }}
          >
            {t}
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

      {loading && orders.length === 0 && positions.length === 0 && snapshots.length === 0 ? (
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
        <div style={cardStyle}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  {['Account', 'Symbol', 'Side', 'Qty', 'Avg Price', 'LTP', 'P&L', 'Synced'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No open positions.</td></tr>
                ) : positions.map(p => (
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
