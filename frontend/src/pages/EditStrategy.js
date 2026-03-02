import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api';

const labelStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' };
const inputStyle = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' };
const textareaStyle = { ...inputStyle, resize: 'vertical' };
const formGroupStyle = { marginBottom: '1rem' };

export default function EditStrategy() {
  const { id } = useParams();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [marketType, setMarketType] = useState('stocks');
  const [timeframe, setTimeframe] = useState('1D');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get(`/strategies/${id}`)
      .then(res => {
        setName(res.data.name);
        setDescription(res.data.description || '');
        setIsActive(res.data.is_active);
        setMarketType(res.data.market_type || 'stocks');
        setTimeframe(res.data.timeframe || '1D');
        setLoading(false);
      })
      .catch(err => { setError(err.toString()); setLoading(false); });
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.put(`/strategies/${id}`, { name, description, is_active: isActive });
      navigate(`/strategies?market=${marketType}`);
    } catch (err) {
      setError(err.response?.data?.detail || err.toString());
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '6rem 0', color: '#94a3b8', animation: 'pulse 1.5s infinite' }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1.25rem' }}>Edit Strategy</h2>
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem' }}>
          <span style={{ display: 'inline-block', padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '6px', background: 'rgba(99,102,241,0.13)', color: '#818cf8', letterSpacing: '0.03em' }}>{marketType === 'commodities' ? 'MCX' : 'NSE'}</span>
          <span style={{ display: 'inline-block', padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '6px', background: 'rgba(99,102,241,0.13)', color: '#818cf8', letterSpacing: '0.03em' }}>{timeframe}</span>
        </div>
        {error && <div style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} type="text" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Description</label>
            <textarea style={textareaStyle} value={description} onChange={e => setDescription(e.target.value)} rows="3" />
          </div>
          <div style={{ ...formGroupStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ width: 'auto', accentColor: '#6366f1' }} />
            <label style={{ margin: 0, fontSize: '0.9rem', color: '#e2e8f0' }}>Active</label>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="submit" style={{ flex: 1, padding: '0.65rem', background: '#6366f1', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Save</button>
            <Link to={`/strategies/${id}/conditions`} style={{ flex: 1, textDecoration: 'none', textAlign: 'center', padding: '0.6rem', background: '#334155', color: '#94a3b8', borderRadius: '8px', fontWeight: 500, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Conditions</Link>
          </div>
        </form>
        <div style={{ marginTop: '1rem' }}>
          <Link to={`/strategies?market=${marketType}`} style={{ color: '#94a3b8', fontSize: '0.85rem', textDecoration: 'none' }}>← Back</Link>
        </div>
      </div>
    </div>
  );
}
