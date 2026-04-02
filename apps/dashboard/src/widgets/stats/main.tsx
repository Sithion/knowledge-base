import React from 'react';
import ReactDOM from 'react-dom/client';
import '../shared/widget.css';
import { StatsWidget } from './StatsWidget.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StatsWidget />
  </React.StrictMode>,
);
