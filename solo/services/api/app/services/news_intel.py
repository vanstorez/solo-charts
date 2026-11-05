import hashlib
import re
from datetime import datetime
from typing import Any

from ..db import get_db
from ..provenance import feed_meta, unavailable_meta
from ..providers import google_news
from ..timeutil import iso, parse_datetime, utc_now

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "for", "from", "with", "after", "before",
    "amid", "over", "into", "that", "this", "will", "would", "could", "says", "said",
    "new", "top", "live", "update", "updates", "today", "india", "indian", "market",
    "markets", "stock", "stocks", "news", "report", "reports", "as", "at", "by", "in",
    "on", "of", "to", "is", "are", "was", "were", "be", "its", "it", "their", "his",
    "her", "he", "she", "they", "we", "you", "not", "no", "may", "can", "has", "have",
    "had", "which", "who", "what", "when", "where", "why", "how", "your", "our",
}

TOP_TIER_SOURCES = {
    "reuters", "associated press", "ap", "bloomberg", "financial times", "ft",
    "wall street journal", "wsj", "cnbc", "the hindu", "business standard",
    "the economic times", "mint", "livemint", "ndtv", "pti", "press trust of india",
    "the indian express", "hindustan times", "the times of india", "al jazeera",
    "bbc", "cnn", "nikkei asia", "the guardian", "axios",
}

EVENT_RULES: list[dict[str, Any]] = [
    {
        "type": "ceasefire",
        "label": "Ceasefire / de-escalation",
        "keywords": ["ceasefire", "truce", "peace deal", "peace talks", "de-escalation", "deescalation", "hostilities end"],
        "tone": "positive",
        "severity": 3,
        "assets": ["NIFTY", "BANKNIFTY", "BRENT", "GOLD"],
        "channels": ["Geopolitical risk premium may recede", "Crude and gold risk premia may unwind", "Risk appetite may improve"],
    },
    {
        "type": "war_escalation",
        "label": "War / military escalation",
        "keywords": ["war", "missile", "airstrike", "air strike", "invasion", "military strike", "escalation", "attack", "drone strike", "nuclear"],
        "tone": "negative",
        "severity": 5,
        "assets": ["NIFTY", "BANKNIFTY", "BRENT", "GOLD", "USDINR"],
        "channels": ["Risk-off sentiment", "Energy supply risk", "Safe-haven demand", "Imported inflation and rupee pressure"],
    },
    {
        "type": "sanctions",
        "label": "Sanctions / trade restrictions",
        "keywords": ["sanction", "sanctions", "export controls", "export ban", "trade restriction", "blacklist"],
        "tone": "negative",
        "severity": 4,
        "assets": ["BRENT", "NIFTY", "USDINR", "GOLD"],
        "channels": ["Supply-chain disruption", "Commodity price pressure", "Currency and risk sentiment"],
    },
    {
        "type": "tariff",
        "label": "Tariffs / trade policy",
        "keywords": ["tariff", "tariffs", "import duty", "export duty", "customs duty"],
        "tone": "negative",
        "severity": 3,
        "assets": ["NIFTY", "BANKNIFTY", "USDINR"],
        "channels": ["Trade and earnings expectations", "Inflation pass-through", "Currency pressure"],
    },
    {
        "type": "fed",
        "label": "US Federal Reserve / rates",
        "keywords": ["federal reserve", "fomc", "powell", "fed funds", "rate cut", "rate hike", "basis points", "us inflation", "treasury yield"],
        "tone": "uncertain",
        "severity": 4,
        "assets": ["US10Y", "DXY", "USDINR", "NIFTY", "BANKNIFTY"],
        "channels": ["US yield and dollar transmission", "Global risk appetite", "Foreign-flow expectations"],
    },
    {
        "type": "rbi",
        "label": "RBI / Indian monetary policy",
        "keywords": ["rbi", "reserve bank of india", "repo rate", "monetary policy", "liquidity", "governor malhotra"],
        "tone": "uncertain",
        "severity": 3,
        "assets": ["BANKNIFTY", "NIFTY", "USDINR"],
        "channels": ["Banking margins and credit growth", "Rate-sensitive valuations", "Rupee and liquidity"],
    },
    {
        "type": "india_policy",
        "label": "India policy / tax / regulation",
        "keywords": ["finance ministry", "nirmala sitharaman", "union budget", "gst", "sebi", "tax", "taxation", "gift city", "ifsc", "fpi", "foreign portfolio"],
        "tone": "uncertain",
        "severity": 3,
        "assets": ["NIFTY", "BANKNIFTY", "USDINR"],
        "channels": ["Domestic policy expectations", "Foreign-investor flows", "Sector-specific earnings"],
    },
    {
        "type": "worldbank_imf",
        "label": "World Bank / IMF / G20",
        "keywords": ["world bank", "imf", "g20", "g7", "global economy", "economic outlook", "summit"],
        "tone": "uncertain",
        "severity": 2,
        "assets": ["NIFTY", "USDINR", "SPX"],
        "channels": ["Global growth expectations", "Policy coordination", "Risk sentiment"],
    },
    {
        "type": "oil_supply",
        "label": "Crude oil / energy supply",
        "keywords": ["opec", "brent", "crude", "oil supply", "hormuz", "oil production", "refinery", "petroleum"],
        "tone": "uncertain",
        "severity": 3,
        "assets": ["BRENT", "WTI", "USDINR", "NIFTY"],
        "channels": ["India's import bill", "Inflation expectations", "Oil marketing and banking sentiment"],
    },
    {
        "type": "rare_earth",
        "label": "Rare earth / critical minerals",
        "keywords": ["rare earth", "rare-earth", "critical mineral", "lithium", "cobalt", "graphite", "gallium", "germanium"],
        "tone": "uncertain",
        "severity": 3,
        "assets": ["NIFTY", "TATASTEEL"],
        "channels": ["Input-cost pressure", "Supply-chain diversification", "Strategic commodity policy"],
    },
    {
        "type": "india_markets",
        "label": "India markets / flows",
        "keywords": ["nifty", "sensex", "bank nifty", "fii", "fpi", "dii", "foreign investors", "block deal", "ipo"],
        "tone": "uncertain",
        "severity": 2,
        "assets": ["NIFTY", "BANKNIFTY"],
        "channels": ["Domestic positioning and flows", "Index-level risk appetite"],
    },
    {
        "type": "global_markets",
        "label": "Global markets",
        "keywords": ["wall street", "s&p 500", "nasdaq", "dow", "global stocks", "asian markets", "european stocks"],
        "tone": "uncertain",
        "severity": 2,
        "assets": ["SPX", "NDX", "NIFTY"],
        "channels": ["Global risk appetite", "Cross-market correlation"],
    },
    {
        "type": "corporate",
        "label": "Corporate / earnings",
        "keywords": ["earnings", "results", "profit", "revenue", "guidance", "merger", "acquisition", "dividend", "buyback"],
        "tone": "uncertain",
        "severity": 2,
        "assets": ["NIFTY"],
        "channels": ["Stock-specific earnings", "Sector sentiment"],
    },
]

