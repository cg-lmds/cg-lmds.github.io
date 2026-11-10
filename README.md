# Sistema de Control de Intermediarios y Reclasificaciones v2.0

Sistema de alto rendimiento para el control, auditoría y reclasificación de cartera de intermediarios y pólizas.
Migrado a **Python (FastAPI)** + **JavaScript Modular** con despliegue continuo en **Vercel** mediante **GitHub**, respaldado por **Google Sheets API v4** vía **Service Account**.

---

## 🚀 Arquitectura del Sistema

```
GitHub Repo  ──(git push)──>  Vercel Edge CDN (HTML/CSS/JS)  < 30 ms
                                 │
                                 └──>  Python Serverless (/api/index.py)
                                          │
                                          └──>  Google Sheets (Service Account)
```

1. **Frontend Modular (`public/`)**:
   * `login.html`: Autenticación segura con JWT y control de roles.
   * `intermediarios.html`: Control Maestro de Intermediarios, validación de liberación de ejecutivos y altas.
   * `historico.html`: Auditoría histórica de reasignaciones por intermediario.
   * `reclasificaciones.html`: Módulo de reclasificación conectado en tiempo real con el maestro.
   * `bitacora.html`: Registro de auditoría cronológico inmutable (exclusivo Supervisor).

2. **Backend en Python (`api/`)**:
   * `index.py`: API REST con FastAPI.
   * `auth.py`: Tokens criptográficos JWT, control de acceso RBAC (`Supervisor` y `Operadora`).
   * `services/business_rules.py`: Cálculos de fechas, cierre histórico de vigencias (`restar_un_dia_iso`), validación de bloqueos y generación de IDs secuenciales.
   * `services/sheets_client.py`: Conexión de alta velocidad con Service Account y caché inteligente en memoria.

---

## 📋 Campos del Proceso de Reclasificación

El módulo de reclasificaciones utiliza exactamente la siguiente estructura interconectada:

| Campo | Descripción | Conexión con el Maestro |
| :--- | :--- | :--- |
| `Nro_Poliza` | Número de póliza objeto de reclasificación | Clave de búsqueda histórica |
| `Nombre_y_Apellido_Intermediario` | Nombre del intermediario original según póliza | Registro origen |
| `Nombre_del_Tomador` | Nombre del tomador de la póliza | Información de póliza |
| `Nombre_del_Asegurado` | Nombre del asegurado titular | Información de póliza |
| **`CORRECCIÓN INTERMEDIARIO`** | Intermediario corregido/asignado | **Enlace directo con Control de Intermediarios** |
| **`SUCURSAL_RECLASIF`** | Sucursal reclasificada | **Autocompletado desde el Maestro** |
| **`EJECUTIVO_RECLASIF`** | Ejecutivo reclasificado | **Autocompletado desde el Maestro** |
| **`LIDER_RECLASIF`** | Líder reclasificado | **Autocompletado desde el Maestro** |
| `CANAL_RECLASIF` | Canal de intermediación asignado | Catálogo de Canales |

### ⚡ Regla de Conexión Automática:
Al seleccionar o escribir la **`CORRECCIÓN INTERMEDIARIO`**, el sistema busca en memoria en el **Control de Intermediarios**, verifica que esté **ACTIVO**, y trae inmediatamente su **Ejecutivo**, **Sucursal** y **Líder** vigentes. Si esa póliza ya tenía una asignación activa previa, el sistema calcula de forma automática el cierre de la vigencia anterior (`Fecha Fin = Fecha Inicio nueva - 1 día`).

---

## 🔐 Configuración de Variables en Vercel

En el panel de tu proyecto en **Vercel** (`Settings -> Environment Variables`), agrega:

| Variable | Valor |
| :--- | :--- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Contenido completo del archivo `.json` de la cuenta de servicio de Google |
| `SPREADSHEET_ID` | ID de la hoja de Google Sheets (la cadena larga en la URL del Spreadsheet) |
| `JWT_SECRET_KEY` | Clave secreta aleatoria para firmar los tokens JWT |

> ⚠️ **Importante**: Nunca subas el archivo `service_account.json` a GitHub. Ya está protegido en el `.gitignore`.

---

## 💻 Ejecución Local (Opcional)

1. Instalar dependencias:
   ```bash
   pip install -r requirements.txt
   ```
2. Colocar `service_account.json` en la raíz (o definir la variable de entorno `GOOGLE_SERVICE_ACCOUNT_JSON`).
3. Iniciar el servidor local:
   ```bash
   python -m uvicorn api.index:app --reload --port 8000
   ```
4. Abrir en el navegador: `http://localhost:8000/login`

