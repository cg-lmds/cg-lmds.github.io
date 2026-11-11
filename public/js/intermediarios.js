/**
 * Controlador de Control de Intermediarios (Maestro)
 * Conexión Snapshot-Before-Update e Interfaz Industrial
 */

let dtMaestro = null;
let currentData = {
  maestro: [],
  historicoMaestro: [],
  sucursales: [],
  ejecutivos: [],
  lideres: []
};
let editingOriginal = null;

$(document).ready(async () => {
  const user = checkAuth();
  if (!user) return;

  await cargarDatos();

  // Eventos de botones principales
  $('#btn-nuevo-maestro').on('click', () => abrirModalMaestro());
  $('#btn-refresh-maestro').on('click', async () => {
    showToast('Sincronizando intermediarios con Google Cloud...');
    await cargarDatos();
    showToast('Datos sincronizados en tiempo real.');
  });

  // Filtros
  $('#filter-m-sucursal, #filter-m-ejecutivo, #filter-m-activo').on('change', aplicarFiltros);
  $('#btn-clear-filters-m').on('click', limpiarFiltrosMaestro);

  // Cerrar modales
  $('#modal-m-btn-close, #modal-m-btn-cancel').on('click', cerrarModalMaestro);
  $('#history-m-btn-close').on('click', () => $('#history-maestro-overlay').addClass('hidden'));

  // Submit formulario maestro
  $('#maestro-form').on('submit', guardarMaestro);

  // Delegación de eventos en tabla
  $('#table-dt-maestro tbody').on('click', '.btn-edit-maestro', function() {
    const cod = String($(this).data('cod'));
    const reg = (currentData.maestro || []).find(x => String(x.cod).toUpperCase() === cod.toUpperCase());
    if (reg) abrirModalMaestro(reg);
  }).on('click', '.btn-hist-maestro', function() {
    const cod = String($(this).data('cod'));
    abrirModalHistorial(cod);
  }).on('click', '.btn-toggle-activo', function() {
    const cod = String($(this).data('cod'));
    const id = String($(this).data('id'));
    const act = String($(this).data('act'));
    const nuevo = act === 'SI' ? 'NO' : 'SI';

    showConfirm(
      `Cambiar condición a ${nuevo}`,
      `El intermediario con código ${cod} pasará a estado ACTIVO = ${nuevo}.`,
      async () => {
        try {
          const res = await apiFetch('/api/intermediarios/estatus', {
            method: 'POST',
            body: JSON.stringify({ cod, id, nuevoEstatus: nuevo })
          });
          showToast(res.mensaje || 'Condición actualizada.');
          await cargarDatos();
        } catch (err) {
          showToast(err.message, true);
        }
      }
    );
  });
});

async function cargarDatos() {
  try {
    const res = await apiFetch('/api/data/sistema');
    currentData = res;

    actualizarKPIsMaestro(res.maestro || []);
    poblarCatalogos();
    renderizarTablaMaestro(res.maestro || []);
    $('#badge-total-maestro').text(`${(res.maestro || []).length} intermediarios`);
  } catch (err) {
    showToast('Error cargando datos del sistema: ' + err.message, true);
  }
}

function actualizarKPIsMaestro(maestro) {
  const total = maestro.length;
  const activos = maestro.filter(x => String(x.activo).toUpperCase() === 'SI').length;
  const sucursales = (currentData.sucursales || []).length;
  const ejecutivos = (currentData.ejecutivos || []).length;

  $('#kpi-total-intermediarios').text(total.toLocaleString());
  $('#kpi-intermediarios-activos').text(activos.toLocaleString());
  $('#kpi-m-sucursales').text(sucursales);
  $('#kpi-m-ejecutivos').text(ejecutivos);
}

function poblarCatalogos() {
  const sucursales = currentData.sucursales || [];
  const ejecutivos = currentData.ejecutivos || [];
  const lideres = currentData.lideres || [];

  // Filtros
  const fSuc = $('#filter-m-sucursal').empty().append('<option value="">Todas las Sucursales</option>');
  const fEj = $('#filter-m-ejecutivo').empty().append('<option value="">Todos los Ejecutivos</option>');
  sucursales.forEach(s => fSuc.append(new Option(s, s)));
  ejecutivos.forEach(e => fEj.append(new Option(e, e)));

  // Formulario modal
  const mEj = $('#form-m-ejecutivo').empty().append('<option value="">Seleccione...</option>');
  const mSuc = $('#form-m-sucursal').empty().append('<option value="">Seleccione...</option>');
  const mLid = $('#form-m-lider').empty().append('<option value="">Seleccione...</option>');
  ejecutivos.forEach(e => mEj.append(new Option(e, e)));
  sucursales.forEach(s => mSuc.append(new Option(s, s)));
  lideres.forEach(l => mLid.append(new Option(l, l)));
}

