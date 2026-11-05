import asyncio
from datetime import datetime, timezone

from ..indicators import pearson, pct_change, round_values
from ..provenance import feed_meta, unavailable_meta
from ..providers import yahoo
from ..timeutil import iso, utc_now
from .flows import get_flows
from .market import get_quotes

GROUPS = [
    {
        "key": "currency",
        "label": "Currency & rupee",
        "keys": ["USDINR", "DXY"],
        "context": "USD/INR and the dollar index can transmit imported inflation and foreign-flow pressure.",
    },
    {
        "key": "rates",
        "label": "Rates & policy",
        "keys": ["US10Y", "INDIAVIX"],
        "context": "US yields and volatility influence global risk appetite; India VIX is the local fear gauge.",
    },
    {
        "key": "energy_metals",
        "label": "Energy & metals",
        "keys": ["BRENT", "WTI", "GOLD", "SILVER"],
        "context": "Crude matters for India's import bill; gold and silver can reflect safe-haven and real-rate conditions.",
    },
    {
        "key": "global_equities",
        "label": "Global equities",
        "keys": ["SPX", "NDX", "DJI"],
        "context": "US equity direction is a risk-sentiment input, not a deterministic Bank Nifty signal.",
    },
    {
        "key": "offshore",
        "label": "GIFT City / offshore",
        "keys": ["GIFT"],
        "context": "GIFT Nifty is an offshore pre-market sentiment input. A quote snapshot is not an executable NSE price.",
    },
]

CORRELATION_SYMBOLS = {
    "NIFTY": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
    "USDINR": "INR=X",
    "BRENT": "BZ=F",
    "DXY": "DX-Y.NYB",
    "US10Y": "^TNX",
    "GOLD": "GC=F",
}


def _date_key(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).date().isoformat()


async def _daily_closes(symbol: str) -> dict[str, float]:
    data = await yahoo.chart(symbol, "1d", "1y", ttl=900)
    return {_date_key(bar["t"]): float(bar["c"]) for bar in data.get("bars") or [] if bar.get("c") is not None}


async def _correlations() -> tuple[dict, dict]:
    try:
        results = await asyncio.gather(*(_daily_closes(symbol) for symbol in CORRELATION_SYMBOLS.values()))
    except Exception as exc:
        return {}, unavailable_meta("Yahoo Finance", "90-session correlations", f"Correlation history unavailable: {str(exc)[:240]}")
    series = dict(zip(CORRELATION_SYMBOLS.keys(), results))
    bank_dates = sorted(set(series.get("BANKNIFTY", {})) & set(series.get("NIFTY", {})))
    # Limit to the most recent 90 common sessions.
    bank_dates = bank_dates[-91:]
    bank_values = [series["BANKNIFTY"][date] for date in bank_dates]
    bank_returns = pct_change(bank_values)
    out = {}
    for key, values in series.items():
        if key == "BANKNIFTY":
            continue
        dates = [date for date in bank_dates if date in values]
        if len(dates) < 20:
            out[key] = {"correlation": None, "sample": 0, "state": "insufficient_data"}
            continue
        aligned = [values[date] for date in dates]
        aligned_returns = pct_change(aligned)
        bank_aligned = [series["BANKNIFTY"][date] for date in dates]
        bank_aligned_returns = pct_change(bank_aligned)
        size = min(len(aligned_returns), len(bank_aligned_returns))
        corr = pearson(bank_aligned_returns[-size:], aligned_returns[-size:])
        out[key] = {
            "correlation": round_values(corr, 3),
            "sample": size,
            "state": "estimated" if corr is not None else "insufficient_variance",
            "window": f"{len(dates)} sessions",
            "note": "Descriptive historical correlation; regime-dependent and not causal.",
        }
    meta = feed_meta(
        "Yahoo Finance",
        "daily log-return correlations",
        as_of=datetime.fromisoformat(bank_dates[-1]).replace(tzinfo=timezone.utc) if bank_dates else utc_now(),
        source_type="eod",
        status="ok",
        detail=f"Latest {len(bank_dates)} common daily sessions. Correlations are descriptive, not predictive.",
        fresh_after=86_400,
        stale_after=7 * 86_400,
    )
    return out, meta


