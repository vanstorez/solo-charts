import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import get_db
from .routers import alerts, analysis, advanced_analysis, backtest, calendar, india, lab, macro, market, news, options, paper, scenarios, scanner, system, watchlist, world
from .services import market as market_service
from .timeutil import iso, utc_now


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_db().init()
    yield


app = FastAPI(
    title="Solo Trading Charts API",
    version=__version__,
    description=(
        "Local research API for market data provenance, news intelligence, Bank Nifty scenarios, "
        "prediction-market lag research and paper trading. Live broker execution is disabled."
    ),
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

for router in [
    system.router,
    market.router,
    analysis.router,
    advanced_analysis.router,
    india.router,
    watchlist.router,
    scanner.router,
    world.router,
    news.router,
    macro.router,
    calendar.router,
    alerts.router,
    scenarios.router,
    lab.router,
    paper.router,
    backtest.router,
    options.router,
]:
    app.include_router(router)


@app.get("/")
async def root():
    return {
        "name": "Solo Trading Charts API",
        "version": __version__,
        "docs": "/docs",
        "mode": "research_and_paper",
        "live_execution_enabled": False,
        "time": iso(utc_now()),
        "disclaimer": "Research and paper trading only. Not investment advice.",
    }


@app.websocket("/ws/market")
async def market_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            try:
                payload = await market_service.overview()
                await websocket.send_json({"type": "market_overview", "payload": payload})
            except Exception as exc:
                await websocket.send_json(
                    {
                        "type": "stream_error",
                        "detail": f"Provider refresh failed: {str(exc)[:240]}",
                        "at": iso(utc_now()),
                    }
                )
            await asyncio.sleep(20)
    except WebSocketDisconnect:
        return
    except Exception:
        return


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )
