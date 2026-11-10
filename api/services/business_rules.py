import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
from api.models import IntermediarioMaestroPayload, ReclasificacionPayload
from api.services.sheets_client import (
    sheets_service,
    SHEET_CONTROL_INTERMEDIARIOS,
    SHEET_HISTORICO_MAESTRO,
    SHEET_HISTORIAL,
    SHEET_HISTORIAL_RECLASIF,
    SHEET_BITACORA
)

def restar_un_dia_iso(fecha_iso: str) -> str:
    """Resta exactamente 1 día a una fecha en formato YYYY-MM-DD."""
    if not fecha_iso:
        return ""
    try:
        dt = datetime.strptime(fecha_iso[:10], "%Y-%m-%d")
        dt_ant = dt - timedelta(days=1)
        return dt_ant.strftime("%Y-%m-%d")
    except Exception:
        return fecha_iso

def formatear_fecha_iso(valor: Any) -> str:
    """Normaliza cualquier formato de fecha a YYYY-MM-DD."""
    if not valor:
        return ""
    s = str(valor).strip()
    if not s or s == "-":
        return ""
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if match:
        return match.group(1)
    try:
        # Intenta parsear fechas comunes
        for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    except Exception:
        pass
    return s[:10] if len(s) >= 10 else s

def obtener_timestamp_actual() -> Tuple[str, str]:
    """Retorna fecha (YYYY-MM-DD) y hora (HH:mm:ss) actual."""
    # Usando zona horaria estándar del sistema
    ahora = datetime.now()
    return ahora.strftime("%Y-%m-%d"), ahora.strftime("%H:%M:%S")

def generar_siguiente_id(existentes: List[str], prefijo: str = "") -> str:
    """Genera IDs secuenciales garantizando unicidad (ej. HIST-0042, CAM-0105)."""
    max_num = 0
    ids_set = set()
    for item in existentes:
        val = str(item or "").strip().upper()
        if val:
            ids_set.add(val)
            m = re.search(r"(\d+)$", val)
            if m:
                num = int(m.group(1))
                if num > max_num:
                    max_num = num
    sig = max_num + 1
    candidato = f"{prefijo}{str(sig).zfill(4)}" if prefijo else str(sig)
    while candidato in ids_set:
        sig += 1
        candidato = f"{prefijo}{str(sig).zfill(4)}" if prefijo else str(sig)
    return candidato

def sanitizar_celda(valor: Any) -> str:
    if valor is None:
        return ""
    s = str(valor).strip()
    # Previene inyección de fórmulas en Google Sheets (=, +, -, @)
    if s and s[0] in ("=", "+", "-", "@"):
        return f"'{s}"
    return s

