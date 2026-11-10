/**
 * Controlador de Control de Reclasificaciones
 * Conexión bidireccional con Control de Intermediarios
 */

let dtReclasif = null;
let currentData = {
  maestro: [],
  historial: [],
  sucursales: [],
  ejecutivos: [],
  lideres: [],
  canales: []
};
let editingRow = null;

$(document).ready(async () => {
  const user = checkAuth();
  if (!user) return;

  await cargarDatos();

  // Eventos principales
  $('#btn-nueva-reclasif').on('click', () => abrirModalReclasif());
  $('#btn-refresh-r').on('click', async () => {
    showToast('Actualizando datos...');
    await cargarDatos();
    showToast('Datos sincronizados.');
  });

  // Filtros
  $('#filter-r-sucursal, #filter-r-ejecutivo, #filter-r-canal, #filter-r-estatus').on('change', aplicarFiltros);

  // Cerrar modal
  $('#modal-r-btn-close, #modal-r-btn-cancel').on('click', cerrarModalReclasif);

  // Formulario Reclasificación
  $('#reclasif-form').on('submit', guardarReclasificacion);

  // Detección de enlace en vivo al escribir el Intermediario Corregido
  $('#form-r-correccion').on('input change', detectarEnlaceConMaestro);

  // Detección de asignación activa al ingresar el Nro de Póliza
  $('#form-r-nropoliza').on('blur change', verificarVigenciaPreviaPoliza);

  // Delegación de eventos en tabla
  $('#table-dt-reclasif tbody').on('click', '.btn-edit-r', function() {
    const idUnico = String($(this).data('id'));
    const reg = currentData.historial.find(x => String(x.idUnico) === idUnico);
    if (reg) abrirModalReclasif(reg);
  });
});

async function cargarDatos() {
  try {
    const res = await apiFetch('/api/data/sistema');
    currentData = res;

    poblarCatalogos();
    renderizarTablaReclasif(res.historial || []);
    $('#badge-total-r').text(`${(res.historial || []).length} registros`);
  } catch (err) {
    showToast('Error cargando datos: ' + err.message, true);
  }
}

function poblarCatalogos() {
  const sucursales = currentData.sucursales || [];
  const ejecutivos = currentData.ejecutivos || [];
  const lideres = currentData.lideres || [];
  const canales = currentData.canales || [];
  const maestro = currentData.maestro || [];

  // Filtros
  const fSuc = $('#filter-r-sucursal').empty().append('<option value="">Todas las Sucursales</option>');
  const fEj = $('#filter-r-ejecutivo').empty().append('<option value="">Todos los Ejecutivos</option>');
  const fCan = $('#filter-r-canal').empty().append('<option value="">Todos los Canales</option>');
  sucursales.forEach(s => fSuc.append(new Option(s, s)));
  ejecutivos.forEach(e => fEj.append(new Option(e, e)));
  canales.forEach(c => fCan.append(new Option(c, c)));

  // Formulario modal
  const mSuc = $('#form-r-sucursal').empty().append('<option value="">Seleccione...</option>');
  const mEj = $('#form-r-ejecutivo').empty().append('<option value="">Seleccione...</option>');
  const mLid = $('#form-r-lider').empty().append('<option value="">Seleccione...</option>');
  const mCan = $('#form-r-canal').empty().append('<option value="">Seleccione...</option>');
  sucursales.forEach(s => mSuc.append(new Option(s, s)));
  ejecutivos.forEach(e => mEj.append(new Option(e, e)));
  lideres.forEach(l => mLid.append(new Option(l, l)));
  canales.forEach(c => mCan.append(new Option(c, c)));

  // Datalist de intermediarios para autocompletado rápido
  const datalist = $('#datalist-intermediarios').empty();
  maestro.forEach(m => {
    datalist.append(`<option value="${m.intermediario} [${m.cod}]" data-cod="${m.cod}" data-nombre="${m.intermediario}">`);
  });
}

