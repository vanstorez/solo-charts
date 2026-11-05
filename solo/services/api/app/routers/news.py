from fastapi import APIRouter, Query

from ..services import news_intel

router = APIRouter(prefix="/api", tags=["news"])


@router.get("/news")
async def news(
    category: str = Query(default="all", max_length=60),
    feed: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=30, ge=1, le=100),
):
    return await news_intel.get_news(category=category, limit=limit, feed=feed)
