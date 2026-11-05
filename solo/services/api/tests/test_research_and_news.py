from app.schemas import BlackScholesRequest
from app.services.options import calculate_black_scholes
from app.services.news_intel import _cluster_articles, classify


def test_black_scholes_known_call_value():
    result = calculate_black_scholes(
        BlackScholesRequest(
            spot=100,
            strike=100,
            days=365,
            volatility=20,
            rate=5,
            option_type="call",
        )
    )
    assert result["price"] == 10.4506
    assert result["greeks"]["delta"] > 0.5


def test_news_classification_is_deterministic():
    war = classify("Missile strike escalates conflict in the Gulf")
    assert war["event_type"] == "war_escalation"
    assert war["tone"] == "negative"
    ceasefire = classify("Ceasefire and peace talks agreed after talks")
    assert ceasefire["event_type"] == "ceasefire"
    assert ceasefire["tone"] == "positive"
    fed = classify("Federal Reserve signals a rate cut after FOMC meeting")
    assert fed["event_type"] == "fed"


def test_news_cluster_merges_duplicate_headlines_only_within_window():
    from datetime import datetime, timezone
    import hashlib

    def article(title, link, published):
        return {
            "id": hashlib.sha1(link.encode()).hexdigest(),
            "title": title,
            "link": link,
            "source": "Reuters",
            "published_at": published,
            "last_seen_at": published,
            "first_seen_at": published,
        }

    now = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
    articles = [
        article("Oil jumps after missile strike in Gulf", "https://a", "2026-10-27T11:00:00+00:00"),
        article("Oil jumps after missile strike in Gulf region", "https://b", "2026-10-27T11:05:00+00:00"),
        article("RBI holds repo rate at policy meeting", "https://c", "2026-10-27T10:00:00+00:00"),
    ]
    clusters = _cluster_articles(articles, now)
    assert len(clusters) == 2
