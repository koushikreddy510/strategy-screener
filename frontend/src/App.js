import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import StrategiesList from './pages/StrategiesList';
import NewStrategy from './pages/NewStrategy';
import EditStrategy from './pages/EditStrategy';
import ConditionsList from './pages/ConditionsList';
import NewCondition from './pages/NewCondition';
import EditCondition from './pages/EditCondition';
import RunScreen from './pages/RunScreen';
import SectorExplorer from './pages/SectorExplorer';
import CandlePatterns from './pages/CandlePatterns';
import Financials from './pages/Financials';
import Trading from './pages/Trading';
import Admin from './pages/Admin';

function NavBar() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const currentMarket = search.get('market') || 'stocks';
  const path = location.pathname;

  const tabStyle = (active) => ({
    textDecoration: 'none',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    fontWeight: active ? 700 : 500,
    fontSize: '0.875rem',
    padding: '0.5rem 1rem',
    borderRadius: 'var(--radius)',
    background: active ? 'var(--primary-muted)' : 'transparent',
    transition: 'all 0.15s',
  });

  const isStrategies = path === '/strategies' || path === '/';
  const isSectors = path === '/sectors';
  const isPatterns = path === '/patterns';
  const isFinancials = path === '/financials';
  const isTrading = path === '/trading';
  const isAdmin = path === '/admin';

  return (
    <nav>
      <Link to="/strategies?market=stocks" style={{ textDecoration: 'none', marginRight: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 800, background: 'linear-gradient(135deg, var(--primary), var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Screener
        </span>
      </Link>
      <Link to="/strategies?market=stocks" style={tabStyle(isStrategies && currentMarket === 'stocks')}>
        Stocks
      </Link>
      <Link to="/strategies?market=commodities" style={tabStyle(isStrategies && currentMarket === 'commodities')}>
        Commodities
      </Link>
      <Link to="/sectors" style={tabStyle(isSectors)}>
        Sectors
      </Link>
      <Link to="/patterns" style={tabStyle(isPatterns)}>
        Patterns
      </Link>
      <Link to="/financials" style={tabStyle(isFinancials)}>
        Financials
      </Link>
      <Link to="/trading" style={tabStyle(isTrading)}>
        Trading
      </Link>
      <Link to="/admin" style={tabStyle(isAdmin)}>
        Admin
      </Link>
      <div style={{ flex: 1 }} />
      <Link to="/strategies/new" style={{
        textDecoration: 'none',
        background: 'var(--primary)',
        color: 'white',
        padding: '0.4rem 1rem',
        borderRadius: 'var(--radius)',
        fontWeight: 600,
        fontSize: '0.8rem',
        transition: 'all 0.15s',
      }}>
        + New Strategy
      </Link>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <NavBar />
      <div className="container">
        <Routes>
          <Route path="/strategies" element={<StrategiesList />} />
          <Route path="/strategies/new" element={<NewStrategy />} />
          <Route path="/strategies/:id/edit" element={<EditStrategy />} />
          <Route path="/strategies/:id/conditions" element={<ConditionsList />} />
          <Route path="/strategies/:id/conditions/new" element={<NewCondition />} />
          <Route path="/strategies/:strategyId/conditions/:conditionId/edit" element={<EditCondition />} />
          <Route path="/run/:id" element={<RunScreen />} />
          <Route path="/sectors" element={<SectorExplorer />} />
          <Route path="/patterns" element={<CandlePatterns />} />
          <Route path="/financials" element={<Financials />} />
          <Route path="/trading" element={<Trading />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<StrategiesList />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
