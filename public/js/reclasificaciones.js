/**
 * Controlador de Control de Reclasificaciones
 * Conexión bidireccional con Control de Intermediarios
 * Interfaz Minimalista Industrial de Alto Rendimiento
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
    showToast('Sincronizando con Google Cloud...');
    await cargarDatos();
    showToast('Datos sincronizados en tiempo real.');
  });

  // Filtros
  $('#filter-r-sucursal, #filter-r-ejecutivo, #filter-r-canal, #filter-r-estatus').on('change', aplicarFiltros);
  $('#btn-clear-filters').on('click', limpiarFiltros);

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
    const reg = (currentData.historial || []).find(x => String(x.idUnico) === idUnico);
    if (reg) abrirModalReclasif(reg);
  });
});

async function cargarDatos() {
  try {
    const res = await apiFetch('/api/data/sistema');
    currentData = res;

    actualizarKPIs(res.historial || [], res.maestro || []);
    poblarCatalogos();
    renderizarTablaReclasif(res.historial || []);
    $('#badge-total-r').text(`${(res.historial || []).length} pólizas recientes`);
  } catch (err) {
    showToast('Error cargando datos: ' + err.message, true);
  }
}

function actualizarKPIs(historial, maestro) {
  const total = historial.length;
  const activos = historial.filter(x => String(x.estatus).toUpperCase() === 'ACTIVO').length;
  const reclasificados = historial.filter(x => x.correccionIntermediario && x.correccionIntermediario.trim() !== '').length;
  const sucursales = (currentData.sucursales || []).length;

  $('#kpi-total-polizas').text(total.toLocaleString());
  $('#kpi-polizas-activas').text(activos.toLocaleString());
  $('#kpi-polizas-reclasif').text(reclasificados.toLocaleString());
  $('#kpi-total-sucursales').text(sucursales);
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
  const boxMatch = $('#r-maestro-match-info');
  if (!val) {
    boxMatch.addClass('hidden');
    $('#form-r-codigo-int').val('');
    return;
  }

  // Extraer código si viene en formato "NOMBRE [COD]"
  let codBuscado = '';
  const matchParentesis = val.match(/\[(.*?)\]$/);
  if (matchParentesis) {
    codBuscado = matchParentesis[1].trim();
  }

  const match = (currentData.maestro || []).find(m => {
    if (codBuscado && String(m.cod) === codBuscado) return true;
    const n1 = String(m.intermediario || '').toUpperCase();
    const n2 = val.toUpperCase();
    return n1 === n2 || n1.includes(n2);
  });

  if (match) {
    $('#form-r-codigo-int').val(match.cod);
    $('#match-cod').html(`CÓDIGO: <strong class="text-slate-900">${match.cod}</strong> | ${match.intermediario}`);
    $('#match-activo').text(match.activo === 'SI' ? 'ACTIVO' : 'INACTIVO')
      .attr('class', match.activo === 'SI' ? 'px-2 py-0.5 text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800' : 'px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-200 text-slate-700');
    $('#match-detalles').text(`Sucursal: ${match.sucursal || 'N/A'} | Ejecutivo: ${match.ejecutivo || 'N/A'} | Líder: ${match.lider || 'N/A'}`);
    boxMatch.removeClass('hidden');

    // Autoseleccionar desplegables si están vacíos
    if (match.sucursal && !$('#form-r-sucursal').val()) $('#form-r-sucursal').val(match.sucursal);
    if (match.ejecutivo && !$('#form-r-ejecutivo').val()) $('#form-r-ejecutivo').val(match.ejecutivo);
    if (match.lider && !$('#form-r-lider').val()) $('#form-r-lider').val(match.lider);
  } else {
    $('#form-r-codigo-int').val('');
    boxMatch.addClass('hidden');
  }
}

function verificarVigenciaPreviaPoliza() {
  const poliza = $('#form-r-nropoliza').val().trim().toUpperCase();
  const box = $('#r-closure-box').addClass('hidden');
  if (!poliza || editingRow) return;

  const vigente = (currentData.historial || []).find(h => {
    const codPol = String(h.codigo || '').toUpperCase();
    return codPol === poliza && (!h.fechaFin || h.fechaFin === '' || h.fechaFin === '—');
  });

  if (vigente) {
    box.html(`
      <strong>Aviso de Vigencia:</strong> La póliza <strong>${poliza}</strong> ya tiene una asignación activa a nombre de 
      <strong>${vigente.correccionIntermediario || vigente.nombreOriginal}</strong> (Ejecutivo: ${vigente.ejecutivo || 'N/A'}).
      Al guardar, el sistema archivará el registro previo y asignará como <strong>Fecha Fin</strong> el día anterior a la nueva fecha de inicio.
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
        render: d => `<span class="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 border border-slate-200">${d || '—'}</span>`
      },
      {
        data: 'nombreOriginal',
        render: d => `<span class="text-xs text-slate-700 font-medium">${d || '—'}</span>`
      },
      {
        data: null,
        render: (d, t, row) => `
          <div class="text-xs">
            <span class="text-slate-800 font-medium">${row.nombreTomador || '—'}</span>
            ${row.nombreAsegurado && row.nombreAsegurado !== row.nombreTomador ? `<div class="text-[11px] text-slate-500">Asegurado: ${row.nombreAsegurado}</div>` : ''}
          </div>
        `
      },
      {
        data: null,
        render: (d, t, row) => {
          if (row.correccionIntermediario && row.correccionIntermediario.trim() !== '') {
            return `
              <div class="flex items-center gap-1.5">
                <span class="font-bold text-slate-900">${row.correccionIntermediario}</span>
                <span class="text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono font-semibold">RECLASIFICADO</span>
              </div>
            `;
          }
          return `<span class="text-slate-400 italic text-[11px]">(Sin Reclasificar)</span>`;
        }
      },
      {
        data: 'sucursal',
        render: d => d ? `<span class="font-medium text-slate-800">${d}</span>` : '<span class="text-slate-400">—</span>'
      },
      {
        data: 'ejecutivo',
        render: d => d ? `<span class="font-medium text-slate-800">${d}</span>` : '<span class="text-slate-400">—</span>'
      },
      {
        data: null,
        render: (d, t, row) => `
          <div class="text-xs">
            <span class="text-slate-800">${row.lider || '—'}</span>
            ${row.canal ? `<span class="text-[10px] text-slate-500 block font-mono">Canal: ${row.canal}</span>` : ''}
          </div>
        `
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
        data: 'estatus',
        render: d => {
          const act = String(d || 'ACTIVO').toUpperCase() === 'ACTIVO';
          return `<span class="badge-tech ${act ? 'badge-active' : 'badge-inactive'}">${act ? 'ACTIVO' : 'INACTIVO'}</span>`;
        }
      },
      {
        data: null,
        className: 'text-right',
        orderable: false,
        render: (d, t, row) => `
          <button type="button" class="btn-edit-r btn-outline px-2.5 py-1 text-[11px] font-semibold" data-id="${row.idUnico}">
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
      zeroRecords: "No se encontraron pólizas reclasificadas",
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

function limpiarFiltros() {
  $('#filter-r-sucursal').val('');
  $('#filter-r-ejecutivo').val('');
  $('#filter-r-canal').val('');
  $('#filter-r-estatus').val('');
  if (dtReclasif) {
    dtReclasif.search('').columns().search('').draw();
  }
}

function abrirModalReclasif(reg = null) {
  editingRow = reg;
  $('#form-r-error').addClass('hidden');
  $('#r-closure-box').addClass('hidden');
  $('#r-maestro-match-info').addClass('hidden');

  const hoy = new Date().toISOString().slice(0, 10);

  if (reg) {
    $('#modal-r-title').text('Editar Reclasificación de Póliza');
    $('#form-r-modo').val('EDIT_ROW');
    $('#form-r-edit-id').val(reg.idUnico);

    $('#form-r-nropoliza').val(reg.codigo || reg.nroPoliza || '').prop('readonly', true).addClass('bg-slate-100');
    $('#form-r-nombreoriginal').val(reg.nombreOriginal || '').prop('readonly', false);
    $('#form-r-tomador').val(reg.nombreTomador || '');
    $('#form-r-asegurado').val(reg.nombreAsegurado || '');

    const nombreCorr = reg.correccionIntermediario || reg.nombreIntermediario || '';
    $('#form-r-correccion').val(nombreCorr);
    detectarEnlaceConMaestro();

    $('#form-r-sucursal').val(reg.sucursal || '');
    $('#form-r-ejecutivo').val(reg.ejecutivo || '');
    $('#form-r-lider').val(reg.lider || '');
    $('#form-r-canal').val(reg.canal || '');

    $('#form-r-fechainicio').val(formatearFechaInput(reg.fechaInicio) || hoy);
    $('#form-r-fechafin').val(formatearFechaInput(reg.fechaFin) || '');
    $('#form-r-estatus').val((reg.estatus || 'ACTIVO').toUpperCase());
  } else {
    $('#modal-r-title').text('Nueva Reclasificación de Póliza');
    $('#form-r-modo').val('NEW_OR_RECLASSIFY');
    $('#form-r-edit-id').val('');

    $('#reclasif-form')[0].reset();
    $('#form-r-nropoliza').prop('readonly', false).removeClass('bg-slate-100');
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
  const btnSubmit = $('#modal-r-btn-submit').prop('disabled', true).text('Guardando...');

  const nroPoliza = $('#form-r-nropoliza').val().trim().toUpperCase();
  const nombreOriginal = $('#form-r-nombreoriginal').val().trim();
  let correccion = $('#form-r-correccion').val().trim();
  const fechaInicio = $('#form-r-fechainicio').val();
  const fechaFin = $('#form-r-fechafin').val();
  const sucursal = $('#form-r-sucursal').val();
  const ejecutivo = $('#form-r-ejecutivo').val();
  const lider = $('#form-r-lider').val();
  const canal = $('#form-r-canal').val();
  const estatus = $('#form-r-estatus').val();

  // Limpiar corchetes del nombre si venían del autocompletado
  correccion = correccion.replace(/\s*\[.*?\]$/, '').trim();

  if (!nroPoliza) {
    errBox.text('Debe especificar el Número de Póliza.').removeClass('hidden');
    btnSubmit.prop('disabled', false).text('Guardar Reclasificación');
    return;
  }
  if (!correccion) {
    errBox.text('Debe indicar la Corrección de Intermediario.').removeClass('hidden');
    btnSubmit.prop('disabled', false).text('Guardar Reclasificación');
    return;
  }
  if (!fechaInicio) {
    errBox.text('Debe ingresar la Fecha de Inicio.').removeClass('hidden');
    btnSubmit.prop('disabled', false).text('Guardar Reclasificación');
    return;
  }
  if (fechaFin && fechaFin < fechaInicio) {
    errBox.text('La Fecha Fin no puede ser menor a la Fecha de Inicio.').removeClass('hidden');
    btnSubmit.prop('disabled', false).text('Guardar Reclasificación');
    return;
  }

  const payload = {
    idUnico: $('#form-r-edit-id').val() || null,
    modo: $('#form-r-modo').val(),
    nroPoliza: nroPoliza,
    nombreOriginal: nombreOriginal,
    nombreTomador: $('#form-r-tomador').val().trim(),
    nombreAsegurado: $('#form-r-asegurado').val().trim(),
    correccionIntermediario: correccion,
    codigoIntermediario: $('#form-r-codigo-int').val() || null,
    sucursal: sucursal,
    ejecutivo: ejecutivo,
    lider: lider,
    canal: canal,
    fechaInicio: fechaInicio,
    fechaFin: fechaFin || null,
    estatus: estatus
  };

  try {
    const res = await apiFetch('/api/reclasificaciones/guardar', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.exito) {
      showToast(res.mensaje || 'Reclasificación procesada correctamente.');
      cerrarModalReclasif();
      await cargarDatos();
    } else {
      errBox.text(res.mensaje || 'Error al guardar.').removeClass('hidden');
    }
  } catch (err) {
    errBox.text(err.message || 'Error de comunicación con el servidor.').removeClass('hidden');
  } finally {
    btnSubmit.prop('disabled', false).text('Guardar Reclasificación');
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