def _transmission_notes(quotes: list[dict], correlations: dict | None = None, flows: dict | None = None) -> list[dict]:
    by_key = {quote["key"]: quote for quote in quotes}
    correlations = correlations or {}

    def change(key: str) -> float | None:
        value = by_key.get(key, {}).get("change")
        return float(value) if value is not None else None

    def correlation_suffix(*keys: str) -> str:
        parts = []
        for key in keys:
            entry = correlations.get(key) or {}
            value = entry.get("correlation")
            sample = entry.get("sample")
            if value is not None and sample:
                parts.append(f"{key} {value:+.2f} (n={sample})")
        if not parts:
            return ""
        return f" Descriptive 90-session correlations with Bank Nifty: {', '.join(parts)}; not causal."

    notes = []
    usdinr = change("USDINR")
    if usdinr is not None and abs(usdinr) >= 0.15:
        direction = "weaker rupee / higher USD-INR" if usdinr > 0 else "stronger rupee / lower USD-INR"
        notes.append(
            {
                "channel": "Rupee",
                "observation": f"USD/INR moved {usdinr:+.2f}% in the latest provider snapshot ({direction}).{correlation_suffix('USDINR')}",
                "watch": "A weaker rupee raises imported-cost pressure and can influence foreign-flow sentiment.",
                "effect": "May pressure imported inflation and foreign-flow sentiment; rate-sensitive bank stocks can be affected, but the sign is not automatic.",
                "confirm": "Watch whether USD/INR sustains the move while Bank Nifty underperforms Nifty and foreign-flow headlines turn cautious.",
                "invalidate": "A reversal in USD/INR or Bank Nifty outperforming Nifty would weaken this transmission story.",
                "confidence": "low",
            }
        )
    brent = change("BRENT")
    if brent is not None and abs(brent) >= 1.5:
        notes.append(
            {
                "channel": "Crude",
                "observation": f"Brent moved {brent:+.2f}% in the latest provider snapshot.{correlation_suffix('BRENT')}",
                "watch": "Large crude moves can affect India's import bill, inflation expectations and oil-sensitive sectors.",
                "effect": "A sharp rise may tighten India's import bill and inflation expectations, with a possible negative read-through for banks; a fall may relieve pressure. Both are conditional.",
                "confirm": "Watch Brent follow-through plus USD/INR and India 10-year yield direction; index confirmation needs price, not just the headline.",
                "invalidate": "A crude move that reverses intraday or fails to move the rupee/yields is weak transmission evidence.",
                "confidence": "low",
            }
        )
    dxy = change("DXY")
    us10y = change("US10Y")
    if (dxy is not None and dxy > 0.2) or (us10y is not None and us10y > 0.8):
        firm = []
        if dxy is not None and dxy > 0.2:
            firm.append(f"the dollar is firmer at {dxy:+.2f}%")
        if us10y is not None and us10y > 0.8:
            firm.append(f"the US 10-year yield is firmer at {us10y:+.2f}%")
        notes.append(
            {
                "channel": "Global financial conditions",
                "observation": f"{'; '.join(firm)}.{correlation_suffix('DXY', 'US10Y')}",
                "watch": "Firmer US rates and dollar can tighten global risk appetite; the transmission is regime-dependent.",
                "effect": "May reduce the appeal of emerging-market risk and weigh on foreign flows into Indian equities, including banks. The effect on Bank Nifty can be offset by domestic flows.",
                "confirm": "Confirm with a firmer dollar/yield, INR weakness and broad Indian equity risk-off, not a single variable.",
                "invalidate": "A falling dollar/yield or resilient domestic flows would invalidate the risk-off transmission claim.",
                "confidence": "low",
            }
        )
    vix = by_key.get("INDIAVIX", {}).get("value")
    if vix is not None and vix >= 20:
        notes.append(
            {
                "channel": "Volatility",
                "observation": f"India VIX is elevated at {vix:.2f}.",
                "watch": "Elevated volatility widens option risk and can make short-premium strategies fragile.",
                "effect": "Raises the cost of options and the risk of whipsaw; it does not by itself predict direction.",
                "confirm": "Watch whether VIX continues rising alongside widening index ranges and weaker breadth.",
                "invalidate": "Falling VIX with improving breadth would argue against a persistent risk-off regime.",
                "confidence": "low",
            }
        )
    if flows and flows.get("available") and flows.get("summary"):
        parts = [f"{item['category']} {item['direction']} ₹{abs(item['net']):,.2f} crore" for item in flows["summary"]]
        notes.append(
            {
                "channel": "Institutional cash flows",
                "observation": f"NSE provisional cash-market flows: {'; '.join(parts)} (trade date {flows.get('reported_date') or 'unknown'}).",
                "watch": "FII and DII flows can offset each other; a single day is not a trend and cash-market flows are not derivatives positioning.",
                "effect": "Sustained foreign selling can pressure large banks and index sentiment; domestic buying can absorb it. The net effect on Bank Nifty depends on magnitude, positioning and price response.",
                "confirm": "Confirm with several sessions of the same direction and a price/breadth response, not one provisional print.",
                "invalidate": "Opposite flows on the next session, or flows that do not move prices, invalidate a simple flow narrative.",
                "confidence": "low",
            }
        )
    if not notes:
        notes.append(
            {
                "channel": "No high-amplitude macro trigger",
                "observation": "The monitored macro moves are below the display thresholds.",
                "watch": "Absence of a macro trigger is not evidence of a safe market.",
                "effect": "No transmission path is asserted from the monitored snapshot.",
                "confirm": "A larger move across correlated variables plus a price response would create a reviewable transmission path.",
                "invalidate": "The absence of a trigger itself does not invalidate anything; it means the desk has no current macro narrative.",
                "confidence": "low",
            }
        )
    return notes