class BusinessRulesService:

    @staticmethod
    def vincular_intermediario_con_reclasificacion(termino: str) -> Optional[Dict[str, Any]]:
        """
        Conecta en tiempo real la selección de un intermediario corregido
        con su configuración activa en el Control de Intermediarios (Maestro).
        Retorna la sucursal, ejecutivo y líder vigentes.
        """
        data = sheets_service.fetch_all_data()
        maestro = data.get("maestro", [])
        term = termino.strip().upper()

        for item in maestro:
            cod = str(item.get("cod", "")).strip().upper()
            nombre = str(item.get("intermediario", "")).strip().upper()
            ced = str(item.get("cedula", "")).strip().upper()
            if term == cod or term == nombre or (term and term in nombre):
                return {
                    "encontrado": True,
                    "cod": item.get("cod"),
                    "intermediario": item.get("intermediario"),
                    "ejecutivo": item.get("ejecutivo"),
                    "sucursal": item.get("sucursal"),
                    "lider": item.get("lider"),
                    "activo": item.get("activo", "SI")
                }
        return None

    @staticmethod
    def guardar_intermediario_maestro(payload: IntermediarioMaestroPayload, usuario: str, rol: str) -> Dict[str, Any]:
        """
        Procesa el alta o edición en Control de Intermediarios con control de ejecutivos,
        liberación mediante Fecha Fin y archivado histórico automático.
        """
        sh_m = sheets_service.get_sheet(SHEET_CONTROL_INTERMEDIARIOS)
        sh_hm = sheets_service.get_sheet(SHEET_HISTORICO_MAESTRO)
        sh_bit = sheets_service.get_sheet(SHEET_BITACORA)

        cod_limpio = sanitizar_celda(payload.cod.strip().upper())
        nombre_limpio = sanitizar_celda(payload.intermediario.strip())
        ejecutivo_nuevo = sanitizar_celda(payload.ejecutivo or "")
        fecha_inicio = formatear_fecha_iso(payload.fechaInicio)
        fecha_fin = formatear_fecha_iso(payload.fechaFin)
        sucursal = sanitizar_celda(payload.sucursal or "")
        lider = sanitizar_celda(payload.lider or "")
        activo = "NO" if str(payload.activo or "SI").strip().upper() == "NO" else "SI"
        cedula = sanitizar_celda(payload.cedula or "")
        correo = sanitizar_celda(payload.correo or "")
        fecha_nac = formatear_fecha_iso(payload.fechaNac)
        fecha_afil = formatear_fecha_iso(payload.fechaAfiliacion)

        if not cod_limpio or not nombre_limpio:
            raise ValueError("El nombre del Intermediario y el Código son obligatorios.")

        if fecha_fin and fecha_inicio and fecha_fin < fecha_inicio:
            raise ValueError("La Fecha Fin no puede ser anterior a la Fecha de Inicio.")

        data_actual = sheets_service.fetch_all_data(force_refresh=True)
        maestro_list = data_actual.get("maestro", [])

        # Buscar si ya existe por ID o por Código
        fila_anterior = None
        for item in maestro_list:
            if (payload.id and item.get("id") == payload.id) or item.get("cod", "").upper() == cod_limpio:
                fila_anterior = item
                break

        fecha_hoy, hora_exacta = obtener_timestamp_actual()
        tipo_op = "ALTA CONTROL DE INTERMEDIARIOS"
        detalle_bit = "Nuevo registro en Control de intermediarios."
        id_final = payload.id

        if fila_anterior:
            id_final = fila_anterior.get("id") or cod_limpio
            ejecutivo_ant = fila_anterior.get("ejecutivo", "").strip()
            fecha_fin_ant = fila_anterior.get("fechaFin", "").strip() or restar_un_dia_iso(fecha_inicio)

            # SNAPSHOT-BEFORE-UPDATE: Siempre respaldar en historico_control_de_intermediarios antes de sobreescribir
            if sh_hm:
                todos_hm = sh_hm.get_all_values()
                existentes_ids = [r[0] for r in todos_hm[1:] if r]
                nuevo_id_hm = generar_siguiente_id(existentes_ids, "HCI-")
                fila_archivar = [
                    nuevo_id_hm,
                    fila_anterior.get("id"),
                    fila_anterior.get("intermediario"),
                    fila_anterior.get("cod"),
                    fila_anterior.get("ejecutivo"),
                    fila_anterior.get("fechaInicio"),
                    fecha_fin_ant,
                    fila_anterior.get("sucursal"),
                    fila_anterior.get("lider"),
                    fila_anterior.get("activo"),
                    fila_anterior.get("cedula"),
                    fila_anterior.get("correo"),
                    fila_anterior.get("fechaNac"),
                    fila_anterior.get("fechaAfiliacion")
                ]
                sh_hm.append_row(fila_archivar)

            tipo_op = "ACTUALIZACIÓN MAESTRO (BACKUP PREVIO GENERADO)"
            detalle_bit = f"Snapshot archivado en histórico. Se actualizó {nombre_limpio} ({cod_limpio}) con ejecutivo {ejecutivo_nuevo}."

            # Actualizar IN-PLACE en la hoja Maestro (nunca duplica el intermediario)
            if sh_m:
                todas_filas = sh_m.get_all_values()
                fila_num = -1
                for idx, r in enumerate(todas_filas[1:], start=2):
                    if len(r) >= 3 and (r[0] == id_final or r[2].upper() == cod_limpio):
                        fila_num = idx
                        break
                
                fila_valores = [
                    id_final, nombre_limpio, cod_limpio, ejecutivo_nuevo,
                    fecha_inicio, fecha_fin, sucursal, lider, activo,
                    cedula, correo, fecha_nac, fecha_afil
                ]
                if fila_num != -1:
                    sh_m.update(f"A{fila_num}:M{fila_num}", [fila_valores])
                else:
                    sh_m.append_row(fila_valores)
        else:
            # Alta nueva: Solo cuando el intermediario no existe en el maestro
            tipo_op = "ALTA NUEVA CONTROL DE INTERMEDIARIOS"
            detalle_bit = f"Nuevo intermediario creado en maestro: {nombre_limpio} ({cod_limpio})."
            ids_m = [item.get("id") for item in maestro_list]
            id_final = generar_siguiente_id(ids_m, "")
            fila_valores = [
                id_final, nombre_limpio, cod_limpio, ejecutivo_nuevo,
                fecha_inicio, fecha_fin, sucursal, lider, activo,
                cedula, correo, fecha_nac, fecha_afil
            ]
            if sh_m:
                sh_m.append_row(fila_valores)

        # Registro en Bitácora
        if sh_bit:
            rows_bit = sh_bit.get_all_values()
            ids_b = [r[0] for r in rows_bit[1:] if r]
            id_bit = generar_siguiente_id(ids_b, "CAM-")
            ant_texto = f"Ejecutivo: {fila_anterior.get('ejecutivo')} | Fin: {fila_anterior.get('fechaFin') or 'Vigente'}" if fila_anterior else "Sin registro previo"
            nue_texto = f"Ejecutivo: {ejecutivo_nuevo} | Fin: {fecha_fin or 'Vigente'} | Activo: {activo}"
            sh_bit.append_row([
                id_bit, fecha_hoy, hora_exacta, usuario, rol, tipo_op,
                cod_limpio, nombre_limpio, ant_texto, nue_texto, detalle_bit
            ])

        sheets_service.invalidate_cache()
        datos_actualizados = sheets_service.fetch_all_data(force_refresh=True)
        return {
            "exito": True,
            "mensaje": "Intermediario guardado correctamente.",
            "datos": datos_actualizados
        }

    @staticmethod
    def guardar_operacion_reclasificacion(payload: ReclasificacionPayload, usuario: str, rol: str) -> Dict[str, Any]:
        """
        Guarda o edita una reclasificación con los NUEVOS campos requeridos:
        Nro_Poliza, Nombre_y_Apellido_Intermediario, Nombre_del_Tomador, Nombre_del_Asegurado,
        CORRECCIÓN INTERMEDIARIO, SUCURSAL_RECLASIF, EJECUTIVO_RECLASIF, LIDER_RECLASIF, CANAL_RECLASIF
        y realiza el cierre efectivo de vigencias previas sobre la misma póliza/código.
        """
        sh_hist = sheets_service.get_sheet(SHEET_HISTORIAL)
        sh_bit = sheets_service.get_sheet(SHEET_BITACORA)

        nro_poliza = sanitizar_celda(payload.nroPoliza.strip().upper())
        nombre_original = sanitizar_celda(payload.nombreIntermediarioOriginal.strip())
        nombre_tomador = sanitizar_celda(payload.nombreTomador or "")
        nombre_asegurado = sanitizar_celda(payload.nombreAsegurado or "")
        correccion_intermediario = sanitizar_celda(payload.correccionIntermediario.strip())
        codigo_int = sanitizar_celda(payload.codigoIntermediario or "")
        sucursal = sanitizar_celda(payload.sucursalReclasif.strip())
        ejecutivo = sanitizar_celda(payload.ejecutivoReclasif.strip())
        lider = sanitizar_celda(payload.liderReclasif or "")
        canal = sanitizar_celda(payload.canalReclasif or "")
        fecha_inicio_nueva = formatear_fecha_iso(payload.fechaInicio) or obtener_timestamp_actual()[0]
        fecha_fin_nueva = formatear_fecha_iso(payload.fechaFin)
        estatus_codigo = "INACTIVO" if str(payload.estatus or "ACTIVO").strip().upper() == "INACTIVO" else "ACTIVO"

        if not nro_poliza or not nombre_original or not correccion_intermediario or not sucursal or not ejecutivo:
            raise ValueError("Complete los campos obligatorios: Nro de Póliza, Intermediario Original, Corrección, Sucursal y Ejecutivo.")

        if fecha_fin_nueva and fecha_fin_nueva < fecha_inicio_nueva:
            raise ValueError("La Fecha Fin no puede ser anterior a la Fecha de Inicio.")

        fecha_hoy, hora_exacta = obtener_timestamp_actual()
        marca_tiempo = f"{fecha_hoy} {hora_exacta}"
        data_actual = sheets_service.fetch_all_data(force_refresh=True)
        historial_list = data_actual.get("historial", [])

        # Buscar si la póliza ya existe en la hoja de Reclasificaciones
        fila_existente_idx = -1
        reg_existente_previo = None
        if sh_hist:
            filas_h = sh_hist.get_all_values()
            for idx, r in enumerate(filas_h[1:], start=2):
                if not r:
                    continue
                cod_o_pol = str(r[1] or "").strip().upper()
                extra_json = str(r[14] or "") if len(r) > 14 else ""
                id_fila = str(r[0] or "").strip()
                if (payload.editId and id_fila == payload.editId) or cod_o_pol == nro_poliza or nro_poliza in extra_json:
                    fila_existente_idx = idx
                    reg_existente_previo = r
                    break

        sh_hr = sheets_service.get_sheet(SHEET_HISTORIAL_RECLASIF)

        if fila_existente_idx != -1 and reg_existente_previo:
            # 1. SNAPSHOT-BEFORE-UPDATE: Guardar el estado previo en historico_control_reclasificaciones
            id_poliza = reg_existente_previo[0] or nro_poliza
            cierre_efectivo = payload.fechaCierreAnterior or restar_un_dia_iso(fecha_inicio_nueva)

            if sh_hr:
                rows_hr = sh_hr.get_all_values()
                id_hr = generar_siguiente_id([r[0] for r in rows_hr[1:] if r], "HR-")
                snapshot_row = [
                    id_hr,
                    reg_existente_previo[1] if len(reg_existente_previo) > 1 else nro_poliza,
                    reg_existente_previo[2] if len(reg_existente_previo) > 2 else nombre_original,
                    reg_existente_previo[3] if len(reg_existente_previo) > 3 else nombre_tomador,
                    reg_existente_previo[4] if len(reg_existente_previo) > 4 else nombre_asegurado,
                    reg_existente_previo[5] if len(reg_existente_previo) > 5 else sucursal,
                    reg_existente_previo[6] if len(reg_existente_previo) > 6 else ejecutivo,
                    reg_existente_previo[7] if len(reg_existente_previo) > 7 else lider,
                    reg_existente_previo[8] if len(reg_existente_previo) > 8 else canal,
                    reg_existente_previo[9] if len(reg_existente_previo) > 9 else fecha_inicio_nueva,
                    cierre_efectivo,
                    reg_existente_previo[11] if len(reg_existente_previo) > 11 else "ACTIVO",
                    f"{usuario} ({rol})",
                    marca_tiempo,
                    reg_existente_previo[14] if len(reg_existente_previo) > 14 else ""
                ]
                sh_hr.append_row(snapshot_row)

            # 2. ACTUALIZACIÓN IN-PLACE en control_reclasificaciones (1 sola fila por póliza)
            fila_actualizada = [
                id_poliza,
                codigo_int or nro_poliza,
                correccion_intermediario,
                nombre_tomador,
                nombre_asegurado,
                sucursal,
                ejecutivo,
                lider,
                canal,
                fecha_inicio_nueva,
                fecha_fin_nueva,
                estatus_codigo,
                f"{usuario} ({rol})",
                marca_tiempo,
                f'{{"nroPoliza":"{nro_poliza}","nombreOriginal":"{nombre_original}"}}'
            ]
            sh_hist.update(f"A{fila_existente_idx}:O{fila_existente_idx}", [fila_actualizada])

            tipo_op = "RECLASIFICACIÓN PÓLIZA (BACKUP HISTÓRICO GENERADO)"
            ant_info = f"{reg_existente_previo[2]} | {reg_existente_previo[6]}" if len(reg_existente_previo) > 6 else "Previa"
            detalle_bit = f"Snapshot de póliza {nro_poliza} archivado en histórico. Asignada a {correccion_intermediario} ({ejecutivo})."

            if sh_bit:
                rows_b = sh_bit.get_all_values()
                id_bit = generar_siguiente_id([r[0] for r in rows_b[1:] if r], "CAM-")
                sh_bit.append_row([
                    id_bit, fecha_hoy, hora_exacta, usuario, rol,
                    tipo_op, nro_poliza, correccion_intermediario,
                    ant_info, f"{correccion_intermediario} | {ejecutivo}", detalle_bit
                ])

        else:
            # Alta nueva de póliza que nunca antes había sido reclasificada
            ids_existentes = [item.get("idUnico") for item in historial_list]
            nuevo_id_hist = generar_siguiente_id(ids_existentes, "HIST-")
            campos_extra = f'{{"nroPoliza":"{nro_poliza}","nombreOriginal":"{nombre_original}"}}'

            nueva_fila = [
                nuevo_id_hist,
                codigo_int or nro_poliza,
                correccion_intermediario,
                nombre_tomador,
                nombre_asegurado,
                sucursal,
                ejecutivo,
                lider,
                canal,
                fecha_inicio_nueva,
                fecha_fin_nueva,
                estatus_codigo,
                f"{usuario} ({rol})",
                marca_tiempo,
                campos_extra
            ]

            if sh_hist:
                sh_hist.append_row(nueva_fila)

            tipo_op = "ALTA RECLASIFICACIÓN DE PÓLIZA"
            detalle_bit = f"Nueva póliza {nro_poliza} registrada con intermediario {correccion_intermediario}."

            if sh_bit:
                rows_b = sh_bit.get_all_values()
                id_bit = generar_siguiente_id([r[0] for r in rows_b[1:] if r], "CAM-")
                sh_bit.append_row([
                    id_bit, fecha_hoy, hora_exacta, usuario, rol,
                    tipo_op, nro_poliza, correccion_intermediario,
                    "Sin registro previo", f"{correccion_intermediario} | {ejecutivo}", detalle_bit
                ])

        sheets_service.invalidate_cache()
        datos_actualizados = sheets_service.fetch_all_data(force_refresh=True)
        return {
            "exito": True,
            "mensaje": f"Reclasificación para póliza {nro_poliza} guardada con éxito.",
            "datos": datos_actualizados
        }

    @staticmethod
    def cambiar_estatus_maestro(cod: str, id_reg: str, nuevo_estatus: str, usuario: str, rol: str) -> Dict[str, Any]:
        sh_m = sheets_service.get_sheet(SHEET_CONTROL_INTERMEDIARIOS)
        sh_bit = sheets_service.get_sheet(SHEET_BITACORA)

        cod_norm = cod.strip().upper()
        estatus_norm = "NO" if nuevo_estatus.strip().upper() == "NO" else "SI"

        if sh_m:
            filas = sh_m.get_all_values()
            fila_mod = -1
            nombre_int = cod_norm
            estatus_ant = "SI"
            for idx, r in enumerate(filas[1:], start=2):
                if (id_reg and r[0] == id_reg) or (len(r) >= 3 and r[2].upper() == cod_norm):
                    fila_mod = idx
                    nombre_int = r[1]
                    estatus_ant = r[8] if len(r) > 8 else "SI"
                    sh_m.update_cell(fila_mod, 9, estatus_norm)
                    break

            if fila_mod == -1:
                raise ValueError("No se encontró el intermediario especificado.")

            if sh_bit:
                f_hoy, h_exacta = obtener_timestamp_actual()
                rows_b = sh_bit.get_all_values()
                id_bit = generar_siguiente_id([r[0] for r in rows_b[1:] if r], "CAM-")
                sh_bit.append_row([
                    id_bit, f_hoy, h_exacta, usuario, rol,
                    "CAMBIO ACTIVO (CONTROL INTERMEDIARIOS)",
                    cod_norm, nombre_int, f"Activo: {estatus_ant}", f"Activo: {estatus_norm}",
                    f"Estatus cambiado a {estatus_norm} por {usuario}."
                ])

        sheets_service.invalidate_cache()
        datos_actualizados = sheets_service.fetch_all_data(force_refresh=True)
        return {
            "exito": True,
            "mensaje": f"Condición de {cod_norm} actualizada a {estatus_norm}.",
            "datos": datos_actualizados
        }

