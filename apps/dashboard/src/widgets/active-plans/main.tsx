import React from 'react';
import ReactDOM from 'react-dom/client';
import '../shared/widget.css';
import { ActivePlansWidget } from './ActivePlansWidget.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ActivePlansWidget />
  </React.StrictMode>,
);
