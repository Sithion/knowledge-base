import React from 'react';
import ReactDOM from 'react-dom/client';
import '../shared/widget.css';
import { PlanStatsWidget } from './PlanStatsWidget.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlanStatsWidget />
  </React.StrictMode>,
);