function detectarEnlaceConMaestro() {
  const val = $('#form-r-correccion').val().trim();
  if (!val) {
    $('#r-maestro-match-info').addClass('hidden');
    $('#form-r-codigo-int').val('');
    return;
  }

  // Extraer posible código si viene en formato "Nombre [COD-123]"
  const matchCod = val.match(/\[([^\]]+)\]/);
  const searchCod = matchCod ? matchCod[1].trim() : '';
  const searchName = val.replace(/\[[^\]]+\]/, '').trim().toUpperCase();

  const match = (currentData.maestro || []).find(m => {
    if (searchCod && String(m.cod).toUpperCase() === searchCod.toUpperCase()) return true;
    if (String(m.cod).toUpperCase() === val.toUpperCase()) return true;
    return String(m.intermediario).toUpperCase() === searchName;
  });

  if (match) {
    $('#form-r-codigo-int').val(match.cod);
    
    // Auto-completar sucursal, ejecutivo y líder vigentes desde el maestro
    if (match.sucursal) $('#form-r-sucursal').val(match.sucursal);
    if (match.ejecutivo) $('#form-r-ejecutivo').val(match.ejecutivo);
    if (match.lider) $('#form-r-lider').val(match.lider);

    $('#match-cod').text(`Código Maestro: ${match.cod}`);
    $('#match-activo').text(match.activo === 'SI' ? 'ACTIVO' : 'INACTIVO')
      .attr('class', match.activo === 'SI' ? 'px-1.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold' : 'px-1.5 py-0.5 bg-red-100 text-red-800 font-bold');
    $('#match-detalles').text(`Asignado en Maestro a: ${match.ejecutivo || 'Sin asignar'} (${match.sucursal || 'Sin sucursal'})`);
    $('#r-maestro-match-info').removeClass('hidden');
  } else {
    $('#r-maestro-match-info').addClass('hidden');
    $('#form-r-codigo-int').val('');
  }
}

function verificarVigenciaPreviaPoliza() {
  const poliza = $('#form-r-nropoliza').val().trim().toUpperCase();
  const box = $('#r-closure-box').addClass('hidden');
  if (!poliza || editingRow) return;

  // Buscar si esta póliza tiene un registro vigente (sin fecha fin)
  const vigente = (currentData.historial || []).find(h => {
    const codPol = String(h.codigo || '').toUpperCase();
    return codPol === poliza && (!h.fechaFin || h.fechaFin === '' || h.fechaFin === '—');
  });

  if (vigente) {
    box.html(`
      <strong>Aviso de Vigencia:</strong> La póliza <strong>${poliza}</strong> ya tiene una reclasificación activa a nombre de 
      <strong>${vigente.nombreIntermediario}</strong> (Ejecutivo: ${vigente.ejecutivo || 'N/A'}).
      Al guardar, el sistema asignará como <strong>Fecha Fin</strong> del periodo anterior el día previo a la nueva fecha de inicio.
    `).removeClass('hidden');
  }
}

function renderizarTablaReclasif(datos) {
  if (dtReclasif) {
    dtReclasif.destroy();
    $('#table-dt-reclasif tbody').empty();
  }

  dtReclasif = $('#table-dt-reclasif').DataTable({
    data: datos,
    deferRender: true,
    pageLength: 25,
    lengthMenu: [15, 25, 50, 100],
    autoWidth: false,
    order: [[0, 'desc']],
    columns: [
      {
        data: 'codigo',
        render: d => `<span class="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5">${d || '—'}</span>`
      },
      {
        data: 'nombreTomador',
        render: (d, t, row) => `
          <div>
            <span class="font-medium text-slate-800">${row.nombreIntermediario || '—'}</span>
            ${row.nombreTomador ? `<div class="text-[11px] text-slate-500">Tomador: ${row.nombreTomador}</div>` : ''}
          </div>
        `
      },
      {
        data: 'nombreAsegurado',
        render: d => d ? `<span class="text-xs text-slate-700">${d}</span>` : '<span class="text-slate-400 italic">—</span>'
      },
      {
        data: 'nombreIntermediario',
        render: (d, t, row) => `
          <div class="flex items-center gap-1.5">
            <span class="font-semibold text-slate-900">${d || '—'}</span>
            <span class="text-[9px] px-1 py-0.2 bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono">CORREGIDO</span>
          </div>
        `
      },
      { data: 'sucursal', render: d => d || '—' },
      { data: 'ejecutivo', render: d => `<span class="font-medium text-slate-800">${d || '—'}</span>` },
      {
        data: null,
        render: (d, t, row) => `
          <div class="text-xs">
            <span class="text-slate-800">${row.lider || '—'}</span>
            ${row.canal ? `<span class="text-[10px] text-slate-500 block">Canal: ${row.canal}</span>` : ''}
          </div>
        `
      },
      {
        data: null,
        render: (d, t, row) => `
          <span class="font-mono text-[11px] text-slate-600">
            ${formatearFechaUI(row.fechaInicio)} → ${formatearFechaUI(row.fechaFin)}
          </span>
        `
      },
      {
        data: 'estatus',
        render: d => {
          const act = String(d).toUpperCase() === 'ACTIVO';
          return `<span class="px-2 py-0.5 text-[10px] font-bold uppercase ${act ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-slate-100 text-slate-600 border border-slate-300'}">${act ? 'ACTIVO' : 'INACTIVO'}</span>`;
        }
      },
      {
        data: null,
        className: 'text-right',
        orderable: false,
        render: (d, t, row) => `
          <button type="button" class="btn-edit-r btn-outline px-2 py-1 text-[11px] font-semibold" data-id="${row.idUnico}">
            Editar
          </button>
        `
      }
    ],
    language: {
      search: "Buscar:",
      lengthMenu: "Mostrar _MENU_",
      info: "Mostrando _START_ a _END_ de _TOTAL_",
      infoEmpty: "0 registros",
      infoFiltered: "(filtrado de _MAX_)",
      zeroRecords: "No se encontraron reclasificaciones",
      paginate: { first: "«", previous: "‹", next: "›", last: "»" }
    }
  });
}