TYPE_LABELS = {rule["type"]: rule["label"] for rule in EVENT_RULES}


def _normalise_title(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip())


def _tokens(title: str) -> set[str]:
    text = _normalise_title(title).lower()
    words = re.findall(r"[a-z0-9]{3,}", text)
    return {word for word in words if word not in STOPWORDS}


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0
    return len(left & right) / len(left | right)


def classify(title: str) -> dict[str, Any]:
    text = _normalise_title(title).lower()
    matched = EVENT_RULES[-1]
    for rule in EVENT_RULES:
        if any(keyword in text for keyword in rule["keywords"]):
            matched = rule
            break
    severity = matched["severity"]
    if any(word in text for word in ["emergency", "nuclear", "default", "invasion", "shutdown"]):
        severity = min(5, severity + 1)
    return {
        "event_type": matched["type"],
        "event_label": matched["label"],
        "tone": matched["tone"],
        "severity": severity,
        "affected_assets": matched["assets"],
        "transmission_channels": matched["channels"],
    }


def _source_tier(source: str) -> int:
    return 2 if (source or "").strip().lower() in TOP_TIER_SOURCES else 1


def _direction_for_asset(event_type: str, symbol: str) -> str:
    if event_type == "war_escalation":
        if symbol in {"BRENT", "GOLD"}:
            return "up"
        if symbol in {"NIFTY", "BANKNIFTY"}:
            return "down"
        if symbol == "USDINR":
            return "INR weaker / pair up"
    if event_type == "ceasefire":
        if symbol in {"BRENT", "GOLD"}:
            return "down"
        if symbol in {"NIFTY", "BANKNIFTY"}:
            return "up"
    return "uncertain"


def _asset_links(classification: dict[str, Any]) -> list[dict]:
    return [
        {
            "symbol": symbol,
            "expected_direction": _direction_for_asset(classification["event_type"], symbol),
            "confidence": "low",
        }
        for symbol in classification["affected_assets"]
    ]


def _parse_published(article: dict) -> datetime | None:
    return parse_datetime(article.get("published_at")) or parse_datetime(article.get("last_seen_at"))


def _first_seen(article: dict) -> datetime | None:
    return parse_datetime(article.get("first_seen_at")) or parse_datetime(article.get("last_seen_at"))


