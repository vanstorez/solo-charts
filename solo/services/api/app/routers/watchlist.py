from fastapi import APIRouter, Query

from ..services import watchlist

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


@router.get("")
async def get_watchlist():
    return await watchlist.get_watchlist()


@router.post("/add")
async def add_to_watchlist(symbol: str = Query(...), note: str = Query(default="")):
    return await watchlist.add_to_watchlist(symbol, note)


@router.post("/remove")
async def remove_from_watchlist(symbol: str = Query(...)):
    return await watchlist.remove_from_watchlist(symbol)


@router.post("/clear")
async def clear_watchlist():
    return await watchlist.clear_watchlist()