function aplicarFiltros() {
  if (!dtReclasif) return;
  const suc = $('#filter-r-sucursal').val();
  const ej = $('#filter-r-ejecutivo').val();
  const can = $('#filter-r-canal').val();
  const est = $('#filter-r-estatus').val();

  dtReclasif.column(4).search(suc ? `^${suc}$` : '', true, false);
  dtReclasif.column(5).search(ej ? `^${ej}$` : '', true, false);
  dtReclasif.column(6).search(can ? can : '', false, false);
  dtReclasif.column(8).search(est ? `^${est}$` : '', true, false);
  dtReclasif.draw();
}

function abrirModalReclasif(reg = null) {
  editingRow = reg;
  $('#form-r-error').addClass('hidden');
  $('#r-closure-box').addClass('hidden');
  $('#r-maestro-match-info').addClass('hidden');

  const hoy = new Date().toISOString().slice(0, 10);

  if (reg) {
    $('#modal-r-title').text('Editar Reclasificación');
    $('#form-r-modo').val('EDIT_ROW');
    $('#form-r-edit-id').val(reg.idUnico || '');
    $('#form-r-nropoliza').val(reg.codigo || '').prop('readonly', true);
    $('#form-r-nombreoriginal').val(reg.nombreIntermediario || '');
    $('#form-r-tomador').val(reg.nombreTomador || '');
    $('#form-r-asegurado').val(reg.nombreAsegurado || '');
    $('#form-r-correccion').val(reg.nombreIntermediario || '');
    $('#form-r-sucursal').val(reg.sucursal || '');
    $('#form-r-ejecutivo').val(reg.ejecutivo || '');
    $('#form-r-lider').val(reg.lider || '');
    $('#form-r-canal').val(reg.canal || '');
    $('#form-r-fechainicio').val(reg.fechaInicio || hoy);
    $('#form-r-fechafin').val(reg.fechaFin || '');
    $('#form-r-estatus').val(reg.estatus || 'ACTIVO');
    detectarEnlaceConMaestro();
  } else {
    $('#modal-r-title').text('Nueva Reclasificación de Póliza');
    $('#reclasif-form')[0].reset();
    $('#form-r-modo').val('NEW_OR_RECLASSIFY');
    $('#form-r-edit-id').val('');
    $('#form-r-nropoliza').prop('readonly', false);
    $('#form-r-fechainicio').val(hoy);
    $('#form-r-estatus').val('ACTIVO');
  }

  $('#modal-reclasif-overlay').removeClass('hidden');
}

function cerrarModalReclasif() {
  $('#modal-reclasif-overlay').addClass('hidden');
  editingRow = null;
}

async function guardarReclasificacion(e) {
  e.preventDefault();
  const errBox = $('#form-r-error').addClass('hidden');

  // Limpiar valor de corrección para quitar posible "[COD-123]"
  const rawCorreccion = $('#form-r-correccion').val().trim();
  const cleanCorreccion = rawCorreccion.replace(/\[[^\]]+\]/, '').trim();

  const payload = {
    modo: $('#form-r-modo').val(),
    editId: $('#form-r-edit-id').val(),
    nroPoliza: $('#form-r-nropoliza').val().trim().toUpperCase(),
    nombreIntermediarioOriginal: $('#form-r-nombreoriginal').val().trim(),
    nombreTomador: $('#form-r-tomador').val().trim(),
    nombreAsegurado: $('#form-r-asegurado').val().trim(),
    correccionIntermediario: cleanCorreccion || rawCorreccion,
    codigoIntermediario: $('#form-r-codigo-int').val() || '',
    sucursalReclasif: $('#form-r-sucursal').val().trim(),
    ejecutivoReclasif: $('#form-r-ejecutivo').val().trim(),
    liderReclasif: $('#form-r-lider').val().trim(),
    canalReclasif: $('#form-r-canal').val().trim(),
    fechaInicio: $('#form-r-fechainicio').val(),
    fechaFin: $('#form-r-fechafin').val(),
    estatus: $('#form-r-estatus').val()
  };

  const btnSubmit = $('#modal-r-btn-submit').prop('disabled', true).text('Guardando...');

  try {
    const res = await apiFetch('/api/reclasificaciones/guardar', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    showToast(res.mensaje || 'Reclasificación registrada.');
    cerrarModalReclasif();
    await cargarDatos();
  } catch (err) {
    errBox.text(err.message).removeClass('hidden');
  } finally {
    btnSubmit.prop('disabled', false).text('Guardar Reclasificación');
  }
}