def _cluster_articles(articles: list[dict], now: datetime) -> list[list[dict]]:
    ordered = sorted(articles, key=lambda article: article.get("published_at") or "", reverse=True)
    clusters: list[list[dict]] = []
    for article in ordered:
        tokens = _tokens(article.get("title") or "")
        published = _parse_published(article) or now
        best_cluster = None
        best_score = 0.0
        for cluster in clusters:
            representative = cluster[0]
            rep_tokens = _tokens(representative.get("title") or "")
            rep_time = _parse_published(representative) or now
            if abs((published - rep_time).total_seconds()) > 36 * 3600:
                continue
            score = _jaccard(tokens, rep_tokens)
            if score >= 0.52 and score > best_score:
                best_cluster = cluster
                best_score = score
        if best_cluster is not None:
            best_cluster.append(article)
        else:
            clusters.append([article])
    return clusters


def _event_from_cluster(cluster: list[dict], now: datetime) -> dict:
    cluster = sorted(cluster, key=lambda article: article.get("published_at") or "", reverse=True)
    representative = max(
        cluster,
        key=lambda article: (
            _source_tier(article.get("source") or ""),
            len(_tokens(article.get("title") or "")),
            article.get("published_at") or "",
        ),
    )
    classification = classify(representative.get("title") or "")
    sources = sorted({(article.get("source") or "Unknown").strip() for article in cluster if article.get("source")})
    published_times = [parsed for article in cluster if (parsed := _parse_published(article))]
    first_seen_times = [parsed for article in cluster if (parsed := _first_seen(article))]
    published_at = min(published_times) if published_times else None
    first_seen_at = min(first_seen_times) if first_seen_times else now
    latest_article_at = max(published_times) if published_times else now
    age_minutes = max(0, int((now - latest_article_at).total_seconds() / 60)) if latest_article_at else None
    source_count = len(sources)
    tier_points = sum(_source_tier(source) for source in sources)
    recency_points = 15 if age_minutes is not None and age_minutes <= 60 else 8 if age_minutes is not None and age_minutes <= 360 else 2
    attention = min(95, 20 + classification["severity"] * 9 + source_count * 7 + tier_points * 3 + recency_points)
    verification = "multi_source" if source_count >= 2 else "single_source"
    confidence = "medium" if source_count >= 3 else "low"
    if source_count >= 2 and tier_points >= 4:
        confidence = "medium"
    event_key = f"{classification['event_type']}|{representative.get('title')}|{iso(published_at)}"
    event_id = "ev-" + hashlib.sha1(event_key.encode("utf-8")).hexdigest()[:16]
    return {
        "id": event_id,
        "headline": representative.get("title") or "Untitled event",
        "event_type": classification["event_type"],
        "event_label": classification["event_label"],
        "tone": classification["tone"],
        "published_at": iso(published_at),
        "first_seen_at": iso(first_seen_at),
        "last_updated_at": iso(now),
        "latest_article_at": iso(latest_article_at),
        "age_minutes": age_minutes,
        "verification": verification,
        "verification_note": (
            "Headline is present in multiple independent source labels. This is not a fact-check."
            if source_count >= 2
            else "Only one source label was found. Treat as unconfirmed until corroborated."
        ),
        "confidence": confidence,
        "source_count": source_count,
        "sources": sources[:8],
        "impact": {
            "attention_score": attention,
            "label": "attention score, not probability",
            "tone": classification["tone"],
            "severity": classification["severity"],
            "note": "Scores prioritise review. They do not estimate direction, probability or expected return.",
        },
        "affected_assets": _asset_links(classification),
        "transmission_channels": classification["transmission_channels"],
        "articles": [
            {
                "id": article.get("id"),
                "title": _normalise_title(article.get("title") or ""),
                "source": article.get("source") or "Unknown",
                "link": article.get("link"),
                "published_at": article.get("published_at"),
                "feed_category": article.get("category"),
            }
            for article in cluster[:8]
        ],
        "data_origin": "observed_google_news_rss",
    }


EVENT_CATEGORIES = [
    {"key": "all", "label": "All events"},
    *[{"key": rule["type"], "label": rule["label"]} for rule in EVENT_RULES],
]


def _asset_confirmation(expected: str, change: float | None) -> str:
    if change is None:
        return "unavailable"
    if expected in {"uncertain", ""}:
        return "not_directional"
    if expected in {"up", "INR weaker / pair up"}:
        if change >= 0.1:
            return "confirmed"
        if change <= -0.1:
            return "contradicted"
        return "flat"
    if expected == "down":
        if change <= -0.1:
            return "confirmed"
        if change >= 0.1:
            return "contradicted"
        return "flat"
    return "not_directional"


