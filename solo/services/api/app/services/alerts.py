from datetime import timedelta

from ..db import get_db
from ..schemas import AlertRuleRequest
from ..timeutil import iso, parse_datetime, utc_now
from .market import SYMBOLS, get_quotes
from .news_intel import get_news

COOLDOWN_MINUTES = 15


def _serialise(row: dict) -> dict:
    return {
        **row,
        "enabled": bool(row.get("enabled")),
        "description": _description(row),
    }


def _description(rule: dict) -> str:
    if rule["kind"] == "price_above":
        return f"{rule.get('symbol')} trades above {rule.get('threshold')}"
    if rule["kind"] == "price_below":
        return f"{rule.get('symbol')} trades below {rule.get('threshold')}"
    return f"News headline contains “{rule.get('keyword')}”"


def list_rules() -> list[dict]:
    return [_serialise(row) for row in get_db().list_alert_rules()]


def create_rule(request: AlertRuleRequest) -> dict:
    if request.kind in {"price_above", "price_below"} and request.symbol not in SYMBOLS:
        raise ValueError(f"Unknown symbol: {request.symbol}")
    existing = get_db().list_alert_rules()
    for row in existing:
        if (
            row["kind"] == request.kind
            and (row.get("symbol") or None) == (request.symbol or None)
            and row.get("threshold") == request.threshold
            and (row.get("keyword") or "").strip().lower() == (request.keyword or "").strip().lower()
        ):
            raise ValueError("An identical alert rule already exists")
    payload = {
        "kind": request.kind,
        "symbol": request.symbol if request.kind != "news_keyword" else None,
        "threshold": request.threshold if request.kind != "news_keyword" else None,
        "keyword": (request.keyword or "").strip() if request.kind == "news_keyword" else None,
        "note": (request.note or "").strip() or None,
        "enabled": 1,
        "created_at": iso(utc_now()),
    }
    row = get_db().create_alert_rule(payload)
    get_db().append_audit("alerts.rule.created", {"rule_id": row["id"], "rule": _serialise(row)})
    return _serialise(row)


def delete_rule(rule_id: int) -> dict:
    row = get_db().get_alert_rule(rule_id)
    if not row:
        raise ValueError("Alert rule not found")
    deleted = get_db().delete_alert_rule(rule_id)
    get_db().append_audit("alerts.rule.deleted", {"rule_id": rule_id, "rule": _serialise(row)})
    return {"deleted": deleted, "rule_id": rule_id}


def _on_cooldown(rule: dict, now) -> bool:
    last = parse_datetime(rule.get("last_triggered_at"))
    if last is None:
        return False
    return now - last < timedelta(minutes=COOLDOWN_MINUTES)


def _news_matches(events: list[dict], keyword: str, now) -> list[dict]:
    needle = keyword.strip().lower()
    matches = []
    for event in events:
        headline = (event.get("headline") or "").lower()
        if needle not in headline:
            continue
        published = parse_datetime(event.get("published_at"))
        if published is not None and now - published > timedelta(hours=36):
            continue
        matches.append(
            {
                "headline": event.get("headline"),
                "event_label": event.get("event_label"),
                "published_at": event.get("published_at"),
                "verification": event.get("verification"),
                "sources": [
                    {"source": article.get("source"), "link": article.get("link")}
                    for article in (event.get("articles") or [])[:3]
                ],
            }
        )
    return matches[:3]


async def evaluate_rules() -> dict:
    now = utc_now()
    rules = [rule for rule in list_rules() if rule["enabled"]]
    triggers = []
    errors = []
    price_rules = [rule for rule in rules if rule["kind"] in {"price_above", "price_below"}]
    news_rules = [rule for rule in rules if rule["kind"] == "news_keyword"]
    quote_meta = None
    if price_rules:
        symbols = sorted({rule["symbol"] for rule in price_rules if rule.get("symbol")})
        try:
            quotes, quote_meta = await get_quotes(symbols)
            by_key = {quote["key"]: quote for quote in quotes}
            for rule in price_rules:
                quote = by_key.get(rule["symbol"])
                value = quote.get("value") if quote else None
                if value is None:
                    errors.append(f"{rule['symbol']}: quote unavailable")
                    continue
                condition = value > rule["threshold"] if rule["kind"] == "price_above" else value < rule["threshold"]
                if not condition or _on_cooldown(rule, now):
                    continue
                evidence = {
                    "kind": rule["kind"],
                    "symbol": rule["symbol"],
                    "value": value,
                    "threshold": rule["threshold"],
                    "quote_source": quote.get("source"),
                    "quote_freshness": (quote_meta or {}).get("freshness"),
                }
                triggers.append({"rule": rule, "evidence": evidence})
                get_db().mark_alert_triggered(rule["id"], iso(now))
                get_db().append_audit("alerts.rule.triggered", {"rule_id": rule["id"], "evidence": evidence})
        except Exception as exc:
            errors.append(f"Price alert evaluation failed: {str(exc)[:240]}")
    if news_rules:
        try:
            news = await get_news("all", 80)
            if news.get("meta", {}).get("status") == "unavailable":
                errors.append("News feed unavailable; keyword alerts were not evaluated.")
            else:
                for rule in news_rules:
                    matches = _news_matches(news.get("events") or [], rule.get("keyword") or "", now)
                    if not matches or _on_cooldown(rule, now):
                        continue
                    evidence = {"kind": "news_keyword", "keyword": rule.get("keyword"), "matches": matches}
                    triggers.append({"rule": rule, "evidence": evidence})
                    get_db().mark_alert_triggered(rule["id"], iso(now))
                    get_db().append_audit("alerts.rule.triggered", {"rule_id": rule["id"], "evidence": evidence})
        except Exception as exc:
            errors.append(f"News alert evaluation failed: {str(exc)[:240]}")
    return {
        "checked_at": iso(now),
        "rules_checked": len(rules),
        "triggered": triggers,
        "errors": errors,
        "cooldown_minutes": COOLDOWN_MINUTES,
        "quote_meta": quote_meta,
        "note": (
            "Rules are evaluated only when this endpoint is called. No background scheduler, email, "
            "Telegram or mobile push provider is configured in this local build."
        ),
    }
