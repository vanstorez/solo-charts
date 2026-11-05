from datetime import datetime, timezone

import pytest

from app.db import get_db, reset_db_for_tests
from app.providers.economic_calendar import _normalise
from app.schemas import AlertRuleRequest, KillSwitchRequest
from app.services.alerts import create_rule, delete_rule, list_rules
from app.services.flows import _as_of, _summary
from app.services.news_intel import _attach_price_confirmation
from app.services.paper import get_risk_limits, update_kill_switch
from app.services.scenarios import _price_confirmation


def test_kill_switch_persists_and_audits(tmp_path):
    reset_db_for_tests(tmp_path / "kill.db")
    limits = update_kill_switch(KillSwitchRequest(engaged=True, reason="test stop"))
    assert limits["paper_kill_switch"] is True
    assert get_risk_limits()["paper_kill_switch"] is True
    assert get_db().verify_audit_chain() is True
    with get_db().connect() as connection:
        actions = [row["action"] for row in connection.execute("SELECT action FROM audit_log")]
    assert "risk.kill_switch.changed" in actions
    released = update_kill_switch(KillSwitchRequest(engaged=False, reason="test release"))
    assert released["paper_kill_switch"] is False


def test_alert_crud_and_duplicate_guard(tmp_path):
    reset_db_for_tests(tmp_path / "alerts.db")
    rule = create_rule(
        AlertRuleRequest(kind="price_above", symbol="BANKNIFTY", threshold=60_000, note="research")
    )
    assert rule["enabled"] is True
    assert rule["description"].startswith("BANKNIFTY")
    assert len(list_rules()) == 1
    with pytest.raises(ValueError, match="identical"):
        create_rule(AlertRuleRequest(kind="price_above", symbol="BANKNIFTY", threshold=60_000))
    deleted = delete_rule(rule["id"])
    assert deleted["deleted"] is True
    assert list_rules() == []
    assert get_db().verify_audit_chain() is True


def test_calendar_normalisation_marks_released_and_scheduled():
    now = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
    released = _normalise(
        {
            "id": "us-cpi",
            "title": "US CPI",
            "country": "US",
            "importance": 1,
            "date": "2026-10-27T11:30:00.000Z",
            "actual": "3.2",
            "forecast": "3.1",
            "previous": "3.0",
            "unit": "%",
        },
        now,
    )
    scheduled = _normalise(
        {
            "id": "rbi",
            "title": "RBI policy",
            "country": "IN",
            "importance": 0,
            "date": "2026-10-30T04:30:00.000Z",
        },
        now,
    )
    assert released["status"] == "released"
    assert released["importance_label"] == "high"
    assert released["actual"] == "3.2"
    assert scheduled["status"] == "scheduled"
    assert scheduled["importance_label"] == "medium"


def test_news_price_confirmation_flags_contradiction():
    events = [
        {
            "affected_assets": [
                {"symbol": "BANKNIFTY", "expected_direction": "down"},
                {"symbol": "BRENT", "expected_direction": "up"},
            ]
        }
    ]
    quotes = [
        {"key": "BANKNIFTY", "change": 1.25, "source": "TradingView scanner snapshot"},
        {"key": "BRENT", "change": 2.1, "source": "TradingView scanner snapshot"},
    ]
    _attach_price_confirmation(events, quotes, {"freshness": "unknown", "fetched_at": "2026-10-27T12:00:00+00:00"})
    confirmation = events[0]["price_confirmation"]
    assert confirmation["status"] == "contradicted"
    assert confirmation["assets"][0]["state"] == "contradicted"
    assert confirmation["assets"][1]["state"] == "confirmed"
    assert "not event-time reaction" in confirmation["note"]


def test_scenario_price_confirmation_rejects_headline_only_direction():
    pattern = {"close": 50_000, "e20": 49_000, "rsi": 62, "macd_hist": 15}
    bullish = _price_confirmation(pattern, {"change": 0.6}, "bullish")
    bearish = _price_confirmation(pattern, {"change": 0.6}, "bearish")
    neutral = _price_confirmation(pattern, {"change": 0.6}, "neutral")
    assert bullish["status"] == "confirmed"
    assert bullish["passed"] == 4
    assert bearish["status"] == "contradicted"
    assert neutral["status"] == "not_directional"


def test_flow_summary_and_date_parse():
    rows = [
        {"category": "FII/FPI", "net": 100.5, "buy": 500, "sell": 399.5, "unit": "INR crore"},
        {"category": "DII", "net": -50, "buy": 300, "sell": 350, "unit": "INR crore"},
    ]
    summary = _summary(rows)
    assert summary[0]["category"] == "FII / FPI"
    assert summary[0]["direction"] == "net buying"
    assert summary[1]["direction"] == "net selling"
    assert _as_of("27-Oct-2026") == datetime(2026, 10, 27, tzinfo=timezone.utc)
    assert _as_of("not-a-date") is None
