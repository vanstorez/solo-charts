from fastapi import APIRouter, Query

from .. import __version__
from ..config import get_settings
from ..db import get_db
from ..providers import globaldatafeeds as gdf
from ..services import paper, quality, sources
from ..timeutil import iso, utc_now

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health():
    database = get_db()
    return {
        "status": "ok",
        "service": "solo-api",
        "version": __version__,
        "time": iso(utc_now()),
        "database": {
            "path": get_settings().database_file.name,
            "audit_chain_valid": database.verify_audit_chain(),
        },
        "live_execution_enabled": False,
    }


@router.get("/config")
async def config():
    settings = get_settings()
    return {
        "version": __version__,
        "environment": settings.app_env,
        "live_execution_enabled": False,
        "requested_live_execution": bool(settings.live_execution_enabled),
        "mode": "research_and_paper",
        "risk_limits": paper.get_risk_limits(),
        "providers": {
            "polymarket_enabled": settings.polymarket_enabled,
            "polymarket_gamma_url": settings.polymarket_gamma_url,
            "polymarket_clob_url": settings.polymarket_clob_url,
            "globaldatafeeds": gdf.status(),
        },
        "api_host": settings.api_host,
        "api_port": settings.api_port,
        "note": "Local research API. There is no authentication layer yet; keep it bound to 127.0.0.1.",
    }


@router.get("/live/status")
async def live_status(probe: bool = Query(default=False, description="Query Global Datafeeds GetLimitation")):
    if probe and gdf.configured():
        return await gdf.probe(force=False)
    return gdf.status()


@router.get("/sources")
async def source_catalog():
    return await sources.get_sources()


@router.get("/quality")
async def data_quality():
    return await quality.get_quality()
