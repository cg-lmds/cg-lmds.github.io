import os
import json
import base64
import time
import urllib.request
import email.utils
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import google.auth._helpers
import gspread
from google.oauth2.service_account import Credentials

def sincronizar_reloj_con_google():
    """
    Sincroniza la hora del cliente con los servidores de Google para evitar
    el error de 'invalid_grant: Invalid JWT timeframe' si el reloj del sistema tiene desfase.
    """
    try:
        req = urllib.request.urlopen('https://www.google.com', timeout=3)
        date_str = req.headers.get('Date')
        if date_str:
            server_time = email.utils.parsedate_to_datetime(date_str)
            local_time = datetime.now(timezone.utc)
            offset_seconds = (local_time - server_time).total_seconds()
            if abs(offset_seconds) > 10:
                _orig_utcnow = google.auth._helpers.utcnow
                def synced_utcnow():
                    return _orig_utcnow() - timedelta(seconds=offset_seconds)
                google.auth._helpers.utcnow = synced_utcnow
                print(f"[SheetsService] Reloj ajustado con Google (Offset: {offset_seconds:.1f}s)")
    except Exception as e:
        print(f"[SheetsService] Advertencia sincronizando reloj: {e}")

sincronizar_reloj_con_google()

SHEET_USUARIOS = 'Usuarios'
SHEET_CONTROL = 'Control'
SHEET_HISTORIAL = 'control_reclasificaciones'
SHEET_HISTORIAL_RECLASIF = 'historico_control_reclasificaciones'
SHEET_BITACORA = 'bitacora_de_cambios'
SHEET_CONTROL_INTERMEDIARIOS = 'control_de_intermediarios'
SHEET_HISTORICO_MAESTRO = 'historico_control_de_intermediarios'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

