import asyncio
import math
from datetime import datetime

from ..config import get_settings
from ..indicators import atr, ema, macd, pivot_points, round_values, rsi
from ..provenance import unavailable_meta
from ..timeutil import iso, utc_now
from .market import get_chart, get_quotes
from .news_intel import get_news

MACRO_KEYS = ["BANKNIFTY", "NIFTY", "USDINR", "BRENT", "DXY", "US10Y", "INDIAVIX", "SPX"]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_number(value, fallback=None):
    try:
        numeric = float(value)
        return numeric if math.isfinite(numeric) else fallback
    except (TypeError, ValueError):
        return fallback


def _patterns(bars: list[dict]) -> dict:
    closes = [bar["c"] for bar in bars]
    if len(closes) < 30:
        return {}
    e20 = ema(closes, 20)[-1]
    e50 = ema(closes, 50)[-1]
    e200 = ema(closes, 200)[-1]
    r14 = rsi(closes, 14)[-1]
    atr14 = atr(bars, 14)[-1]
    macd_value = macd(closes)["hist"][-1]
    last = bars[-1]
    last20 = bars[-20:]
    high20 = max(bar["h"] for bar in last20)
    low20 = min(bar["l"] for bar in last20)
    high52 = max(bar["h"] for bar in bars[-252:])
    low52 = min(bar["l"] for bar in bars[-252:])
    score = sum(
        [
            bool(e20 and last["c"] > e20),
            bool(e50 and last["c"] > e50),
            bool(e200 and last["c"] > e200),
            bool(e20 and e50 and e20 > e50),
            bool(r14 and r14 >= 50),
            bool(macd_value and macd_value > 0),
        ]
    )
    return {
        "close": last["c"],
        "e20": e20,
        "e50": e50,
        "e200": e200,
        "rsi": r14,
        "atr": atr14,
        "macd_hist": macd_value,
        "high20": high20,
        "low20": low20,
        "high52": high52,
        "low52": low52,
        "score": score,
        "trend": "up" if score >= 4 else "down" if score <= 2 else "mixed",
        "pivot": pivot_points(last),
        "last_bar_at": last["t"],
    }


def _macro_tilt(quotes: list[dict]) -> tuple[float, list[str]]:
    by_key = {quote["key"]: quote for quote in quotes}
    tilt = 0.0
    evidence = []
    for key, weight, label in [
        ("NIFTY", 1.0, "Nifty direction"),
        ("SPX", 0.5, "US equity direction"),
        ("INDIAVIX", -1.0, "India VIX"),
        ("USDINR", -0.7, "USD/INR"),
        ("BRENT", -0.5, "Brent"),
        ("DXY", -0.3, "US dollar index"),
        ("US10Y", -0.3, "US 10Y yield"),
    ]:
        change = _safe_number(by_key.get(key, {}).get("change"))
        if change is None:
            continue
        contribution = _clamp(change / 2.0, -1.0, 1.0) * weight
        tilt += contribution
        if abs(change) >= 0.2:
            evidence.append(f"{label}: {change:+.2f}% in the latest provider snapshot")
    return _clamp(tilt / 3.0, -1.0, 1.0), evidence


def _news_tilt(events: list[dict]) -> tuple[float, list[dict]]:
    tilt = 0.0
    selected = []
    for event in events[:25]:
        links = [link for link in event.get("affected_assets", []) if link.get("symbol") in {"BANKNIFTY", "NIFTY"}]
        if not links:
            continue
        directions = [link.get("expected_direction") for link in links]
        confirmation = (event.get("price_confirmation") or {}).get("status", "unavailable")
        weight = event["impact"]["attention_score"] / 100
        if confirmation == "contradicted":
            weight = 0
        elif confirmation in {"mixed", "unavailable"}:
            weight *= 0.5
        if "down" in directions and "up" not in directions:
            tilt -= weight
        elif "up" in directions and "down" not in directions:
            tilt += weight
        selected.append(
            {
                "headline": event["headline"],
                "event_label": event["event_label"],
                "tone": event["tone"],
                "verification": event["verification"],
                "published_at": event.get("published_at"),
                "attention_score": event["impact"]["attention_score"],
                "mapped_direction": directions,
                "price_confirmation": confirmation,
            }
        )
    return _clamp(tilt / 4.0, -1.0, 1.0), selected[:6]


