import os
from pathlib import Path
from typing import Dict, Any, Optional
from fastapi import FastAPI, Depends, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from api.models import (
    LoginRequest, TokenResponse, UsuarioInfo,
    IntermediarioMaestroPayload, EstatusMaestroPayload,
    ReclasificacionPayload, EstatusReclasificacionPayload,
    ApiResponse
)
from api.auth import (
    verify_password, create_access_token,
    get_current_user, require_role
)
from api.services.sheets_client import sheets_service
from api.services.business_rules import BusinessRulesService

BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = BASE_DIR / "public"

app = FastAPI(
    title="Sistema de Control de Intermediarios y Reclasificaciones",
    version="2.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir archivos estáticos si la carpeta existe
css_path = PUBLIC_DIR / "css"
if css_path.exists():
    app.mount("/css", StaticFiles(directory=str(css_path)), name="css")

js_path = PUBLIC_DIR / "js"
if js_path.exists():
    app.mount("/js", StaticFiles(directory=str(js_path)), name="js")

def render_html_page(filename: str):
    file_path = PUBLIC_DIR / filename
    if file_path.exists():
        return HTMLResponse(content=file_path.read_text(encoding="utf-8"))
    raise HTTPException(status_code=404, detail=f"Página {filename} no encontrada")

# =============================================================================
# ENDPOINTS REST API (Soportan tanto /api/... como /...)
# =============================================================================
@app.get("/health")
@app.get("/api/health")
def healthcheck():
    return {
        "status": "healthy",
        "service": "Sistema de Control de Intermediarios y Reclasificaciones",
        "sheets_configured": sheets_service.is_configured()
    }

@app.post("/auth/login", response_model=TokenResponse)
@app.post("/api/auth/login", response_model=TokenResponse)
def login(request: LoginRequest):
    username_clean = request.username.strip().lower()
    password_clean = request.password.strip()

    if not username_clean or not password_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe ingresar usuario y contraseña."
        )

    users = sheets_service.get_users()
    matched_user = None

    for u in users:
        if u["username"] == username_clean and verify_password(password_clean, u["password"]):
            if u.get("activo", "SI").upper() == "NO":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="El usuario se encuentra desactivado. Contacte a su supervisor."
                )
            matched_user = u
            break

    if not matched_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas. Verifique usuario y contraseña."
        )

    user_info = UsuarioInfo(
        username=matched_user["username"],
        nombre=matched_user.get("nombre", matched_user["username"]),
        rol=matched_user.get("rol", "Operadora")
    )

    token = create_access_token(data={
        "sub": user_info.username,
        "nombre": user_info.nombre,
        "rol": user_info.rol
    })

    return TokenResponse(
        access_token=token,
        usuario=user_info
    )

@app.get("/auth/me", response_model=UsuarioInfo)
@app.get("/api/auth/me", response_model=UsuarioInfo)
def me(current_user: UsuarioInfo = Depends(get_current_user)):
    return current_user

@app.get("/data/sistema")
@app.get("/api/data/sistema")
def get_sistema_data(current_user: UsuarioInfo = Depends(get_current_user)):
    data = sheets_service.fetch_all_data()
    data["usuario_actual"] = current_user.model_dump()
    return data

@app.get("/intermediarios/buscar")
@app.get("/api/intermediarios/buscar")
def buscar_para_reclasificar(
    q: str = Query(..., min_length=1, description="Código o nombre de intermediario"),
    current_user: UsuarioInfo = Depends(get_current_user)
):
    resultado = BusinessRulesService.vincular_intermediario_con_reclasificacion(q)
    if not resultado:
        return {"encontrado": False, "mensaje": "Intermediario no localizado en el maestro."}
    return resultado

@app.post("/intermediarios/guardar")
@app.post("/api/intermediarios/guardar")
def guardar_intermediario(
    payload: IntermediarioMaestroPayload,
    current_user: UsuarioInfo = Depends(get_current_user)
):
    try:
        resultado = BusinessRulesService.guardar_intermediario_maestro(
            payload=payload,
            usuario=current_user.username,
            rol=current_user.rol
        )
        return resultado
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")

@app.post("/intermediarios/estatus")
@app.post("/api/intermediarios/estatus")
def cambiar_estatus_intermediario(
    payload: EstatusMaestroPayload,
    current_user: UsuarioInfo = Depends(require_role(["Supervisor"]))
):
    try:
        resultado = BusinessRulesService.cambiar_estatus_maestro(
            cod=payload.cod,
            id_reg=payload.id or "",
            nuevo_estatus=payload.nuevoEstatus,
            usuario=current_user.username,
            rol=current_user.rol
        )
        return resultado
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")

@app.post("/reclasificaciones/guardar")
@app.post("/api/reclasificaciones/guardar")
def guardar_reclasificacion(
    payload: ReclasificacionPayload,
    current_user: UsuarioInfo = Depends(get_current_user)
):
    try:
        resultado = BusinessRulesService.guardar_operacion_reclasificacion(
            payload=payload,
            usuario=current_user.username,
            rol=current_user.rol
        )
        return resultado
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")

# =============================================================================
# ENRUTADOR UNIVERSAL DE INTERFACES HTML
# =============================================================================
@app.get("/login", response_class=HTMLResponse)
@app.get("/login.html", response_class=HTMLResponse)
def get_login():
    return render_html_page("login.html")

@app.get("/intermediarios", response_class=HTMLResponse)
@app.get("/intermediarios.html", response_class=HTMLResponse)
def get_intermediarios():
    return render_html_page("intermediarios.html")

@app.get("/historico", response_class=HTMLResponse)
@app.get("/historico.html", response_class=HTMLResponse)
def get_historico():
    return render_html_page("historico.html")

@app.get("/reclasificaciones", response_class=HTMLResponse)
@app.get("/reclasificaciones.html", response_class=HTMLResponse)
def get_reclasificaciones():
    return render_html_page("reclasificaciones.html")

@app.get("/historico-reclasificaciones", response_class=HTMLResponse)
@app.get("/historico_reclasificaciones.html", response_class=HTMLResponse)
def get_historico_reclasif():
    return render_html_page("historico_reclasificaciones.html")

@app.get("/bitacora", response_class=HTMLResponse)
@app.get("/bitacora.html", response_class=HTMLResponse)
def get_bitacora():
    return render_html_page("bitacora.html")

@app.api_route("/{path_name:path}", methods=["GET"])
async def catch_all_views(request: Request, path_name: str):
    clean = path_name.lower().strip("/")

    if clean.startswith("css/") or clean.startswith("js/"):
        file_path = PUBLIC_DIR / clean
        if file_path.exists():
            media = "text/css" if clean.endswith(".css") else "application/javascript"
            return HTMLResponse(content=file_path.read_text(encoding="utf-8"), media_type=media)

    if "intermediarios" in clean and "historico" not in clean:
        return render_html_page("intermediarios.html")
    elif "historico-reclasificaciones" in clean or "historico_reclasificaciones" in clean:
        return render_html_page("historico_reclasificaciones.html")
    elif "historico" in clean:
        return render_html_page("historico.html")
    elif "reclasificaciones" in clean:
        return render_html_page("reclasificaciones.html")
    elif "bitacora" in clean:
        return render_html_page("bitacora.html")
    else:
        return render_html_page("login.html")
