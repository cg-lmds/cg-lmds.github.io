from fastapi import FastAPI, Depends, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional

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

app = FastAPI(
    title="Sistema de Control de Intermediarios y Reclasificaciones",
    version="2.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

# Permitir CORS para despliegue en Vercel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def healthcheck():
    return {
        "status": "healthy",
        "service": "Sistema de Control de Intermediarios y Reclasificaciones",
        "sheets_configured": sheets_service.is_configured()
    }

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

@app.get("/api/auth/me", response_model=UsuarioInfo)
def me(current_user: UsuarioInfo = Depends(get_current_user)):
    return current_user

@app.get("/api/data/sistema")
def get_sistema_data(current_user: UsuarioInfo = Depends(get_current_user)):
    """Obtiene los datos del sistema con respuesta instantánea vía memoria caché."""
    data = sheets_service.fetch_all_data()
    data["usuario_actual"] = current_user.model_dump()
    return data

@app.get("/api/intermediarios/buscar")
def buscar_para_reclasificar(
    q: str = Query(..., min_length=1, description="Código o nombre de intermediario"),
    current_user: UsuarioInfo = Depends(get_current_user)
):
    """
    Endpoint para autocompletar la reclasificación en tiempo real.
    Trae ejecutivo, sucursal y líder vigentes desde el maestro.
    """
    resultado = BusinessRulesService.vincular_intermediario_con_reclasificacion(q)
    if not resultado:
        return {"encontrado": False, "mensaje": "Intermediario no localizado en el maestro."}
    return resultado

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

@app.post("/api/intermediarios/estatus")
def cambiar_estatus_intermediario(
    payload: EstatusMaestroPayload,
    current_user: UsuarioInfo = Depends(require_role(["Supervisor"]))
):
    """Solo el Supervisor puede alterar la condición ACTIVO del maestro."""
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

@app.post("/api/reclasificaciones/guardar")
def guardar_reclasificacion(
    payload: ReclasificacionPayload,
    current_user: UsuarioInfo = Depends(get_current_user)
):
    """
    Guarda la reclasificación con los nuevos campos:
    Nro_Poliza, Nombre_y_Apellido_Intermediario, Nombre_del_Tomador, Nombre_del_Asegurado,
    CORRECCIÓN INTERMEDIARIO, SUCURSAL_RECLASIF, EJECUTIVO_RECLASIF, LIDER_RECLASIF, CANAL_RECLASIF
    """
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