def _price_confirmation(pattern: dict, quote: dict | None, bias: str) -> dict:
    if bias not in {"bullish", "bearish"}:
        return {
            "status": "not_directional",
            "label": "No directional claim to confirm",
            "checks": [],
            "passed": 0,
            "total": 0,
            "quote_change": quote.get("change") if quote else None,
            "as_of": quote.get("as_of") if quote else None,
            "source": quote.get("source") if quote else None,
            "note": "A neutral regime does not claim a direction; price confirmation is not applicable.",
        }
    bullish = bias == "bullish"
    checks = []
    change = _safe_number((quote or {}).get("change"))
    if change is None:
        checks.append({"label": "Current snapshot direction", "passed": None, "detail": "Provider quote change is unavailable."})
    else:
        checks.append(
            {
                "label": "Current snapshot direction",
                "passed": change > 0 if bullish else change < 0,
                "detail": f"Bank Nifty is {change:+.2f}% versus the prior close in the latest provider snapshot.",
            }
        )
    def add_check(label: str, value, passed: bool, detail: str) -> None:
        if value is None:
            checks.append({"label": label, "passed": None, "detail": "Indicator is unavailable."})
        else:
            checks.append({"label": label, "passed": bool(passed), "detail": detail})

    close = pattern.get("close")
    e20 = pattern.get("e20")
    add_check(
        "Daily close vs 20-DMA",
        e20,
        bool(close is not None and (close > e20 if bullish else close < e20)),
        f"Close {round_values(close)} versus 20-DMA {round_values(e20)}.",
    )
    rsi_value = pattern.get("rsi")
    add_check(
        "RSI(14) regime",
        rsi_value,
        bool(rsi_value is not None and (rsi_value >= 50 if bullish else rsi_value <= 50)),
        f"RSI(14) is {round_values(rsi_value, 1)}.",
    )
    macd_value = pattern.get("macd_hist")
    add_check(
        "MACD histogram",
        macd_value,
        bool(macd_value is not None and (macd_value > 0 if bullish else macd_value < 0)),
        f"MACD histogram is {round_values(macd_value, 2)}.",
    )
    available = [check for check in checks if check["passed"] is not None]
    passed = sum(1 for check in available if check["passed"])
    total = len(available)
    if total == 0:
        status = "unavailable"
        label = "Price confirmation unavailable"
    elif passed >= max(2, math.ceil(total * 2 / 3)):
        status = "confirmed"
        label = "Price action confirms the bias"
    elif passed >= 1:
        status = "mixed"
        label = "Price action is mixed"
    else:
        status = "contradicted"
        label = "Price action contradicts the bias"
    return {
        "status": status,
        "label": label,
        "checks": checks,
        "passed": passed,
        "total": total,
        "quote_change": change,
        "as_of": quote.get("as_of") if quote else None,
        "source": quote.get("source") if quote else None,
        "note": "Checks use the latest daily candle and current public quote snapshot. They are not a backtest or event-time reaction study.",
    }


def _scenario(
    *,
    side: str,
    pattern: dict,
    atr_value: float,
    costs_bps: float,
    evidence: list[str],
    confidence: float,
) -> dict:
    close = pattern["close"]
    high20 = pattern["high20"]
    low20 = pattern["low20"]
    high52 = pattern["high52"]
    low52 = pattern["low52"]
    if side == "bullish":
        trigger = high20 + 0.15 * atr_value
        entry_low = high20
        entry_high = high20 + 0.35 * atr_value
        entry_mid = (entry_low + entry_high) / 2
        stop = max(low20, entry_mid - 1.5 * atr_value)
        target1 = max(high52, entry_mid + 1.5 * atr_value)
        target2 = max(high52 + 1.0 * atr_value, entry_mid + 2.5 * atr_value)
        invalidation = min(low20, entry_mid - 2.0 * atr_value)
    elif side == "bearish":
        trigger = low20 - 0.15 * atr_value
        entry_low = low20 - 0.35 * atr_value
        entry_high = low20
        entry_mid = (entry_low + entry_high) / 2
        stop = min(high20, entry_mid + 1.5 * atr_value)
        target1 = min(low52, entry_mid - 1.5 * atr_value)
        target2 = min(low52 - 1.0 * atr_value, entry_mid - 2.5 * atr_value)
        invalidation = max(high20, entry_mid + 2.0 * atr_value)
    else:
        return {
            "side": side,
            "label": "Neutral / no trade",
            "status": "stand_aside",
            "trigger": f"Daily close stays between {round_values(low20)} and {round_values(high20)} without a volatility expansion.",
            "entry_zone": None,
            "stop": None,
            "targets": [],
            "invalidation": f"A decisive close outside {round_values(low20)}-{round_values(high20)} changes the regime.",
            "gross_risk_reward": None,
            "net_risk_reward": None,
            "evidence": evidence + ["Price is inside the 20-session range or trend signals conflict."],
            "confidence": round(confidence, 1),
            "notes": "The absence of a setup is a valid research outcome. Do not force a trade inside the range.",
        }
    risk_per_unit = abs(entry_mid - stop)
    reward_per_unit = abs(target1 - entry_mid)
    cost_per_unit = entry_mid * (costs_bps / 10000) * 2
    gross_rr = reward_per_unit / risk_per_unit if risk_per_unit else None
    net_rr = (reward_per_unit - cost_per_unit) / (risk_per_unit + cost_per_unit) if risk_per_unit else None
    return {
        "side": side,
        "label": "Bullish breakout scenario" if side == "bullish" else "Bearish breakdown scenario",
        "status": "conditional",
        "trigger": f"Daily close {'above' if side == 'bullish' else 'below'} {round_values(trigger)} with volume confirmation preferred.",
        "entry_zone": [round_values(entry_low), round_values(entry_high)],
        "stop": round_values(stop),
        "targets": [round_values(target1), round_values(target2)],
        "invalidation": f"Scenario invalidates on a close beyond {round_values(invalidation)} or if the provider feed becomes stale.",
        "gross_risk_reward": round_values(gross_rr, 2),
        "net_risk_reward": round_values(net_rr, 2),
        "caption": "Research levels are computed from the latest available daily candles; they are not orders or recommendations.",
        "evidence": evidence,
        "confidence": round(confidence, 1),
        "notes": "Costs use the configured paper-trading slippage and fee assumptions, not a broker quote.",
    }