def _attach_price_confirmation(events: list[dict], quotes: list[dict], quote_meta: dict | None) -> None:
    by_key = {quote["key"]: quote for quote in quotes}
    for event in events:
        assets = []
        states = []
        for link in event.get("affected_assets", []):
            symbol = link.get("symbol")
            quote = by_key.get(symbol)
            change = quote.get("change") if quote else None
            state = _asset_confirmation(link.get("expected_direction") or "", change)
            states.append(state)
            assets.append(
                {
                    "symbol": symbol,
                    "expected_direction": link.get("expected_direction"),
                    "quote_change": change,
                    "state": state,
                    "quote_source": quote.get("source") if quote else None,
                }
            )
        directional = [state for state in states if state not in {"not_directional", "unavailable"}]
        if not directional:
            status = "unavailable" if all(state == "unavailable" for state in states) else "not_directional"
        elif "contradicted" in directional:
            status = "contradicted"
        elif all(state == "confirmed" for state in directional):
            status = "confirmed"
        else:
            status = "mixed"
        event["price_confirmation"] = {
            "status": status,
            "label": {
                "confirmed": "price confirms headline direction",
                "contradicted": "price contradicts headline direction",
                "mixed": "price reaction is mixed / flat",
                "not_directional": "headline has no directional price claim",
                "unavailable": "price confirmation unavailable",
            }[status],
            "assets": assets,
            "quote_freshness": quote_meta.get("freshness") if quote_meta else "unavailable",
            "as_of": quote_meta.get("as_of") if quote_meta else None,
            "fetched_at": quote_meta.get("fetched_at") if quote_meta else None,
            "note": "Current public quote snapshots, not event-time reaction. Confirmation is descriptive and does not establish causality.",
        }


async def get_news(category: str = "all", limit: int = 30, feed: str | None = None) -> dict:
    selected = google_news.DEFAULT_CATEGORIES
    if feed and feed in google_news.CATEGORIES:
        selected = [feed]
    now = utc_now()
    errors: dict[str, str] = {}
    try:
        articles, errors = await google_news.fetch_many(selected)
    except Exception as exc:
        return {
            "events": [],
            "meta": unavailable_meta("Google News RSS", "news events", str(exc)),
            "categories": EVENT_CATEGORIES,
            "errors": {category: str(exc)},
            "note": "No headlines are shown when the feed is unavailable.",
        }
    # Preserve source diversity and remove repeated links.
    deduped: dict[str, dict] = {}
    for article in articles:
        deduped.setdefault(article.get("link") or article.get("id") or "", article)
    articles = list(deduped.values())
    database = get_db()
    first_seen = database.upsert_articles(articles)
    for article in articles:
        if article.get("id") in first_seen:
            article["first_seen_at"] = first_seen[article["id"]]
    recent = database.recent_articles(hours=36, limit=400)
    for article in recent:
        article.setdefault("first_seen_at", article.get("last_seen_at"))
        article.setdefault("category", "general")
    combined = {article.get("link") or article.get("id"): article for article in recent}
    for article in articles:
        combined[article.get("link") or article.get("id")] = article
    clusters = _cluster_articles(list(combined.values()), now)
    events = [_event_from_cluster(cluster, now) for cluster in clusters]
    if category not in {"all", ""}:
        events = [event for event in events if event["event_type"] == category]
    events.sort(key=lambda event: (event.get("published_at") or "", event["impact"]["attention_score"]), reverse=True)
    events = events[: max(1, min(limit, 100))]
    symbols = sorted({link["symbol"] for event in events for link in event.get("affected_assets", [])})
    quote_meta = None
    quotes: list[dict] = []
    try:
        from .market import get_quotes

        quotes, quote_meta = await get_quotes(symbols)
        _attach_price_confirmation(events, quotes, quote_meta)
    except Exception as exc:
        quote_meta = unavailable_meta("TradingView scanner", "price confirmation", str(exc))
        _attach_price_confirmation(events, [], quote_meta)
    published = [event for event in events if event.get("published_at")]
    as_of = parse_datetime(max(published, key=lambda event: event["published_at"])["published_at"]) if published else now
    status = "degraded" if errors else "ok"
    detail = "Google News RSS aggregation; headlines are not independently fact-checked."
    if errors:
        detail += f" {len(errors)} feed(s) failed: {', '.join(errors)}."
    meta = feed_meta(
        "Google News RSS",
        "news events",
        as_of=as_of,
        source_type="aggregated",
        status=status,
        detail=detail,
        fresh_after=300,
        stale_after=1800,
    )
    return {
        "events": events,
        "meta": meta,
        "categories": EVENT_CATEGORIES,
        "errors": errors,
        "note": "First-seen timestamps are recorded when this local service first ingests a link. Google News publication times can differ from the underlying event time.",
    }
