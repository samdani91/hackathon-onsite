import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './components/Dashboard';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Dashboard />
      </Router>
    </ErrorBoundary>
  );
}

export default App;

