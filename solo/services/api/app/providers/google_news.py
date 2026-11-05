import asyncio
import hashlib
import html
import re
import xml.etree.ElementTree as ElementTree
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

from ..cache import cache
from ..timeutil import iso
from .http import ProviderError, fetch_text

PROVIDER = "Google News RSS"
FEED_URL = "https://news.google.com/rss/search"

CATEGORIES = {
    "india": {
        "label": "India markets",
        "query": '"Nifty" OR "Sensex" OR "BSE" OR "NSE" India stock market when:1d',
        "locale": "IN",
    },
    "global": {
        "label": "Global markets",
        "query": '"Wall Street" OR "S&P 500" OR Nasdaq OR "global stocks" when:1d',
        "locale": "US",
    },
    "geopolitics": {
        "label": "Geopolitics & oil",
        "query": "oil geopolitics OR Iran OR Hormuz OR sanctions OR ceasefire when:2d",
        "locale": "US",
    },
    "fed": {
        "label": "Fed & FOMC",
        "query": '"Federal Reserve" OR FOMC OR "rate cut" OR "25 basis points" when:3d',
        "locale": "US",
    },
    "rbi": {
        "label": "RBI & monetary policy",
        "query": '"RBI Governor" OR "Reserve Bank of India" OR "repo rate" OR "monetary policy" when:3d',
        "locale": "IN",
    },
    "policy": {
        "label": "India policy, tax & GIFT City",
        "query": '"GIFT City" OR "foreign investors" tax India OR "Finance Minister" OR "SEBI" when:7d',
        "locale": "IN",
    },
    "worldbank": {
        "label": "World Bank, IMF & G20",
        "query": '"World Bank" OR "IMF" OR "G20" OR "global economy" meeting when:14d',
        "locale": "US",
    },
    "commodities": {
        "label": "Commodities",
        "query": '"Brent crude" OR "WTI" OR gold OR copper commodity prices when:2d',
        "locale": "US",
    },
    "rareearth": {
        "label": "Rare earth & critical minerals",
        "query": '"rare earth" OR "rare earth metals" OR "critical minerals" OR "China export controls" when:7d',
        "locale": "US",
    },
}

DEFAULT_CATEGORIES = ["india", "global", "geopolitics", "fed", "rbi", "policy", "worldbank", "commodities", "rareearth"]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _strip_html(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(value or ""))).strip()


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


async def fetch_category(category: str) -> list[dict]:
    if category not in CATEGORIES:
        raise ProviderError(f"Unknown news category: {category}")
    cached = cache.get(f"news:{category}")
    if cached is not None:
        return cached
    config = CATEGORIES[category]
    locale = config["locale"]
    params = {
        "q": config["query"],
        "hl": "en-IN" if locale == "IN" else "en-US",
        "gl": locale,
        "ceid": f"{locale}:en",
    }
    text = await fetch_text(PROVIDER, FEED_URL, params=params, timeout=16, retries=1)
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        raise ProviderError("Google News returned invalid RSS") from exc
    items = []
    for node in root.iter():
        if _local_name(node.tag) != "item":
            continue
        fields = {_local_name(child.tag): child for child in list(node)}
        title = _strip_html(fields.get("title").text if fields.get("title") is not None else "")
        link = (fields.get("link").text or "").strip() if fields.get("link") is not None else ""
        if not title or not link:
            continue
        source_node = fields.get("source")
        source = _strip_html(source_node.text if source_node is not None and source_node.text else "")
        if source:
            title = re.sub(rf"\s+-\s+{re.escape(source)}\s*$", "", title, flags=re.IGNORECASE)
        published = _parse_date(fields.get("pubdate").text if fields.get("pubdate") is not None else None)
        identifier = hashlib.sha1(link.encode("utf-8")).hexdigest()[:20]
        items.append(
            {
                "id": f"gn-{identifier}",
                "title": title,
                "link": link,
                "source": source or "Google News",
                "category": category,
                "category_label": config["label"],
                "published_at": iso(published) if published else None,
            }
        )
    items.sort(key=lambda item: item.get("published_at") or "", reverse=True)
    cache.set("news:" + category, items, 300)
    return items


async def fetch_many(categories: list[str] | None = None) -> tuple[list[dict], dict]:
    selected = categories or DEFAULT_CATEGORIES
    results = await asyncio.gather(
        *(fetch_category(category) for category in selected), return_exceptions=True
    )
    articles: list[dict] = []
    errors: dict[str, str] = {}
    for category, result in zip(selected, results):
        if isinstance(result, Exception):
            errors[category] = str(result)
        else:
            articles.extend(result)
    if not articles and errors:
        raise ProviderError("; ".join(f"{key}: {value}" for key, value in errors.items())[:400])
    return articles, errors
