from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    app_name: str = "Solo Trading Charts API"
    app_env: str = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    database_path: str = "data/solo.db"
    http_timeout_seconds: float = 18.0
    polymarket_enabled: bool = True
    polymarket_gamma_url: str = "https://gamma-api.polymarket.com"
    polymarket_clob_url: str = "https://clob.polymarket.com"
    live_execution_enabled: bool = False
    # Licensed vendor feed. Credentials are read server-side only and are never
    # returned by the API or embedded in the web bundle.
    gdf_enabled: bool = True
    nse_direct_enabled: bool = True
    gdf_base_url: str = ""
    gdf_api_key: SecretStr = SecretStr("")
    # Dhan Data API (broker-licensed real-time). The token stays server-side; solo/.env
    dhan_enabled: bool = True
    dhan_client_id: str = ""
    dhan_data_token: SecretStr = SecretStr("")
    gdf_request_timeout_seconds: float = 8.0
    gdf_quote_ttl_seconds: float = 3.0
    gdf_history_ttl_seconds: float = 20.0
    gdf_entitlement_ttl_seconds: float = 300.0
    gdf_history_max: int = 1000
    max_open_positions: int = 5
    max_trade_notional: float = 200_000
    max_total_exposure: float = 500_000
    daily_loss_limit: float = 5_000
    max_drawdown: float = 25_000
    paper_slippage_bps: float = 5
    paper_fee_bps: float = 2

    model_config = SettingsConfigDict(
        env_prefix="SOLO_",
        env_file=str(SERVICE_ROOT / ".env"),
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def database_file(self) -> Path:
        path = Path(self.database_path)
        return path if path.is_absolute() else SERVICE_ROOT / path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
