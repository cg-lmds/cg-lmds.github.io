from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class LoginRequest(BaseModel):
    username: str
    password: str

class UsuarioInfo(BaseModel):
    username: str
    nombre: str
    rol: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioInfo

class IntermediarioMaestroPayload(BaseModel):
    id: Optional[str] = ""
    intermediario: str
    cod: str
    ejecutivo: Optional[str] = ""
    fechaInicio: Optional[str] = ""
    fechaFin: Optional[str] = ""
    sucursal: Optional[str] = ""
    lider: Optional[str] = ""
    activo: Optional[str] = "SI"
    cedula: Optional[str] = ""
    correo: Optional[str] = ""
    fechaNac: Optional[str] = ""
    fechaAfiliacion: Optional[str] = ""

class EstatusMaestroPayload(BaseModel):
    cod: str
    id: Optional[str] = ""
    nuevoEstatus: str = "SI"

class ReclasificacionPayload(BaseModel):
    modo: Optional[str] = "NEW_OR_RECLASSIFY"
    editId: Optional[str] = ""
    # Nuevos campos exactos requeridos
    nroPoliza: str = Field(..., description="Número de Póliza")
    nombreIntermediarioOriginal: str = Field(..., description="Nombre y Apellido del Intermediario Original")
    nombreTomador: Optional[str] = Field("", description="Nombre del Tomador")
    nombreAsegurado: Optional[str] = Field("", description="Nombre del Asegurado")
    correccionIntermediario: str = Field(..., description="CORRECCIÓN INTERMEDIARIO (Nombre asignado/corregido)")
    codigoIntermediario: Optional[str] = Field("", description="Código del intermediario en el maestro")
    sucursalReclasif: str = Field(..., description="SUCURSAL_RECLASIF")
    ejecutivoReclasif: str = Field(..., description="EJECUTIVO_RECLASIF")
    liderReclasif: Optional[str] = Field("", description="LIDER_RECLASIF")
    canalReclasif: Optional[str] = Field("", description="CANAL_RECLASIF")
    # Trazabilidad y vigencia
    fechaInicio: Optional[str] = ""
    fechaFin: Optional[str] = ""
    fechaCierreAnterior: Optional[str] = ""
    estatus: Optional[str] = "ACTIVO"

class EstatusReclasificacionPayload(BaseModel):
    codigo: str
    nuevoEstatus: str = "ACTIVO"

class ApiResponse(BaseModel):
    exito: bool
    mensaje: str = ""
    datos: Optional[Dict[str, Any]] = None
