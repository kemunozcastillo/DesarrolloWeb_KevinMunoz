from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Configuración leída desde variables de entorno o del archivo .env.

    Nunca se escribe la URI de Mongo en el código: lleva usuario y contraseña
    del cluster, y el .env está en el .gitignore.
    """

    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "poke_fresh"

    # HashiCorp Vault: de aquí sale la credencial interna que debe traer cada
    # petición. El backend solo puede leer su propia ruta (ver la política en
    # el gateway), nunca el token de los clientes.
    vault_addr: str = "http://127.0.0.1:8200"
    vault_token: str = ""
    vault_montaje: str = "secret"
    vault_ruta_backend: str = "poke-fresh/backend"
    # Segundos que se guarda la credencial leída, para no consultar a Vault en
    # cada petición. Si se rota en Vault, el backend la toma al vencer.
    vault_cache_segundos: int = 30

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
