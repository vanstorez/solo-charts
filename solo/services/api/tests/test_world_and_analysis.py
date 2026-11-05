from datetime import timezone

from app.indicators import (
    detect_fair_value_gaps,
    find_swings,
    market_structure,
    parabolic_sar,
    resample_bars,
)
from app.providers import binance
from app.providers import yahoo
from app.services import world


def _bar(t: int, open_: float, high: float, low: float, close: float, volume: float = 1) -> dict:
    return {"t": t, "o": open_, "h": high, "l": low, "c": close, "v": volume}


def test_world_catalog_has_unique_keys_and_streams():
    keys = [item["key"] for item in world.ALL_INSTRUMENTS]
    assert len(keys) == len(set(keys))
    assert len(world.INDICES) >= 30
    assert len(world.FX) >= 10
    assert len(world.COMMODITIES) >= 10
    assert len(binance.STREAM_SYMBOLS) >= 10
    assert binance.stream_url(["BTCUSDT"]).endswith("btcusdt@miniTicker")


def test_binance_ticker_and_stream_parsing():
    ticker = binance.parse_ticker(
        {
            "symbol": "BTCUSDT",
            "lastPrice": "80640.41",
            "openPrice": "79855.80",
            "highPrice": "80704.86",
            "lowPrice": "79506.00",
            "volume": "12632.94",
            "quoteVolume": "1011705283.23",
            "closeTime": 1793118963004,
        }
    )
    assert ticker is not None
    assert ticker["price"] == 80640.41
    assert ticker["change"] > 0
    assert ticker["as_of"].tzinfo == timezone.utc

    stream = binance.parse_stream_message(
        {
            "stream": "btcusdt@miniTicker",
            "data": {
                "e": "24hrMiniTicker",
                "E": 1793118963004,
                "s": "BTCUSDT",
                "c": "80640.41",
                "o": "79855.80",
                "h": "80704.86",
                "l": "79506.00",
                "v": "12632.94",
                "q": "1011705283.23",
            },
        }
    )
    assert stream is not None
    assert stream["symbol"] == "BTCUSDT"
    assert stream["price"] == 80640.41


def test_yahoo_snapshot_can_use_metadata_without_candles(monkeypatch):
    payload = {
        "chart": {
            "result": [
                {
                    "meta": {
                        "symbol": "^MERV",
                        "shortName": "MERVAL",
                        "currency": "ARS",
                        "exchangeName": "BUE",
                        "regularMarketPrice": 2848945.2,
                        "regularMarketTime": 1793118963,
                        "regularMarketChangePercent": 1.25,
                        "chartPreviousClose": 2813750.0,
                    },
                    "timestamp": [],
                    "indicators": {"quote": [{}]},
                }
            ],
            "error": None,
        }
    }

    async def fake_fetch(*args, **kwargs):
        return payload

    monkeypatch.setattr(yahoo, "fetch_json", fake_fetch)
    import asyncio

    snapshot = asyncio.run(yahoo.snapshot("^MERV"))
    assert snapshot["value"] == 2848945.2
    assert snapshot["change"] == 1.25
    assert snapshot["as_of"].tzinfo == timezone.utc


def test_find_swings_excludes_the_candidate_bar():
    bars = [
        _bar(1, 100, 101, 99, 100),
        _bar(2, 100, 102, 99, 101),
        _bar(3, 101, 103, 100, 102),
        _bar(4, 102, 110, 101, 109),
        _bar(5, 109, 108, 100, 103),
        _bar(6, 103, 104, 99, 102),
        _bar(7, 102, 103, 98, 100),
    ]
    swings = find_swings(bars, 2, 2)
    highs = [swing for swing in swings if swing["kind"] == "high"]
    assert any(swing["index"] == 3 and swing["price"] == 110 for swing in highs)


def test_market_structure_bos_and_choch():
    bars = [
        _bar(1, 100, 101, 95, 99),
        _bar(2, 99, 100, 94, 98),
        _bar(3, 100, 103, 99, 102),
        _bar(4, 102, 108, 101, 107),
        _bar(5, 105, 106, 102, 104),
        _bar(6, 104, 107, 103, 106),
        _bar(7, 104, 105, 96, 98),
    ]
    swings = [
        {"index": 2, "t": 2000, "price": 103, "kind": "high", "confirmed_at": 4},
        {"index": 3, "t": 3000, "price": 101, "kind": "low", "confirmed_at": 5},
    ]
    result = market_structure(bars, swings)
    assert len(result["events"]) >= 2
    assert result["events"][0]["direction"] == "bullish"
    assert result["events"][0]["type"] == "BOS"
    assert result["events"][-1]["direction"] == "bearish"
    assert result["events"][-1]["type"] == "CHoCH"


def test_fair_value_gap_and_sar_and_resample():
    bars = [
        _bar(1, 98, 100, 95, 99),
        _bar(2, 99, 103, 98, 102),
        _bar(3, 103, 108, 102, 107),
        _bar(4, 107, 109, 105, 106),
    ]
    gaps = detect_fair_value_gaps(bars, [2, 2, 2, 2])
    assert len(gaps) == 2
    assert gaps[0]["side"] == "bullish"
    assert gaps[0]["top"] == 102
    assert gaps[0]["bottom"] == 100
    assert gaps[1]["top"] == 105
    assert gaps[1]["bottom"] == 103

    sar = parabolic_sar(bars)
    assert sar[0] is None
    assert sar[-1] is not None
    assert sar[-1]["trend"] in {"bullish", "bearish"}

    hourly = [_bar(index * 3_600_000, 100, 102, 99, 101) for index in range(4)]
    four_hour = resample_bars(hourly, 4)
    assert len(four_hour) == 1
    assert four_hour[0]["h"] == 102
    assert four_hour[0]["l"] == 99
