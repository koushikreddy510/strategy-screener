import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api';

const labelStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' };
const inputStyle = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' };
const selectStyle = { ...inputStyle };
const formGroupStyle = { marginBottom: '1rem' };

export default function EditCondition() {
  const { strategyId, conditionId } = useParams();
  const navigate = useNavigate();
  const [metadata, setMetadata] = useState(null);
  const [indicatorType, setIndicatorType] = useState('');
  const [params, setParams] = useState({});
  const [lookbackDays, setLookbackDays] = useState(1);
  const [operator, setOperator] = useState('>');
  const [thresholdType, setThresholdType] = useState('value');
  const [thresholdValue, setThresholdValue] = useState(0);
  const [thresholdField, setThresholdField] = useState('close');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const metaRes = await api.get('/indicators/metadata');
        setMetadata(metaRes.data);
        const condRes = await api.get(`/conditions/${conditionId}`);
        const c = condRes.data;
        setIndicatorType(c.indicator_type);
        setParams(c.params);
        setLookbackDays(c.lookback_days);
        setOperator(c.operator);
        if (c.threshold.field) { setThresholdType('field'); setThresholdField(c.threshold.field); }
        else { setThresholdType('value'); setThresholdValue(c.threshold.value); }
        setLoading(false);
      } catch (err) { setError("Failed to load data"); setLoading(false); }
    }
    load();
  }, [conditionId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const threshold = thresholdType === 'value' ? { value: parseFloat(thresholdValue) } : { field: thresholdField };
    try {
      await api.put(`/conditions/${conditionId}`, { indicator_type: indicatorType, params, lookback_days: lookbackDays, operator, threshold });
      navigate(`/strategies/${strategyId}/edit`);
    } catch (err) { setError(err.response?.data?.detail || err.toString()); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '6rem 0', color: '#94a3b8', animation: 'pulse 1.5s infinite' }}>Loading...</div>;
  if (!metadata) return <div style={{ maxWidth: 500, margin: '4rem auto', background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '1.5rem' }}><p style={{ color: '#f87171' }}>{error}</p></div>;

  const ci = metadata.indicators[indicatorType];

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1.25rem' }}>Edit Condition</h2>
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '1.5rem' }}>
        {error && <div style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Indicator</label>
            <select style={selectStyle} value={indicatorType} onChange={e => setIndicatorType(e.target.value)}>
              {Object.keys(metadata.indicators).map(t => <option key={t} value={t}>{t.toUpperCase().replace('_', ' ')}</option>)}
            </select>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>{ci?.description}</p>
          </div>

          <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '10px', marginBottom: '1.25rem', border: '1px solid #334155' }}>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>Parameters</label>
            {ci && Object.keys(ci.params).map(k => (
              <div key={k} style={{ marginBottom: '0.5rem' }}>
                <label style={labelStyle}>{k}</label>
                <input style={inputStyle} type="number" step={ci.params[k].type === 'float' ? '0.1' : '1'} value={params[k] || ''}
                  onChange={e => setParams(p => ({ ...p, [k]: ci.params[k].type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value) }))} required />
              </div>
            ))}
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Lookback (bars)</label>
            <input style={inputStyle} type="number" value={lookbackDays} onChange={e => setLookbackDays(parseInt(e.target.value, 10))} min={1} required />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Operator</label>
            <select style={selectStyle} value={operator} onChange={e => setOperator(e.target.value)}>
              {metadata.operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
          </div>

          <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '10px', marginBottom: '1.5rem', border: '1px solid #334155' }}>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>Threshold</label>
            <div style={{ marginBottom: '0.5rem' }}>
              <select style={selectStyle} value={thresholdType} onChange={e => setThresholdType(e.target.value)}>
                {metadata.threshold_types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {thresholdType === 'value' ? (
              <div style={{ marginBottom: 0 }}>
                <input style={inputStyle} type="number" step="0.01" value={thresholdValue} onChange={e => setThresholdValue(e.target.value)} required />
              </div>
            ) : (
              <div style={{ marginBottom: 0 }}>
                <select style={selectStyle} value={thresholdField} onChange={e => setThresholdField(e.target.value)}>
                  {metadata.ohlc_columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" style={{ flex: 1, padding: '0.65rem', background: '#6366f1', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Update Condition</button>
            <Link to={`/strategies/${strategyId}/edit`} style={{ textDecoration: 'none', textAlign: 'center', padding: '0.6rem 1rem', background: '#334155', color: '#94a3b8', borderRadius: '8px', fontWeight: 500, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
