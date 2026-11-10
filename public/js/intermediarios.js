/**
 * Controlador de Control de Intermediarios (Maestro)
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
    showToast('Actualizando datos...');
    await cargarDatos();
    showToast('Datos sincronizados.');
  });

  // Filtros
  $('#filter-m-sucursal, #filter-m-ejecutivo, #filter-m-activo').on('change', aplicarFiltros);

  // Cerrar modales
  $('#modal-m-btn-close, #modal-m-btn-cancel').on('click', cerrarModalMaestro);
  $('#history-m-btn-close').on('click', () => $('#history-maestro-overlay').addClass('hidden'));

  // Submit formulario maestro
  $('#maestro-form').on('submit', guardarMaestro);

  // Delegación de eventos en tabla
  $('#table-dt-maestro tbody').on('click', '.btn-edit-maestro', function() {
    const cod = String($(this).data('cod'));
    const reg = currentData.maestro.find(x => String(x.cod).toUpperCase() === cod.toUpperCase());
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

    // Poblar filtros y selects
    poblarCatalogos();

    // Renderizar tabla
    renderizarTablaMaestro(res.maestro || []);
    $('#badge-total-maestro').text(`${(res.maestro || []).length} registros`);
  } catch (err) {
    showToast('Error cargando datos del sistema: ' + err.message, true);
  }
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
        data: 'intermediario',
        render: d => `<span class="font-semibold text-slate-900">${d || '—'}</span>`
      },
      {
        data: 'cod',
        render: d => `<span class="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5">${d || '—'}</span>`
      },
      {
        data: 'cedula',
        render: d => `<span class="font-mono text-xs text-slate-600">${d || '—'}</span>`
      },
      {
        data: 'ejecutivo',
        render: d => d ? `<span class="font-medium text-slate-800">${d}</span>` : '<span class="text-slate-400 italic">Sin asignar</span>'
      },
      { data: 'fechaInicio', render: d => formatearFechaUI(d) },
      { data: 'fechaFin', render: d => formatearFechaUI(d) },
      { data: 'sucursal', render: d => d || '—' },
      { data: 'lider', render: d => d || '—' },
      {
        data: 'activo',
        render: (d, t, row) => {
          const act = String(d).toUpperCase() === 'SI';
          if (esSupervisor) {
            return `<button type="button" class="btn-toggle-activo px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${act ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-slate-200 text-slate-600 border border-slate-300'}" data-cod="${row.cod}" data-id="${row.id}" data-act="${row.activo}">${act ? 'SI' : 'NO'}</button>`;
          }
          return `<span class="px-2 py-0.5 text-[10px] font-bold uppercase ${act ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-slate-100 text-slate-600 border border-slate-300'}">${act ? 'SI' : 'NO'}</span>`;
        }
      },
      {
        data: null,
        className: 'text-right',
        orderable: false,
        render: (d, t, row) => `
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" class="btn-edit-maestro btn-outline px-2 py-1 text-[11px] font-semibold" data-cod="${row.cod}" title="Editar">
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

  dtMaestro.column(6).search(suc ? `^${suc}$` : '', true, false);
  dtMaestro.column(3).search(ej ? `^${ej}$` : '', true, false);
  dtMaestro.column(8).search(act ? `^${act}$` : '', true, false);
  dtMaestro.draw();
}

function abrirModalMaestro(reg = null) {
  editingOriginal = reg;
  const errBox = $('#form-m-error').addClass('hidden');
  const aviso = $('#aviso-bloqueo-ejecutivo').addClass('hidden');

  if (reg) {
    $('#modal-maestro-title').text('Editar Intermediario');
    $('#form-m-id').val(reg.id || '');
    $('#form-m-intermediario').val(reg.intermediario || '');
    $('#form-m-cod').val(reg.cod || '').prop('readonly', true);
    
    // Parseo de cédula
    const ced = String(reg.cedula || '').trim();
    if (ced.startsWith('V-') || ced.startsWith('E-') || ced.startsWith('J-') || ced.startsWith('G-')) {
      $('#form-m-cedula-tipo').val(ced.slice(0, 2));
      $('#form-m-cedula-num').val(ced.slice(2));
    } else {
      $('#form-m-cedula-tipo').val('V-');
      $('#form-m-cedula-num').val(ced);
    }

    $('#form-m-correo').val(reg.correo || '');
    $('#form-m-ejecutivo').val(reg.ejecutivo || '');
    $('#form-m-sucursal').val(reg.sucursal || '');
    $('#form-m-lider').val(reg.lider || '');
    $('#form-m-fechainicio').val(reg.fechaInicio || '');
    $('#form-m-fechafin').val(reg.fechaFin || '');
    $('#form-m-fechanac').val(reg.fechaNac || '');
    $('#form-m-fechaafiliacion').val(reg.fechaAfiliacion || '');
    $('#form-m-activo').val(reg.activo || 'SI');

    if (reg.ejecutivo && (!reg.fechaFin || reg.fechaFin === '')) {
      aviso.html(`<strong>Aviso:</strong> El intermediario está actualmente asignado a <strong>${reg.ejecutivo}</strong> sin Fecha Fin. Para reasignarlo a otro ejecutivo, primero asígnele su Fecha Fin para liberarlo.`);
      aviso.removeClass('hidden');
    }
  } else {
    $('#modal-maestro-title').text('Nuevo Intermediario');
    $('#maestro-form')[0].reset();
    $('#form-m-id').val('');
    $('#form-m-cod').prop('readonly', false);
    $('#form-m-activo').val('SI');
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
  const nuevoEjecutivo = $('#form-m-ejecutivo').val().trim();

  // Validar bloqueo en cliente si reasigna ejecutivo sin fecha fin
  if (editingOriginal && editingOriginal.ejecutivo && editingOriginal.ejecutivo !== nuevoEjecutivo && (!editingOriginal.fechaFin || editingOriginal.fechaFin === '')) {
    errBox.text(`Operación bloqueada: El ejecutivo actual (${editingOriginal.ejecutivo}) aún no tiene Fecha Fin. Asigne Fecha Fin primero y guarde para liberarlo.`);
    errBox.removeClass('hidden');
    return;
  }

  const cedTipo = $('#form-m-cedula-tipo').val();
  const cedNum = $('#form-m-cedula-num').val().trim();
  const cedulaFinal = cedNum ? (cedTipo + cedNum) : '';

  const payload = {
    id: $('#form-m-id').val(),
    cod: $('#form-m-cod').val().trim().toUpperCase(),
    intermediario: $('#form-m-intermediario').val().trim(),
    ejecutivo: nuevoEjecutivo,
    sucursal: $('#form-m-sucursal').val().trim(),
    lider: $('#form-m-lider').val().trim(),
    activo: $('#form-m-activo').val(),
    cedula: cedulaFinal,
    correo: $('#form-m-correo').val().trim(),
    fechaInicio: $('#form-m-fechainicio').val(),
    fechaFin: $('#form-m-fechafin').val(),
    fechaNac: $('#form-m-fechanac').val(),
    fechaAfiliacion: $('#form-m-fechaafiliacion').val()
  };

  const btnSubmit = $('#modal-m-btn-submit').prop('disabled', true).text('Guardando...');

  try {
    const res = await apiFetch('/api/intermediarios/guardar', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    showToast(res.mensaje || 'Intermediario guardado.');
    cerrarModalMaestro();
    await cargarDatos();
  } catch (err) {
    errBox.text(err.message).removeClass('hidden');
  } finally {
    btnSubmit.prop('disabled', false).text('Guardar Intermediario');
  }
}

function abrirModalHistorial(cod) {
  const normCod = cod.trim().toUpperCase();
  const items = (currentData.historicoMaestro || []).filter(x => String(x.cod).trim().toUpperCase() === normCod);
  
  $('#history-m-subtitle').text(`Código: ${normCod} · Total periodos históricos: ${items.length}`);
  const tbody = $('#history-m-tbody').empty();

  if (items.length === 0) {
    tbody.append('<tr><td colspan="6" class="py-4 text-center text-slate-500 italic">No hay historial de reasignaciones para este código.</td></tr>');
  } else {
    items.forEach(item => {
      tbody.append(`
        <tr class="hover:bg-slate-50">
          <td class="py-2.5 px-3 font-medium text-slate-900">${item.intermediario || '—'}</td>
          <td class="py-2.5 px-3 font-mono text-slate-700">${item.cod || '—'}</td>
          <td class="py-2.5 px-3 font-semibold text-slate-800">${item.ejecutivo || '—'}</td>
          <td class="py-2.5 px-3 text-slate-600">${item.sucursal || '—'} / ${item.lider || '—'}</td>
          <td class="py-2.5 px-3 font-mono text-slate-600">${formatearFechaUI(item.fechaInicio)} → ${formatearFechaUI(item.fechaFin)}</td>
          <td class="py-2.5 px-3 font-bold text-[10px] ${item.activo === 'SI' ? 'text-emerald-700' : 'text-slate-500'}">${item.activo || 'SI'}</td>
        </tr>
      `);
    });
  }

  $('#history-maestro-overlay').removeClass('hidden');
}

