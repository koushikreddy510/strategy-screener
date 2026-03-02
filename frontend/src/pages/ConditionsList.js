import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

export default function ConditionsList() {
  const { id } = useParams();
  const [conditions, setConditions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/strategies/${id}/conditions/`)
      .then(res => { setConditions(res.data); setLoading(false); })
      .catch(err => { setError(err.toString()); setLoading(false); });
  }, [id]);

  const handleDelete = async (condId) => {
    if (!window.confirm("Delete this condition?")) return;
    try {
      await api.delete(`/conditions/${condId}`);
      setConditions(conditions.filter(c => c.id !== condId));
    } catch (err) {
      alert("Failed to delete condition");
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '6rem 0', color: '#94a3b8', animation: 'pulse 1.5s infinite' }}>Loading...</div>;
  if (error) return <div style={{ maxWidth: 500, margin: '4rem auto', background: '#1e293b', border: '1px solid #f87171', borderRadius: '14px', padding: '1.5rem' }}><p style={{ color: '#f87171' }}>{error}</p></div>;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9' }}>Conditions — Strategy #{id}</h2>
        <Link to={`/strategies/${id}/conditions/new`} style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '0.5rem 1rem', background: '#6366f1', color: '#ffffff', borderRadius: '8px', fontWeight: 600 }}>+ Add Condition</Link>
      </div>

      {conditions.length === 0 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: '#94a3b8' }}>No conditions defined.</p>
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {conditions.map(cond => (
          <div key={cond.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: '0 0 0.4rem', textTransform: 'uppercase', fontSize: '0.95rem', color: '#818cf8' }}>{cond.indicator_type}</h3>
                <div style={{ fontSize: '0.8rem', color: '#e2e8f0', lineHeight: 1.7 }}>
                  <strong>Params:</strong> {Object.entries(cond.params).map(([k, v]) => `${k}=${v}`).join(', ')}<br />
                  <strong>Lookback:</strong> {cond.lookback_days} bar(s)<br />
                  <strong>Rule:</strong> Indicator {cond.operator} {cond.threshold.field ? `Field(${cond.threshold.field})` : cond.threshold.value}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <Link to={`/strategies/${id}/conditions/${cond.id}/edit`} style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#334155', color: '#94a3b8', borderRadius: '6px', fontWeight: 500 }}>Edit</Link>
                <button onClick={() => handleDelete(cond.id)} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: 'rgba(239,68,68,0.08)', color: '#f87171', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}>Del</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <Link to={`/strategies/${id}/edit`} style={{ color: '#94a3b8', fontSize: '0.85rem', textDecoration: 'none' }}>← Back to Strategy</Link>
      </div>
    </div>
  );
}
