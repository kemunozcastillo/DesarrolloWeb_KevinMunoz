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
    origen_frontend: str = "*"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
