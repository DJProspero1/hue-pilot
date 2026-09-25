import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installHueApi } from './lib/api';
import './styles.css';

installHueApi();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
