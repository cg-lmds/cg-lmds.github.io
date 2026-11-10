import os
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from api.models import UsuarioInfo

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "sistema-intermediarios-reclasificaciones-secure-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

def verify_password(plain_password: str, stored_password: str) -> bool:
    """
    Verifica contraseñas compatibles tanto con hashes bcrypt como con texto plano 
    para una transición transparente de credenciales existentes.
    """
    if not stored_password or not plain_password:
        return False
    if stored_password.startswith("$2b$") or stored_password.startswith("$2a$"):
        try:
            return pwd_context.verify(plain_password, stored_password)
        except Exception:
            return False
    # Compatibilidad con contraseñas legadas en texto plano
    return plain_password.strip() == stored_password.strip()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> UsuarioInfo:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No se proporcionó token de autenticación.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        rol: str = payload.get("rol", "Operadora")
        nombre: str = payload.get("nombre", username)
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token de acceso inválido.",
            )
        return UsuarioInfo(username=username, rol=rol, nombre=nombre)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión expirada o token no válido. Inicie sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

def require_role(allowed_roles: List[str]):
    def role_checker(current_user: UsuarioInfo = Depends(get_current_user)) -> UsuarioInfo:
        user_role = (current_user.rol or "").strip().capitalize()
        allowed_normalized = [r.strip().capitalize() for r in allowed_roles]
        if user_role not in allowed_normalized:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso denegado: El rol '{current_user.rol}' no tiene permisos para esta operación."
            )
        return current_user
    return role_checker

