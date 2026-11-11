/**
 * API Client & Global Helpers
 * Sistema de Control de Intermediarios y Reclasificaciones
 * Cliente Resiliente con Dual-Route Fallback para Vercel Serverless
 */

const TOKEN_KEY = 'ci_auth_token_v6';
const USER_KEY = 'ci_user_info_v6';
const CACHE_DATA_KEY = 'ci_data_cache_v6';

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers
  };

  // Determinar URL primaria (/api/...) y URL alternativa (directa /...)
  let cleanEndpoint = endpoint.startsWith('http') ? endpoint : (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);
  let primaryUrl = cleanEndpoint.startsWith('/api/') ? cleanEndpoint : `/api${cleanEndpoint}`;
  let alternateUrl = cleanEndpoint.startsWith('/api/') ? cleanEndpoint.replace('/api/', '/') : cleanEndpoint;

  let response;
  try {
    response = await fetch(primaryUrl, config);
    // Si la ruta con /api/ da 404 en Vercel, reintentar automáticamente sin /api/
    if (response.status === 404 && primaryUrl !== alternateUrl) {
      const respAlt = await fetch(alternateUrl, config);
      if (respAlt.status !== 404) {
        response = respAlt;
      }
    }
  } catch (netErr) {
    if (primaryUrl !== alternateUrl) {
      response = await fetch(alternateUrl, config);
    } else {
      console.error(`[API Network Error] ${endpoint}:`, netErr);
      throw new Error('Error de conexión con el servidor. Verifique su conexión.');
    }
  }

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (!window.location.pathname.includes('login')) {
      window.location.href = '/login.html';
    }
    throw new Error('Sesión expirada. Por favor inicie sesión nuevamente.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.mensaje || `Error en la petición (${response.status})`);
  }
  return data;
}

function showToast(message, isError = false) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item pointer-events-auto p-3 text-xs font-medium border shadow-lg flex items-center justify-between gap-3 ${
    isError
      ? 'bg-red-50 text-red-900 border-red-300'
      : 'bg-emerald-50 text-emerald-950 border-emerald-300'
  }`;

  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 ${isError ? 'bg-red-600' : 'bg-emerald-600'}"></span>
      <span>${message}</span>
    </div>
    <button type="button" class="text-slate-400 hover:text-slate-800 text-sm font-bold">✕</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

function showConfirm(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 bg-slate-900/60 modal-backdrop flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-white border border-slate-300 max-w-md w-full p-5 shadow-2xl modal-panel space-y-4">
      <div class="flex items-center gap-2">
        <div class="w-2 h-5 bg-slate-900"></div>
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-900">${title}</h3>
      </div>
      <p class="text-xs text-slate-600 leading-relaxed">${message}</p>
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
        <button id="confirm-cancel" class="btn-outline px-3 py-1.5 text-xs font-semibold">Cancelar</button>
        <button id="confirm-ok" class="btn-dark px-3 py-1.5 text-xs font-semibold">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#confirm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#confirm-ok').onclick = () => {
    overlay.remove();
    onConfirm();
  };
}