function renderizarTablaMaestro(datos) {
  if (dtMaestro) {
    dtMaestro.destroy();
    $('#table-dt-maestro tbody').empty();
  }

  const user = getCurrentUser();
  const esSupervisor = (user?.rol || '').toLowerCase() === 'supervisor';

  dtMaestro = $('#table-dt-maestro').DataTable({
    data: datos,
    deferRender: true,
    pageLength: 25,
    lengthMenu: [15, 25, 50, 100],
    autoWidth: false,
    order: [[0, 'asc']],
    columns: [
      {
        data: 'id',
        render: d => `<span class="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 border border-slate-200">${d || '—'}</span>`
      },
      {
        data: 'intermediario',
        render: (d, t, row) => `
          <div>
            <span class="font-bold text-slate-900">${d || '—'}</span>
            ${row.cedula ? `<div class="text-[10px] font-mono text-slate-500">RIF/CI: ${row.cedula}</div>` : ''}
          </div>
        `
      },
      {
        data: 'cod',
        render: d => `<span class="font-mono text-xs font-bold text-slate-900 bg-emerald-50 text-emerald-800 border border-emerald-300 px-2 py-0.5">${d || '—'}</span>`
      },
      {
        data: 'ejecutivo',
        render: d => d ? `<span class="font-semibold text-slate-800">${d}</span>` : '<span class="text-slate-400 italic text-[11px]">Sin asignar</span>'
      },
      {
        data: 'sucursal',
        render: d => d ? `<span class="font-medium text-slate-700">${d}</span>` : '<span class="text-slate-400">—</span>'
      },
      {
        data: 'lider',
        render: d => d ? `<span class="text-xs text-slate-600">${d}</span>` : '<span class="text-slate-400">—</span>'
      },
      {
        data: null,
        render: (d, t, row) => `
          <span class="font-mono text-[11px] text-slate-600 block">
            ${formatearFechaUI(row.fechaInicio)} → ${formatearFechaUI(row.fechaFin)}
          </span>
        `
      },
      {
        data: 'activo',
        render: (d, t, row) => {
          const act = String(d).toUpperCase() === 'SI';
          if (esSupervisor) {
            return `<button type="button" class="btn-toggle-activo badge-tech ${act ? 'badge-active' : 'badge-inactive'} cursor-pointer" data-cod="${row.cod}" data-id="${row.id}" data-act="${row.activo}" title="Clic para alternar condición">${act ? 'ACTIVO' : 'INACTIVO'}</button>`;
          }
          return `<span class="badge-tech ${act ? 'badge-active' : 'badge-inactive'}">${act ? 'ACTIVO' : 'INACTIVO'}</span>`;
        }
      },
      {
        data: null,
        className: 'text-right',
        orderable: false,
        render: (d, t, row) => `
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" class="btn-edit-maestro btn-outline px-2.5 py-1 text-[11px] font-semibold" data-cod="${row.cod}" title="Editar Intermediario">
              Editar
            </button>
            <button type="button" class="btn-hist-maestro btn-outline px-2 py-1 text-[11px] font-semibold" data-cod="${row.cod}" title="Ver Historial">
              Historial
            </button>
          </div>
        `
      }
    ],
    language: {
      search: "Buscar:",
      lengthMenu: "Mostrar _MENU_",
      info: "Mostrando _START_ a _END_ de _TOTAL_",
      infoEmpty: "0 registros",
      infoFiltered: "(filtrado de _MAX_)",
      zeroRecords: "No se encontraron intermediarios",
      paginate: { first: "«", previous: "‹", next: "›", last: "»" }
    }
  });
}

function aplicarFiltros() {
  if (!dtMaestro) return;
  const suc = $('#filter-m-sucursal').val();
  const ej = $('#filter-m-ejecutivo').val();
  const act = $('#filter-m-activo').val();

  dtMaestro.column(4).search(suc ? `^${suc}$` : '', true, false);
  dtMaestro.column(3).search(ej ? `^${ej}$` : '', true, false);
  dtMaestro.column(7).search(act ? (act === 'SI' ? 'ACTIVO' : 'INACTIVO') : '', true, false);
  dtMaestro.draw();
}

