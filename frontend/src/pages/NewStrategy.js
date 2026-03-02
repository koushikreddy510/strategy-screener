import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api';

const labelStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' };
const inputStyle = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' };
const selectStyle = { ...inputStyle };
const textareaStyle = { ...inputStyle, resize: 'vertical' };
const formGroupStyle = { marginBottom: '1rem' };

export default function NewStrategy() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [conditions, setConditions] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  const defaultMarket = new URLSearchParams(location.search).get('market') || 'stocks';
  const [marketType, setMarketType] = useState(defaultMarket);
  const [timeframe, setTimeframe] = useState('1D');

  useEffect(() => {
    api.get('/indicators/metadata').then(r => setMetadata(r.data)).catch(() => setError("Failed to load metadata"));
  }, []);

  const availableTfs = useMemo(() => metadata?.timeframes?.[marketType] || [{ label: '1 Day', value: '1D' }], [metadata, marketType]);

  useEffect(() => {
    const valid = availableTfs.map(t => t.value);
    if (!valid.includes(timeframe)) setTimeframe(valid[0] || '1D');
  }, [marketType, availableTfs, timeframe]);

  const addCondition = () => {
    if (!metadata) return;
    const firstType = Object.keys(metadata.indicators)[0];
    const config = metadata.indicators[firstType];
    const dp = {};
    Object.keys(config.params).forEach(k => { dp[k] = config.params[k].default; });
    setConditions([...conditions, { indicator_type: firstType, params: dp, lookback_days: 1, operator: metadata.operators[0].value, threshold: { value: 0 } }]);
  };

  const removeCondition = (i) => setConditions(conditions.filter((_, idx) => idx !== i));

  const updateCondition = (i, field, value) => {
    const nc = [...conditions];
    nc[i][field] = value;
    if (field === 'indicator_type') {
      const cfg = metadata.indicators[value];
      const dp = {};
      Object.keys(cfg.params).forEach(k => { dp[k] = cfg.params[k].default; });
      nc[i].params = dp;
    }
    setConditions(nc);
  };

  const updateParam = (ci, pk, val, type) => {
    const nc = [...conditions];
    nc[ci].params[pk] = type === 'int' ? parseInt(val, 10) : parseFloat(val);
    setConditions(nc);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/strategies/', { name, description, conditions, is_active: true, market_type: marketType, timeframe });
      navigate(`/strategies?market=${marketType}`);
    } catch (err) {
      setError(err.response?.data?.detail || err.toString());
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1.25rem' }}>Create Strategy</h2>
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '1.5rem' }}>
        {error && <div style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ marginBottom: 0 }}>
              <label style={labelStyle}>Market</label>
              <select style={selectStyle} value={marketType} onChange={e => setMarketType(e.target.value)}>
                {metadata?.market_types?.map(m => <option key={m.value} value={m.value}>{m.label}</option>) || <>
                  <option value="stocks">Stocks (NSE)</option>
                  <option value="commodities">Commodities (MCX)</option>
                </>}
              </select>
            </div>
            <div style={{ marginBottom: 0 }}>
              <label style={labelStyle}>Timeframe</label>
              <select style={selectStyle} value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                {availableTfs.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} type="text" value={name} placeholder="e.g. Supertrend Dual Confirmation" onChange={e => setName(e.target.value)} required />
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Description</label>
            <textarea style={textareaStyle} value={description} placeholder="What does this strategy do?" onChange={e => setDescription(e.target.value)} rows="2" />
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: '1rem', fontWeight: 600 }}>Conditions</h3>
              <button type="button" onClick={addCondition} style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}>+ Add</button>
            </div>

            {conditions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', background: '#0f172a', borderRadius: '10px', border: '2px dashed #334155', color: '#94a3b8', fontSize: '0.85rem' }}>
                No conditions yet. Add one to start.
              </div>
            )}

            {conditions.map((cond, i) => (
              <div key={i} style={{ position: 'relative', background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '1rem', marginBottom: '0.75rem' }}>
                <button type="button" onClick={() => removeCondition(i)} style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(239,68,68,0.08)', color: '#f87171', border: 'none', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>

                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={labelStyle}>Indicator</label>
                  <select style={selectStyle} value={cond.indicator_type} onChange={e => updateCondition(i, 'indicator_type', e.target.value)}>
                    {metadata && Object.keys(metadata.indicators).map(t => <option key={t} value={t}>{t.toUpperCase().replace('_', ' ')}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={labelStyle}>Operator</label>
                  <select style={selectStyle} value={cond.operator} onChange={e => updateCondition(i, 'operator', e.target.value)}>
                    {metadata?.operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={labelStyle}>Threshold Type</label>
                  <select style={selectStyle} value={cond.threshold.field ? 'field' : 'value'} onChange={e => {
                    const nc = [...conditions];
                    nc[i].threshold = e.target.value === 'value' ? { value: 0 } : { field: 'close' };
                    setConditions(nc);
                  }}>
                    <option value="value">Constant</option>
                    <option value="field">OHLC Field</option>
                  </select>
                </div>

                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={labelStyle}>Threshold</label>
                  {cond.threshold.field ? (
                    <select style={selectStyle} value={cond.threshold.field} onChange={e => {
                      const nc = [...conditions]; nc[i].threshold = { field: e.target.value }; setConditions(nc);
                    }}>
                      {metadata?.ohlc_columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input style={inputStyle} type="number" step="0.01" value={cond.threshold.value} onChange={e => {
                      const nc = [...conditions]; nc[i].threshold = { value: parseFloat(e.target.value) }; setConditions(nc);
                    }} />
                  )}
                </div>

                <div style={{ gridColumn: '1 / -1', background: '#0f172a', padding: '0.75rem', borderRadius: '8px', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem', border: '1px solid #334155' }}>
                  <div style={{ flex: 1, minWidth: 100 }}>
                    <label style={labelStyle}>Lookback</label>
                    <input style={inputStyle} type="number" value={cond.lookback_days} onChange={e => updateCondition(i, 'lookback_days', parseInt(e.target.value, 10))} min={1} />
                  </div>
                  {metadata && Object.keys(metadata.indicators[cond.indicator_type]?.params || {}).map(pk => (
                    <div key={pk} style={{ flex: 1, minWidth: 100 }}>
                      <label style={labelStyle}>{pk}</label>
                      <input style={inputStyle} type="number" step={metadata.indicators[cond.indicator_type].params[pk].type === 'float' ? '0.1' : '1'}
                        value={cond.params[pk] || ''} onChange={e => updateParam(i, pk, e.target.value, metadata.indicators[cond.indicator_type].params[pk].type)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', gap: '0.75rem' }}>
            <button type="submit" style={{ flex: 1, padding: '0.75rem', background: '#6366f1', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Create Strategy</button>
            <button type="button" onClick={() => navigate(`/strategies?market=${marketType}`)} style={{ padding: '0.6rem 1.25rem', background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem' }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
