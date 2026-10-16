// Ponto de entrada da versão HTML autônoma: carrega o catálogo e as imagens embutidos no próprio arquivo,
// inicializa o backend local e monta exatamente o mesmo aplicativo React do site.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '../client/lib/router';
import { StoreProvider } from '../client/lib/store';
import { App } from '../client/App';
import { initBackend, publicConfig, type SeedData } from './backend';
import '../client/styles/index.css';

const readJson = <T,>(id: string): T => JSON.parse(document.getElementById(id)!.textContent!) as T;

async function boot() {
  const images = readJson<Record<string, string>>('gazu-images');
  const resolve = (u: string) => images[u] ?? u;
  window.__GAZU_ASSET__ = (u) => images[u];
  await initBackend(readJson<SeedData>('gazu-seed'), resolve);
  // O StoreProvider lê a configuração inicial deste elemento (como no site, onde o servidor a injeta).
  let bootEl = document.getElementById('gazu-boot');
  if (!bootEl) { bootEl = document.createElement('script'); bootEl.id = 'gazu-boot'; bootEl.setAttribute('type', 'application/json'); document.head.appendChild(bootEl); }
  bootEl.textContent = JSON.stringify({ config: publicConfig() });
  if (!window.location.hash.startsWith('#/')) history.replaceState(null, '', '#/');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </RouterProvider>
    </StrictMode>,
  );
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('root')!.innerHTML = '<p style="padding:24px;font-family:sans-serif">Não foi possível iniciar a demonstração neste navegador.</p>';
});
