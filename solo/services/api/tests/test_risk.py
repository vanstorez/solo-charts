from app.db import reset_db_for_tests
from app.schemas import RiskSettingsUpdate
from app.services.paper import _drawdown_from_realized, get_risk_limits, update_risk_limits


def test_audit_hash_chain_detects_tampering(tmp_path):
    database = reset_db_for_tests(tmp_path / "audit.db")
    database.append_audit("test.one", {"value": 1})
    database.append_audit("test.two", {"value": 2})
    assert database.verify_audit_chain() is True
    with database.connect() as connection:
        connection.execute("UPDATE audit_log SET payload_json = '{\"value\":99}' WHERE id = 1")
    assert database.verify_audit_chain() is False


def test_risk_limits_update_is_persisted(tmp_path):
    reset_db_for_tests(tmp_path / "risk.db")
    update_risk_limits(RiskSettingsUpdate(max_trade_notional=123_456, paper_fee_bps=4))
    limits = get_risk_limits()
    assert limits["max_trade_notional"] == 123_456
    assert limits["paper_fee_bps"] == 4
    assert limits["live_execution_enabled"] is False


def test_drawdown_is_absolute_currency_not_percentage():
    assert _drawdown_from_realized([100, -50, -300, 200]) == 350