def _risk_regime(quotes: list[dict]) -> dict:
    by_key = {quote["key"]: quote for quote in quotes}
    score = 0.0
    contributors = []
    for key, weight in [("NIFTY", 1), ("SPX", 1), ("INDIAVIX", -0.6), ("USDINR", -0.4), ("DXY", -0.3), ("BRENT", -0.2)]:
        change = by_key.get(key, {}).get("change")
        if change is None:
            continue
        contribution = max(-2.0, min(2.0, float(change))) * weight
        score += contribution
        contributors.append({"key": key, "change": round(float(change), 2), "weight": weight})
    if score >= 0.75:
        label = "risk-on tilt"
    elif score <= -0.75:
        label = "risk-off tilt"
    else:
        label = "mixed / no clear tilt"
    return {
        "label": label,
        "score": round(score, 2),
        "contributors": contributors,
        "note": "Heuristic snapshot of monitored price changes, not a forecast or probability.",
    }


async def get_macro(include_correlations: bool = True) -> dict:
    all_keys = sorted({key for group in GROUPS for key in group["keys"]} | {"BANKNIFTY", "NIFTY", "SPX"})
    (quotes, quote_meta), flows, correlation_result = await asyncio.gather(
        get_quotes(all_keys),
        get_flows(),
        _correlations() if include_correlations else asyncio.sleep(
            0,
            result=({}, unavailable_meta("Yahoo Finance", "correlations", "Disabled for this request.")),
        ),
    )
    correlations, correlation_meta = correlation_result
    by_key = {quote["key"]: quote for quote in quotes}
    groups = [
        {
            **group,
            "instruments": [by_key[key] for key in group["keys"] if key in by_key],
        }
        for group in GROUPS
    ]
    return {
        "groups": groups,
        "quotes": quotes,
        "correlations": correlations,
        "correlation_meta": correlation_meta,
        "risk_regime": _risk_regime(quotes),
        "transmission_notes": _transmission_notes(quotes, correlations, flows),
        "flows": flows,
        "macro_meta": quote_meta,
        "as_of": utc_now().isoformat(),
        "note": "Global macro context only. No single macro variable determines Bank Nifty direction.",
    }