class SheetsService:
    def __init__(self):
        self.spreadsheet_id = os.getenv("SPREADSHEET_ID", "1RUNOok5IBaIpGZlmoNWnoir4yTbjxL7M7aIaSBq728Q")
        self.client: Optional[gspread.Client] = None
        self.spreadsheet: Optional[gspread.Spreadsheet] = None
        self._cache_data: Optional[Dict[str, Any]] = None
        self._cache_timestamp: float = 0
        self._cache_ttl_seconds: int = int(os.getenv("CACHE_TTL_SECONDS", "30"))
        self._init_client()

    def _init_client(self):
        # 1. Intentar leer desde variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON
        sa_env = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
        creds = None
        
        if sa_env:
            try:
                # Soporta tanto JSON directo como base64
                if sa_env.strip().startswith("{"):
                    sa_info = json.loads(sa_env)
                else:
                    decoded = base64.b64decode(sa_env).decode("utf-8")
                    sa_info = json.loads(decoded)
                creds = Credentials.from_service_account_info(sa_info, scopes=SCOPES)
            except Exception as e:
                print(f"[SheetsService] Error decodificando GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

        # 2. Si no hay variable de entorno, buscar archivos locales
        if not creds:
            for filename in ["service_account.json", "credentials.json", "service-account.json"]:
                if os.path.exists(filename):
                    try:
                        creds = Credentials.from_service_account_file(filename, scopes=SCOPES)
                        break
                    except Exception as e:
                        print(f"[SheetsService] Error leyendo {filename}: {e}")

        if creds:
            try:
                self.client = gspread.authorize(creds)
                if self.spreadsheet_id:
                    self.spreadsheet = self.client.open_by_key(self.spreadsheet_id)
                else:
                    # Intento abrir por nombre si no se especificó ID
                    try:
                        self.spreadsheet = self.client.open("Control de intermediarios y reclasificaciones")
                    except Exception:
                        pass
            except Exception as e:
                print(f"[SheetsService] Error autorizando cliente gspread: {e}")

    def is_configured(self) -> bool:
        return self.client is not None and self.spreadsheet is not None

    def invalidate_cache(self):
        self._cache_data = None
        self._cache_timestamp = 0

    def get_sheet(self, sheet_name: str) -> Optional[gspread.Worksheet]:
        if not self.is_configured():
            return None
        try:
            return self.spreadsheet.worksheet(sheet_name)
        except gspread.WorksheetNotFound:
            return None

    def fetch_all_data(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Obtiene todos los registros en bloque. Utiliza memoria caché para responder
        en < 15ms a peticiones consecutivas, invalidando automáticamente tras escrituras.
        """
        now = time.time()
        if not force_refresh and self._cache_data and (now - self._cache_timestamp < self._cache_ttl_seconds):
            return self._cache_data

        if not self.is_configured():
            # Si no hay credenciales configuradas, devuelve estructura básica inicial
            mock_data = self._get_fallback_mock_data()
            self._cache_data = mock_data
            self._cache_timestamp = now
            return mock_data

        try:
            # 1. Catálogos de Control
            catalogos = {'Sucursales': [], 'Ejecutivos': [], 'Líderes': [], 'Canales': []}
            sh_ctrl = self.get_sheet(SHEET_CONTROL)
            if sh_ctrl:
                ctrl_rows = sh_ctrl.get_all_values()
                if len(ctrl_rows) > 1:
                    headers = [str(h or '').strip() for h in ctrl_rows[0]]
                    for c, h in enumerate(headers):
                        if h in catalogos:
                            seen = set()
                            for r in range(1, len(ctrl_rows)):
                                if c < len(ctrl_rows[r]):
                                    val = str(ctrl_rows[r][c] or '').strip()
                                    if val and val not in seen:
                                        seen.add(val)
                                        catalogos[h].append(val)

            # 2. Control de Intermediarios (Maestro - 1086 filas)
            maestro = []
            sh_maestro = self.get_sheet(SHEET_CONTROL_INTERMEDIARIOS)
            ejecutivos_set = set(catalogos['Ejecutivos'])
            sucursales_set = set(catalogos['Sucursales'])
            lideres_set = set(catalogos['Líderes'])

            if sh_maestro:
                rows_m = sh_maestro.get_all_values()
                for r in rows_m[1:]:
                    if len(r) >= 3 and (r[0] or r[1] or r[2]):
                        def get_col(idx, default=''):
                            return str(r[idx]).strip() if idx < len(r) else default

                        ej = get_col(3)
                        suc = get_col(6)
                        lid = get_col(7)
                        if ej and ej not in ejecutivos_set:
                            ejecutivos_set.add(ej)
                            catalogos['Ejecutivos'].append(ej)
                        if suc and suc not in sucursales_set:
                            sucursales_set.add(suc)
                            catalogos['Sucursales'].append(suc)
                        if lid and lid not in lideres_set:
                            lideres_set.add(lid)
                            catalogos['Líderes'].append(lid)

                        maestro.append({
                            'id': get_col(0),
                            'intermediario': get_col(1),
                            'cod': get_col(2),
                            'ejecutivo': ej,
                            'fechaInicio': get_col(4)[:10] if len(get_col(4)) >= 10 else get_col(4),
                            'fechaFin': get_col(5)[:10] if len(get_col(5)) >= 10 else get_col(5),
                            'sucursal': suc,
                            'lider': lid,
                            'activo': 'NO' if get_col(8).upper() == 'NO' else 'SI',
                            'cedula': get_col(9),
                            'correo': get_col(10),
                            'fechaNac': get_col(11)[:10] if len(get_col(11)) >= 10 else get_col(11),
                            'fechaAfiliacion': get_col(12)[:10] if len(get_col(12)) >= 10 else get_col(12)
                        })

            # 3. Histórico de Control de Intermediarios
            historico_maestro = []
            sh_hm = self.get_sheet(SHEET_HISTORICO_MAESTRO)
            if sh_hm:
                rows_hm = sh_hm.get_all_values()
                if len(rows_hm) > 1:
                    first_header = str(rows_hm[0][0] or '').upper() if rows_hm[0] else ''
                    sheet_has_14 = 'HIST' in first_header
                    for r in reversed(rows_hm[1:]):
                        if not r or not any(r[:3]):
                            continue
                        row_prefix = str(r[0] or '').strip().upper().startswith(('HCI-', 'HM-')) or (sheet_has_14 and len(r) >= 14)
                        o = 1 if row_prefix else 0

                        def get_hm(idx, default=''):
                            pos = o + idx
                            return str(r[pos]).strip() if pos < len(r) else default

                        historico_maestro.append({
                            'idHistorico': str(r[0] or '').strip() if row_prefix else '',
                            'id': str(r[o] or '').strip() if o < len(r) else '',
                            'intermediario': get_hm(1),
                            'cod': get_hm(2),
                            'ejecutivo': get_hm(3),
                            'fechaInicio': get_hm(4)[:10] if len(get_hm(4)) >= 10 else get_hm(4),
                            'fechaFin': get_hm(5)[:10] if len(get_hm(5)) >= 10 else get_hm(5),
                            'sucursal': get_hm(6),
                            'lider': get_hm(7),
                            'activo': 'NO' if get_hm(8).upper() == 'NO' else 'SI',
                            'cedula': get_hm(9),
                            'correo': get_hm(10),
                            'fechaNac': get_hm(11)[:10] if len(get_hm(11)) >= 10 else get_hm(11),
                            'fechaAfiliacion': get_hm(12)[:10] if len(get_hm(12)) >= 10 else get_hm(12)
                        })

            # 4. Control de Reclasificaciones (Alineación exacta con las 12 columnas reales)
            # Para garantizar alta velocidad (< 0.5s) en hojas masivas (+120,000 filas),
            # leemos el bloque más reciente para la vista en pantalla.
            historial = []
            sh_hist = self.get_sheet(SHEET_HISTORIAL)
            if sh_hist:
                total_r = sh_hist.row_count
                start_r = max(2, total_r - 350)
                rows_h = sh_hist.get_values(f"A{start_r}:L{total_r}")
                for r in reversed(rows_h):
                    if r and any(r):
                        def get_h(idx, default=''):
                            return str(r[idx]).strip() if idx < len(r) else default

                        poliza = get_h(0)
                        if not poliza:
                            continue

                        historial.append({
                            'idUnico': poliza,
                            'codigo': poliza,
                            'nroPoliza': poliza,
                            'nombreOriginal': get_h(1),
                            'nombreIntermediarioOriginal': get_h(1),
                            'nombreTomador': get_h(2),
                            'nombreAsegurado': get_h(3),
                            'correccionIntermediario': get_h(4),
                            'nombreIntermediario': get_h(4) or get_h(1),
                            'sucursal': get_h(5),
                            'sucursalReclasif': get_h(5),
                            'ejecutivo': get_h(6),
                            'ejecutivoReclasif': get_h(6),
                            'lider': get_h(7),
                            'liderReclasif': get_h(7),
                            'canal': get_h(8),
                            'canalReclasif': get_h(8),
                            'fechaInicio': get_h(9)[:10] if len(get_h(9)) >= 10 else get_h(9),
                            'fechaFin': get_h(10)[:10] if len(get_h(10)) >= 10 else get_h(10),
                            'estatus': 'INACTIVO' if get_h(11).upper() == 'INACTIVO' else 'ACTIVO',
                            'registradoPor': 'Operación',
                            'fechaHoraOperacion': ''
                        })

            # 4.1 Histórico de Control de Reclasificaciones (Snapshots previos)
            historico_reclasif = []
            sh_hr = self.get_sheet(SHEET_HISTORIAL_RECLASIF)
            if sh_hr:
                total_hr = sh_hr.row_count
                start_hr = max(2, total_hr - 200)
                rows_hr = sh_hr.get_values(f"A{start_hr}:L{total_hr}")
                for r in reversed(rows_hr):
                    if r and any(r):
                        def get_hr(idx, default=''):
                            return str(r[idx]).strip() if idx < len(r) else default
                        pol_hr = get_hr(0)
                        if pol_hr:
                            historico_reclasif.append({
                                'idHistorico': pol_hr,
                                'codigo': get_hr(1) or pol_hr,
                                'nroPoliza': get_hr(1) or pol_hr,
                                'nombreOriginal': get_hr(2),
                                'nombreIntermediario': get_hr(4) or get_hr(2),
                                'nombreTomador': get_hr(2),
                                'nombreAsegurado': get_hr(3),
                                'sucursal': get_hr(5),
                                'ejecutivo': get_hr(6),
                                'lider': get_hr(7),
                                'canal': get_hr(8),
                                'fechaInicio': get_hr(9)[:10] if len(get_hr(9)) >= 10 else get_hr(9),
                                'fechaFin': get_hr(10)[:10] if len(get_hr(10)) >= 10 else get_hr(10),
                                'estatus': get_hr(11) or 'INACTIVO',
                                'registradoPor': 'Snapshot Histórico',
                                'fechaHoraOperacion': ''
                            })

            # 5. Bitácora de Cambios
            bitacora = []
            sh_bit = self.get_sheet(SHEET_BITACORA)
            if sh_bit:
                rows_b = sh_bit.get_all_values()
                for b in reversed(rows_b[1:]):
                    if b and any(b):
                        def get_b(idx, default=''):
                            return str(b[idx]).strip() if idx < len(b) else default
                        bitacora.append({
                            'idMovimiento': get_b(0),
                            'fecha': get_b(1),
                            'hora': get_b(2),
                            'usuario': get_b(3),
                            'rol': get_b(4),
                            'tipoOperacion': get_b(5),
                            'codigoIntermediario': get_b(6),
                            'nombreIntermediario': get_b(7),
                            'datoAnterior': get_b(8),
                            'datoNuevo': get_b(9),
                            'detalle': get_b(10)
                        })

            result = {
                'exito': True,
                'maestro': maestro,
                'historicoMaestro': historico_maestro,
                'historial': historial,
                'historicoReclasificaciones': historico_reclasif,
                'bitacora': bitacora,
                'sucursales': catalogos['Sucursales'],
                'ejecutivos': catalogos['Ejecutivos'],
                'lideres': catalogos['Líderes'],
                'canales': catalogos['Canales']
            }
            self._cache_data = result
            self._cache_timestamp = now
            return result

        except Exception as e:
            print(f"[SheetsService] Error en fetch_all_data: {e}")
            return self._get_fallback_mock_data()

    def get_users(self) -> List[Dict[str, str]]:
        if not self.is_configured():
            return [
                {"username": "supervisor", "password": "Supervisor2026", "nombre": "Supervisor General", "rol": "Supervisor", "activo": "SI"},
                {"username": "operadora", "password": "Operadora2026", "nombre": "Operadora Comercial", "rol": "Operadora", "activo": "SI"}
            ]
        sh = self.get_sheet(SHEET_USUARIOS)
        if not sh:
            return []
        rows = sh.get_all_values()
        users = []
        for r in rows[1:]:
            if len(r) >= 2 and r[0] and r[1]:
                users.append({
                    "username": str(r[0]).strip().lower(),
                    "password": str(r[1]).strip(),
                    "nombre": str(r[2]).strip() if len(r) > 2 and r[2] else str(r[0]).strip(),
                    "rol": str(r[3]).strip() if len(r) > 3 and r[3] else "Operadora",
                    "activo": str(r[4]).strip().upper() if len(r) > 4 else "SI"
                })
        return users

    def _get_fallback_mock_data(self) -> Dict[str, Any]:
        """Datos seguros predeterminados para desarrollo local y primer arranque."""
        return {
            'exito': True,
            'maestro': [],
            'historicoMaestro': [],
            'historial': [],
            'historicoReclasificaciones': [],
            'bitacora': [],
            'sucursales': ["Caracas", "Valencia", "Maracaibo", "Barquisimeto"],
            'ejecutivos': ["Carlos Gomez", "Maria Rodriguez", "Juan Perez", "Ana Morales"],
            'lideres': ["Gerencia Comercial", "Liderazgo Central", "Supervision Occidente"],
            'canales': ["Directo", "Corredor", "Bancaseguros", "Digital"]
        }

sheets_service = SheetsService()
