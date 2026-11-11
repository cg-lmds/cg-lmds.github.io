/**
 * Auth & Role Access Control
 */

function getCurrentUser() {
  const userJson = localStorage.getItem(USER_KEY);
  if (!userJson) return null;
  try {
    return JSON.parse(userJson);
  } catch (e) {
    return null;
  }
}

function checkAuth(requiredRoles = []) {
  const token = localStorage.getItem(TOKEN_KEY);
  const user = getCurrentUser();

  if (!token || !user) {
    if (!window.location.pathname.includes('login')) {
      window.location.href = '/login.html';
    }
    return null;
  }

  // Verificar si la página requiere roles específicos
  if (requiredRoles.length > 0) {
    const userRole = (user.rol || '').toLowerCase();
    const hasRole = requiredRoles.some(r => r.toLowerCase() === userRole);
    if (!hasRole) {
      alert(`Acceso no autorizado: Su rol (${user.rol}) no tiene permisos para esta sección.`);
      window.location.href = '/intermediarios.html';
      return null;
    }
  }

  updateHeaderUI(user);
  applyRoleVisibility(user);
  return user;
}

function updateHeaderUI(user) {
  const nameEl = document.getElementById('header-user-name');
  const roleEl = document.getElementById('header-user-role');
  const avatarEl = document.getElementById('header-user-avatar');
  const displayName = user.nombre || user.username || 'Usuario';
  if (nameEl) nameEl.textContent = displayName;
  if (roleEl) roleEl.textContent = user.rol || 'Operadora';
  if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = '/login.html';
    };
  }
}

function applyRoleVisibility(user) {
  const userRole = (user.rol || '').toLowerCase();
  
  // Elementos marcados para solo Supervisor
  document.querySelectorAll('[data-role="Supervisor"]').forEach(el => {
    if (userRole !== 'supervisor') {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  });
}

