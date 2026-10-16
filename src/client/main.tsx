import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from './lib/router';
import { StoreProvider } from './lib/store';
import { App } from './App';
import './styles/index.css';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <RouterProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </RouterProvider>
    </StrictMode>,
  );
}
