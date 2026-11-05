from datetime import timezone
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.providers import globaldatafeeds as gdf
from app.providers.http import ProviderError


def test_parse_limitation_normalises_delay_and_functions():
    payload = {
        "Enabled": True,
        "ExpirationDate": 1727720999000,
        "AllowedExchanges": [
            {"ExchangeName": "NSE_IDX", "DataDelay": 0, "AllowedInstruments": -1},
            {"ExchangeName": "BSE_IDX", "DataDelay": 15, "AllowedInstruments": 50},
        ],
        "AllowedFunctions": [
            {"FunctionName": "GetLastQuoteArray", "IsEnabled": True},
            {"FunctionName": "GetHistory", "IsEnabled": True},
        ],
    }
    parsed = gdf.parse_limitation(payload)
    assert parsed["enabled"] is True
    assert parsed["expires_at"].startswith("2024-09-30T")
    assert parsed["exchanges"][0]["data_delay_seconds"] == 0
    assert parsed["exchanges"][1]["data_delay_seconds"] == 15
    assert parsed["functions"][0] == {"name": "GetLastQuoteArray", "enabled": True}


def test_parse_quote_uses_last_trade_time_and_previous_close():
    parsed = gdf.parse_quote(
        {
            "EXCHANGE": "NSE_IDX",
            "INSTRUMENTIDENTIFIER": "NIFTY",
            "LASTTRADEPRICE": 24_850.5,
            "CLOSE": 24_700.0,
            "TOTALQTYTRADED": 123,
            "LASTTRADETIME": 1724220139000,
            "BUYPRICE": 24_849.9,
            "SELLPRICE": 24_851.0,
        }
    )
    assert parsed is not None
    assert parsed["identifier"] == "NIFTY"
    assert parsed["value"] == 24_850.5
    assert parsed["previous_close"] == 24_700.0
    assert parsed["change"] == pytest.approx(0.6093, abs=0.0002)
    assert parsed["as_of"].tzinfo == timezone.utc
    assert parsed["bid"] == 24_849.9
    assert parsed["ask"] == 24_851.0


def test_parse_history_dedupes_and_sorts_bars():
    payload = {
        "OHLC": [
            {
                "LASTTRADETIME": 1724220000000,
                "OPEN": 100,
                "HIGH": 102,
                "LOW": 99,
                "CLOSE": 101,
                "TRADEDQTY": 12,
            },
            {
                "LASTTRADETIME": 1724219940000,
                "OPEN": 99,
                "HIGH": 101,
                "LOW": 98,
                "CLOSE": 100,
                "TRADEDQTY": 8,
            },
            {
                "LASTTRADETIME": 1724220000000,
                "OPEN": 100,
                "HIGH": 103,
                "LOW": 99,
                "CLOSE": 102,
                "TRADEDQTY": 20,
            },
        ]
    }
    bars = gdf.parse_history(payload)
    assert len(bars) == 2
    assert [bar["t"] for bar in bars] == [1724219940000, 1724220000000]
    assert bars[-1]["c"] == 102
    assert bars[-1]["v"] == 20


def test_parse_history_fails_closed_on_tick_payload():
    with pytest.raises(ProviderError, match="ticks instead of OHLC"):
        gdf.parse_history({"TICK": [{"LASTTRADEPRICE": 100}]})


def test_status_without_credentials_is_not_configured(monkeypatch):
    monkeypatch.setattr(
        gdf,
        "_settings",
        lambda: SimpleNamespace(
            gdf_enabled=True,
            gdf_base_url="http://example.invalid:4532/",
            gdf_api_key=SecretStr(""),
            gdf_request_timeout_seconds=1,
            gdf_quote_ttl_seconds=1,
            gdf_history_ttl_seconds=1,
            gdf_history_max=100,
        ),
    )
    status = gdf.status()
    assert status["configured"] is False
    assert status["state"] == "not_configured"
    assert status["has_api_key"] is False
    assert "never in source control" in status["detail"]


def test_redaction_removes_access_key(monkeypatch):
    monkeypatch.setattr(
        gdf,
        "_settings",
        lambda: SimpleNamespace(
            gdf_enabled=True,
            gdf_base_url="http://example.invalid:4532/",
            gdf_api_key=SecretStr("super-secret-key"),
            gdf_request_timeout_seconds=1,
            gdf_quote_ttl_seconds=1,
            gdf_history_ttl_seconds=1,
            gdf_history_max=100,
        ),
    )
    text = gdf._redact("GET http://example.invalid:4532/GetLastQuoteArray/?accessKey=super-secret-key failed")
    assert "super-secret-key" not in text
    assert "[redacted]" in text
