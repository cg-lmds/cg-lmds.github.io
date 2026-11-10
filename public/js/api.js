/**
 * API Client & Global Helpers
 * Sistema de Control de Intermediarios y Reclasificaciones
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

  try {
    const response = await fetch(endpoint, config);
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (!window.location.pathname.includes('login')) {
        window.location.href = '/login';
      }
      throw new Error('Sesión expirada. Por favor inicie sesión nuevamente.');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.mensaje || 'Error en la petición.');
    }
    return data;
  } catch (error) {
    console.error(`[API Error] ${endpoint}:`, error);
    throw error;
  }
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
  toast.className = `pointer-events-auto px-4 py-3 bg-white border border-slate-300 border-l-4 ${
    isError ? 'border-l-red-700' : 'border-l-emerald-700'
  } shadow-lg text-xs font-medium text-slate-900 flex items-center justify-between gap-3 toast-item`;
  toast.innerHTML = `<span>${message}</span><button type="button" class="text-slate-400 hover:text-slate-900 font-bold ml-2">✕</button>`;
  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

let swalConfirmCallback = null;

function showConfirm(title, text, onConfirm) {
  let overlay = document.getElementById('swal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'swal-overlay';
    overlay.className = 'fixed inset-0 z-50 bg-slate-900/50 modal-backdrop flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white border border-slate-300 max-w-md w-full p-6 space-y-4 shadow-xl modal-panel">
        <h4 id="swal-title" class="text-sm font-bold uppercase tracking-wider text-slate-900"></h4>
        <p id="swal-text" class="text-xs text-slate-600 leading-relaxed"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button id="swal-btn-cancel" type="button" class="btn-outline px-4 py-2 text-xs font-semibold">Cancelar</button>
          <button id="swal-btn-confirm" type="button" class="btn-dark px-4 py-2 text-xs font-semibold">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('swal-btn-cancel').onclick = () => overlay.classList.add('hidden');
    document.getElementById('swal-btn-confirm').onclick = () => {
      overlay.classList.add('hidden');
      if (typeof swalConfirmCallback === 'function') swalConfirmCallback();
    };
  }

  document.getElementById('swal-title').textContent = title;
  document.getElementById('swal-text').textContent = text;
  swalConfirmCallback = onConfirm;
  overlay.classList.remove('hidden');
}

function formatearFechaUI(val) {
  if (!val) return '—';
  const s = String(val).trim();
  if (!s || s === '-') return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function restarUnDia(fechaISO) {
  if (!fechaISO) return '';
  const p = fechaISO.split('-').map(Number);
  if (p.length !== 3) return '';
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