function limpiarFiltrosMaestro() {
  $('#filter-m-sucursal').val('');
  $('#filter-m-ejecutivo').val('');
  $('#filter-m-activo').val('');
  if (dtMaestro) {
    dtMaestro.search('').columns().search('').draw();
  }
}

function abrirModalMaestro(reg = null) {
  editingOriginal = reg;
  const errBox = $('#form-m-error').addClass('hidden');

  if (reg) {
    $('#modal-m-title').text('Editar Intermediario Maestro');
    $('#form-m-modo').val('EDITAR');
    $('#form-m-id').val(reg.id);

    $('#form-m-nombre').val(reg.intermediario);
    $('#form-m-cod').val(reg.cod).prop('readonly', true).addClass('bg-slate-100');
    $('#form-m-cedula').val(reg.cedula || '');
    $('#form-m-correo').val(reg.correo || '');
    $('#form-m-sucursal').val(reg.sucursal);
    $('#form-m-ejecutivo').val(reg.ejecutivo);
    $('#form-m-lider').val(reg.lider || '');
    $('#form-m-fechainicio').val(formatearFechaInput(reg.fechaInicio));
    $('#form-m-fechafin').val(formatearFechaInput(reg.fechaFin));
    $('#form-m-activo').val(reg.activo);
  } else {
    $('#modal-m-title').text('Registrar Nuevo Intermediario');
    $('#form-m-modo').val('CREAR');
    $('#form-m-id').val('');

    $('#maestro-form')[0].reset();
    $('#form-m-cod').prop('readonly', false).removeClass('bg-slate-100');
    $('#form-m-activo').val('SI');
    $('#form-m-fechainicio').val(new Date().toISOString().slice(0, 10));
  }

  $('#modal-maestro-overlay').removeClass('hidden');
}

function cerrarModalMaestro() {
  $('#modal-maestro-overlay').addClass('hidden');
  editingOriginal = null;
}

async function guardarMaestro(e) {
  e.preventDefault();
  const errBox = $('#form-m-error').addClass('hidden');
  const btnSubmit = $('#modal-m-btn-submit').prop('disabled', true).text('Guardando...');

  const cod = $('#form-m-cod').val().trim();
  const intermediario = $('#form-m-nombre').val().trim();
  const sucursal = $('#form-m-sucursal').val();
  const ejecutivo = $('#form-m-ejecutivo').val();
  const lider = $('#form-m-lider').val();
  const cedula = $('#form-m-cedula').val().trim();
  const correo = $('#form-m-correo').val().trim();
  const fechaInicio = $('#form-m-fechainicio').val();
  const fechaFin = $('#form-m-fechafin').val();
  const activo = $('#form-m-activo').val();

  if (!cod || !intermediario || !sucursal || !ejecutivo) {
    errBox.text('Complete todos los campos obligatorios (*).').removeClass('hidden');
    btnSubmit.prop('disabled', false).text('Guardar Intermediario');
    return;
  }

  const payload = {
    id: $('#form-m-id').val() || null,
    modo: $('#form-m-modo').val(),
    cod: cod,
    intermediario: intermediario,
    sucursal: sucursal,
    ejecutivo: ejecutivo,
    lider: lider,
    cedula: cedula,
    correo: correo,
    fechaInicio: fechaInicio,
    fechaFin: fechaFin,
    activo: activo
  };

  try {
    const res = await apiFetch('/api/intermediarios/guardar', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.exito) {
      showToast(res.mensaje || 'Intermediario guardado.');
      cerrarModalMaestro();
      await cargarDatos();
    } else {
      errBox.text(res.mensaje || 'Error al guardar.').removeClass('hidden');
    }
  } catch (err) {
    errBox.text(err.message || 'Error de comunicación.').removeClass('hidden');
  } finally {
    btnSubmit.prop('disabled', false).text('Guardar Intermediario');
  }
}

function formatearFechaUI(val) {
  if (!val || val === '—') return '—';
  const str = String(val).trim();
  if (str.length >= 10 && str.includes('-')) {
    const p = str.slice(0, 10).split('-');
    if (p.length === 3 && p[0].length === 4) return `${p[2]}/${p[1]}/${p[0]}`;
  }
  return str;
}

function formatearFechaInput(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.length >= 10 && str.includes('-') && str.indexOf('-') === 4) {
    return str.slice(0, 10);
  }
  if (str.includes('/')) {
    const p = str.split('/');
    if (p.length === 3) {
      const d = p[0].padStart(2, '0');
      const m = p[1].padStart(2, '0');
      const y = p[2].length === 2 ? '20' + p[2] : p[2];
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}