async def get_banknifty_scenarios() -> dict:
    now = utc_now()
    chart_result, nifty_result, macro_result, news_result = await asyncio.gather(
        get_chart("BANKNIFTY", "1d", "1y"),
        get_chart("NIFTY", "1d", "1y"),
        get_quotes(MACRO_KEYS),
        get_news("all", 25),
        return_exceptions=True,
    )
    if isinstance(chart_result, Exception):
        return {
            "available": False,
            "reason": f"Bank Nifty candles are unavailable: {str(chart_result)[:240]}",
            "meta": unavailable_meta("Yahoo Finance", "Bank Nifty daily candles", str(chart_result)[:240]),
            "scenarios": [],
            "generated_at": iso(now),
        }
    chart = chart_result
    pattern = _patterns(chart["bars"])
    if not pattern:
        return {
            "available": False,
            "reason": "Not enough Bank Nifty history to calculate scenarios.",
            "meta": chart["meta"],
            "scenarios": [],
            "generated_at": iso(now),
        }
    nifty_pattern = _patterns(nifty_result["bars"]) if not isinstance(nifty_result, Exception) else None
    quotes = macro_result[0] if not isinstance(macro_result, Exception) else []
    quote_meta = macro_result[1] if not isinstance(macro_result, Exception) else unavailable_meta("TradingView scanner", "scenario inputs", str(macro_result)[:240])
    news = news_result if not isinstance(news_result, Exception) else {"events": [], "meta": unavailable_meta("Google News RSS", "scenario news", str(news_result)[:240])}
    macro_tilt, macro_evidence = _macro_tilt(quotes)
    news_tilt, news_evidence = _news_tilt(news.get("events") or [])
    settings = get_settings()
    atr_value = pattern["atr"] or max(pattern["close"] * 0.012, 1)
    trend_score = pattern["score"] / 6
    combined = trend_score * 0.6 + ((macro_tilt + 1) / 2) * 0.25 + ((news_tilt + 1) / 2) * 0.15
    confidence = _clamp(30 + combined * 50, 25, 82)
    if pattern["trend"] == "up" and macro_tilt >= -0.15:
        bias = "bullish"
    elif pattern["trend"] == "down" and macro_tilt <= 0.15:
        bias = "bearish"
    else:
        bias = "neutral"
    bank_quote = next((quote for quote in quotes if quote.get("key") == "BANKNIFTY"), None)
    price_confirmation = _price_confirmation(pattern, bank_quote, bias)
    evidence = [
        f"Bank Nifty close {pattern['close']:.2f}; 20-DMA {round_values(pattern['e20'])}; 50-DMA {round_values(pattern['e50'])}; 200-DMA {round_values(pattern['e200'])}.",
        f"RSI(14) {round_values(pattern['rsi'], 1)}; MACD histogram {round_values(pattern['macd_hist'], 2)}; ATR(14) {round_values(atr_value)}.",
        f"20-session range {round_values(pattern['low20'])}-{round_values(pattern['high20'])}; 52-week reference range {round_values(pattern['low52'])}-{round_values(pattern['high52'])}.",
        f"Price confirmation: {price_confirmation['label']} ({price_confirmation['passed']}/{price_confirmation['total']} checks).",
        *macro_evidence[:4],
        *[f"Headline watch: {item['headline']} ({item['event_label']}; {item['verification']}; price {item['price_confirmation']})" for item in news_evidence[:3]],
    ]
    if nifty_pattern:
        evidence.append(f"Nifty 50 trend score: {nifty_pattern['score']}/6, {nifty_pattern['trend']}.")
    scenarios = [
        _scenario(
            side="bullish",
            pattern=pattern,
            atr_value=atr_value,
            costs_bps=settings.paper_slippage_bps + settings.paper_fee_bps,
            evidence=evidence,
            confidence=confidence if bias == "bullish" else max(25, confidence - 18),
        ),
        _scenario(
            side="bearish",
            pattern=pattern,
            atr_value=atr_value,
            costs_bps=settings.paper_slippage_bps + settings.paper_fee_bps,
            evidence=evidence,
            confidence=confidence if bias == "bearish" else max(25, confidence - 18),
        ),
        _scenario(
            side="neutral",
            pattern=pattern,
            atr_value=atr_value,
            costs_bps=settings.paper_slippage_bps + settings.paper_fee_bps,
            evidence=evidence,
            confidence=confidence if bias == "neutral" else max(25, confidence - 12),
        ),
    ]
    feed_age = chart["meta"].get("age_seconds")
    stale = chart["meta"].get("freshness") == "stale" or chart["quote"] is None or chart["quote"].get("value") is None
    no_trade_reasons = []
    if stale:
        no_trade_reasons.append("The price feed or quote is stale/unavailable.")
    if bias == "neutral":
        no_trade_reasons.append("The trend, macro and headline inputs do not align into a directional setup.")
    if confidence < 50:
        no_trade_reasons.append("Research confidence is below the 50% review threshold.")
    if pattern["rsi"] is not None and pattern["rsi"] > 78:
        no_trade_reasons.append("RSI is above 78; chasing a breakout has adverse entry risk.")
    if pattern["rsi"] is not None and pattern["rsi"] < 22:
        no_trade_reasons.append("RSI is below 22; breakdown chasing has adverse entry risk.")
    if news.get("meta", {}).get("status") == "unavailable":
        no_trade_reasons.append("News context is unavailable, so event risk cannot be assessed.")
    if bias in {"bullish", "bearish"} and price_confirmation["status"] != "confirmed":
        no_trade_reasons.append(
            f"Price action {price_confirmation['status']} the {bias} bias; the setup needs clearer price confirmation."
        )
    return {
        "available": True,
        "symbol": "BANKNIFTY",
        "name": "Bank Nifty",
        "generated_at": iso(now),
        "bias": bias,
        "confidence": round(confidence, 1),
        "confidence_label": "research confidence, not a probability",
        "pattern": {
            **{key: round_values(value) if isinstance(value, (int, float)) and key not in {"score", "last_bar_at"} else value for key, value in pattern.items() if key != "pivot"},
            "pivot": {key: round_values(value) for key, value in pattern["pivot"].items()},
        },
        "macro_tilt": round(macro_tilt, 3),
        "news_tilt": round(news_tilt, 3),
        "price_confirmation": price_confirmation,
        "scenarios": scenarios,
        "active_scenario": bias,
        "no_trade": bool(no_trade_reasons),
        "no_trade_reasons": no_trade_reasons,
        "news_watch": news_evidence,
        "evidence": evidence,
        "data_quality": {
            "chart_meta": chart["meta"],
            "quote_meta": want_quote_meta(chart, quote_meta),
            "news_meta": news.get("meta") or unavailable_meta("Google News RSS", "scenario news", "No news metadata returned."),
            "bars": len(chart["bars"]),
            "feed_age_seconds": feed_age,
            "holiday_calendar": "not_configured",
        },
        "assumptions": {
            "cost_bps_per_side": settings.paper_slippage_bps + settings.paper_fee_bps,
            "atr_multiple_stop": 1.5,
            "source": "Yahoo Finance candles; TradingView scanner quotes; Google News RSS headlines",
            "not_a_recommendation": True,
        },
        "disclaimer": "Conditional research levels only. Not investment advice. Prices can gap through stops; costs and slippage can be worse than modelled.",
    }


def want_quote_meta(chart: dict, fallback: dict) -> dict:
    return chart.get("quote_meta") or fallback
