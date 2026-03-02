import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../api';

function ConditionSummary({ condition }) {
  const params = typeof condition.params === 'string' ? JSON.parse(condition.params) : (condition.params || {});
  const threshold = typeof condition.threshold === 'string' ? JSON.parse(condition.threshold) : (condition.threshold || {});
  const paramStr = Object.entries(params).map(([, v]) => v).join(', ');
  const threshStr = threshold.value != null ? threshold.value : threshold.field || '';
  const opMap = { '>': '>', '<': '<', '==': '=', 'cross_above': '↗', 'cross_below': '↘' };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      padding: '2px 7px', borderRadius: '4px', fontSize: '0.65rem',
      background: '#0f172a', border: '1px solid #1e293b', color: '#94a3b8',
    }}>
      <span style={{ color: '#818cf8', fontWeight: 600 }}>{condition.indicator_type.toUpperCase()}</span>
      {paramStr && <span style={{ color: '#475569' }}>({paramStr})</span>}
      <span style={{ color: '#f59e0b' }}>{opMap[condition.operator] || condition.operator}</span>
      <span style={{ color: '#cbd5e1' }}>{threshStr}</span>
    </span>
  );
}

export default function StrategiesList() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedScanDays, setSelectedScanDays] = useState({});
  const navigate = useNavigate();
  const location = useLocation();

  const queryParams = new URLSearchParams(location.search);
  const marketType = queryParams.get('market') || 'stocks';

  useEffect(() => {
    setLoading(true);
    api.get(`/strategies/?market_type=${marketType}`)
      .then(res => {
        setStrategies(res.data);
        setLoading(false);
        const initial = {};
        res.data.forEach(s => { initial[s.id] = 0; });
        setSelectedScanDays(initial);
      })
      .catch(err => {
        setError(err.toString());
        setLoading(false);
      });
  }, [marketType]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this strategy and its conditions?")) return;
    try {
      await api.delete(`/strategies/${id}`);
      setStrategies(strategies.filter(s => s.id !== id));
    } catch (err) {
      alert("Failed to delete strategy");
    }
  };

  const handleRunScreen = (strategyId) => {
    const scanDays = selectedScanDays[strategyId] || 0;
    navigate(`/run/${strategyId}?scan_days=${scanDays}`);
  };

  const marketLabel = marketType === 'commodities' ? 'Commodities' : 'Stocks';

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '6rem 0' }}>
      <div style={{ color: '#64748b', animation: 'pulse 1.5s infinite' }}>Loading strategies...</div>
    </div>
  );

  if (error) return (
    <div style={{
      maxWidth: 500, margin: '4rem auto', textAlign: 'center', padding: '2rem',
      borderRadius: '14px', background: '#1e293b', border: '1px solid #7f1d1d',
    }}>
      <p style={{ color: '#f87171' }}>Failed to load strategies</p>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.15rem', fontSize: '1.3rem' }}>{marketLabel} Strategies</h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
            {strategies.length} strateg{strategies.length === 1 ? 'y' : 'ies'} configured
          </p>
        </div>
        <Link to={`/strategies/new?market=${marketType}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
          background: '#6366f1', color: 'white', textDecoration: 'none',
        }}>+ New Strategy</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.75rem' }}>
        {strategies.map(s => (
          <div key={s.id} style={{
            display: 'flex', flexDirection: 'column', padding: '1.25rem',
            borderRadius: '12px', background: '#1e293b', border: '1px solid #334155',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#475569'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#334155'}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>{s.name}</h3>
                <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.3rem', alignItems: 'center' }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 700,
                    background: '#6366f1', color: 'white', letterSpacing: '0.04em',
                  }}>{s.timeframe}</span>
                  <span style={{ fontSize: '0.65rem', color: '#475569' }}>#{s.id}</span>
                </div>
              </div>
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600,
                background: s.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.08)',
                color: s.is_active ? '#4ade80' : '#475569',
              }}>
                {s.is_active ? '● Active' : '○ Off'}
              </span>
            </div>

            {s.description && (
              <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
                {s.description}
              </p>
            )}

            {/* Condition pills */}
            {s.conditions.length > 0 ? (
              <div style={{
                display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center',
                marginBottom: '0.75rem', padding: '0.5rem', borderRadius: '8px',
                background: '#0f172a',
              }}>
                {s.conditions.slice(0, 4).map((c, i) => (
                  <React.Fragment key={c.id}>
                    {i > 0 && <span style={{ color: '#334155', fontSize: '0.6rem', fontWeight: 700 }}>AND</span>}
                    <ConditionSummary condition={c} />
                  </React.Fragment>
                ))}
                {s.conditions.length > 4 && (
                  <span style={{ fontSize: '0.65rem', color: '#475569' }}>+{s.conditions.length - 4} more</span>
                )}
              </div>
            ) : (
              <div style={{
                marginBottom: '0.75rem', padding: '0.5rem', borderRadius: '8px',
                background: '#0f172a', fontSize: '0.75rem', color: '#475569', textAlign: 'center',
              }}>No conditions — <Link to={`/strategies/${s.id}/conditions`} style={{ color: '#818cf8', textDecoration: 'none' }}>add some</Link></div>
            )}

            <div style={{ display: 'flex', gap: '0.35rem', marginTop: 'auto' }}>
              <select
                value={selectedScanDays[s.id] || 0}
                onChange={(e) => setSelectedScanDays({ ...selectedScanDays, [s.id]: parseInt(e.target.value) })}
                style={{
                  flex: 'none', width: 'auto', padding: '0.4rem 0.5rem', fontSize: '0.75rem',
                  background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px',
                }}
              >
                <option value={0}>Latest</option>
                <option value={7}>7d scan</option>
                <option value={30}>30d scan</option>
              </select>
              <button onClick={() => handleRunScreen(s.id)} disabled={s.conditions.length === 0} style={{
                flex: 1, fontSize: '0.8rem', padding: '0.45rem', borderRadius: '8px', fontWeight: 600,
                background: s.conditions.length > 0 ? '#6366f1' : '#334155',
                color: s.conditions.length > 0 ? 'white' : '#475569',
                border: 'none', cursor: s.conditions.length > 0 ? 'pointer' : 'default',
                opacity: s.conditions.length > 0 ? 1 : 0.5,
              }}>
                ▶ Run Screen
              </button>
              <Link to={`/strategies/${s.id}/edit`} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0.45rem 0.65rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600,
                background: '#334155', border: '1px solid #475569', color: '#94a3b8', textDecoration: 'none',
              }}>Edit</Link>
              <button onClick={() => handleDelete(s.id)} style={{
                padding: '0.45rem 0.55rem', borderRadius: '8px', fontSize: '0.7rem',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                color: '#f87171', cursor: 'pointer',
              }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {strategies.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem', borderRadius: '14px',
          background: '#1e293b', border: '1px solid #334155',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
          <p style={{ fontSize: '0.95rem', color: '#64748b', marginBottom: '1.5rem' }}>No {marketLabel.toLowerCase()} strategies yet.</p>
          <Link to={`/strategies/new?market=${marketType}`} style={{
            display: 'inline-block', padding: '0.6rem 1.25rem', borderRadius: '8px', fontSize: '0.9rem',
            background: '#6366f1', color: 'white', textDecoration: 'none', fontWeight: 600,
          }}>Create Your First Strategy</Link>
        </div>
      )}
    </div>
  );
}
