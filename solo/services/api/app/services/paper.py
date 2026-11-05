import json
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from ..config import get_settings
from ..db import get_db
from ..provenance import unavailable_meta
from ..schemas import KillSwitchRequest, PaperOrderRequest, RiskSettingsUpdate
from ..timeutil import iso, utc_now
from .market import get_quote, get_quotes

IST = ZoneInfo("Asia/Kolkata")
RISK_FIELDS = [
    "max_open_positions",
    "max_trade_notional",
    "max_total_exposure",
    "daily_loss_limit",
    "max_drawdown",
    "paper_slippage_bps",
    "paper_fee_bps",
]


class PaperRejected(Exception):
    def __init__(self, reasons: list[str], detail: str = "Paper order rejected by a risk control.") -> None:
        super().__init__(detail)
        self.reasons = reasons


def get_risk_limits() -> dict:
    settings = get_settings()
    values = {field: getattr(settings, field) for field in RISK_FIELDS}
    overrides = get_db().get_settings_overrides()
    for field in RISK_FIELDS:
        if field in overrides and isinstance(overrides[field], (int, float)):
            values[field] = overrides[field]
    values["paper_kill_switch"] = bool(overrides.get("paper_kill_switch", False))
    values["live_execution_enabled"] = False
    values["requested_live_execution"] = bool(settings.live_execution_enabled)
    values["mode"] = "paper"
    values["source"] = "server configuration + local risk settings"
    return values


def update_risk_limits(update: RiskSettingsUpdate) -> dict:
    payload = update.model_dump(exclude_none=True)
    if not payload:
        return get_risk_limits()
    get_db().save_settings_overrides(payload)
    limits = get_risk_limits()
    get_db().append_audit("risk.settings.updated", {"changes": payload, "limits": limits})
    return limits


def update_kill_switch(update: KillSwitchRequest) -> dict:
    database = get_db()
    before = get_risk_limits()
    database.save_settings_overrides({"paper_kill_switch": update.engaged})
    limits = get_risk_limits()
    database.append_audit(
        "risk.kill_switch.changed",
        {
            "engaged": update.engaged,
            "reason": update.reason,
            "before": before,
            "after": limits,
        },
    )
    return limits


def _start_of_ist_day() -> datetime:
    now = utc_now().astimezone(IST)
    start = datetime.combine(now.date(), time.min, tzinfo=IST)
    return start.astimezone(timezone.utc)


def _drawdown_from_realized(pnls: list[float]) -> float:
    peak = 0.0
    running = 0.0
    worst = 0.0
    for pnl in pnls:
        running += pnl
        peak = max(peak, running)
        worst = max(worst, peak - running)
    return worst


def _limits_snapshot(
    *,
    limits: dict,
    open_count: int,
    exposure: float,
    day_pnl: float,
    drawdown: float,
    largest_notional: float,
) -> dict:
    checks = [
        {
            "key": "open_positions",
            "label": "Open positions",
            "used": open_count,
            "limit": limits["max_open_positions"],
            "state": "breach" if open_count > limits["max_open_positions"] else "ok",
        },
        {
            "key": "exposure",
            "label": "Gross exposure",
            "used": round(exposure, 2),
            "limit": limits["max_total_exposure"],
            "state": "breach" if exposure > limits["max_total_exposure"] else "ok",
        },
        {
            "key": "trade_notional",
            "label": "Largest position",
            "used": round(largest_notional, 2),
            "limit": limits["max_trade_notional"],
            "state": "breach" if largest_notional > limits["max_trade_notional"] else "ok",
        },
        {
            "key": "daily_pnl",
            "label": "Day P&L vs loss limit",
            "used": round(day_pnl, 2),
            "limit": -abs(limits["daily_loss_limit"]),
            "state": "breach" if day_pnl <= -abs(limits["daily_loss_limit"]) else "ok",
        },
        {
            "key": "drawdown",
            "label": "Realized drawdown",
            "used": round(drawdown, 2),
            "limit": limits["max_drawdown"],
            "state": "breach" if drawdown >= limits["max_drawdown"] else "ok",
        },
    ]
    return {
        "checks": checks,
        "blocked": any(check["state"] == "breach" for check in checks),
        "hard_block_reasons": [check["label"] for check in checks if check["state"] == "breach"],
    }


async def get_risk_snapshot() -> dict:
    database = get_db()
    limits = get_risk_limits()
    open_trades = database.list_trades("OPEN")
    symbols = sorted({trade["symbol"] for trade in open_trades})
    quotes, quote_meta = await get_quotes(symbols) if symbols else ([], unavailable_meta("TradingView scanner", "paper marks", "No open positions; no marks requested."))
    by_key = {quote["key"]: quote for quote in quotes}
    exposure = 0.0
    unrealized = 0.0
    largest_notional = 0.0
    marks = []
    for trade in open_trades:
        quote = by_key.get(trade["symbol"])
        mark = quote["value"] if quote and quote.get("value") is not None else trade["entry_price"]
        notional = abs(mark * trade["quantity"])
        exposure += notional
        largest_notional = max(largest_notional, notional)
        if trade["side"] == "BUY":
            gross = (mark - trade["entry_price"]) * trade["quantity"]
        else:
            gross = (trade["entry_price"] - mark) * trade["quantity"]
        net = gross - float(trade.get("entry_fee") or 0)
        unrealized += net
        marks.append(
            {
                "trade_id": trade["id"],
                "symbol": trade["symbol"],
                "mark": round(mark, 2),
                "notional": round(notional, 2),
                "unrealized_pnl": round(net, 2),
                "quote_source": quote.get("source") if quote else "entry_price_fallback",
                "quote_freshness": quote_meta.get("freshness") if quote_meta else "unknown",
            }
        )
    realized_today = database.closed_pnl_since(_start_of_ist_day())
    day_pnl = realized_today + unrealized
    drawdown = _drawdown_from_realized(database.all_closed_pnl())
    limit_snapshot = _limits_snapshot(
        limits=limits,
        open_count=len(open_trades),
        exposure=exposure,
        day_pnl=day_pnl,
        drawdown=drawdown,
        largest_notional=largest_notional,
    )
    return {
        "mode": "paper",
        "live_execution_enabled": False,
        "kill_switch": bool(limits.get("paper_kill_switch")),
        "limits": limits,
        "limit_checks": limit_snapshot,
        "open_positions": len(open_trades),
        "gross_exposure": round(exposure, 2),
        "unrealized_pnl": round(unrealized, 2),
        "realized_pnl_today": round(realized_today, 2),
        "day_pnl": round(day_pnl, 2),
        "realized_drawdown": round(drawdown, 2),
        "marks": marks,
        "quote_meta": quote_meta,
        "audit_chain_valid": database.verify_audit_chain(),
        "warnings": [
            "Paper marks are provider snapshots and may be delayed.",
            "No order is routed to a broker. Live execution is hard-disabled in this build.",
        ],
        "as_of": iso(utc_now()),
    }


async def open_paper_trade(order: PaperOrderRequest) -> dict:
    database = get_db()
    limits = get_risk_limits()
    quote, quote_meta = await get_quote(order.symbol)
    reasons = []
    if limits.get("paper_kill_switch"):
        reasons.append("The paper kill switch is engaged. New simulated risk is blocked.")
    if not quote or quote.get("value") is None:
        reasons.append("No executable research mark is available for this symbol.")
    if get_settings().live_execution_enabled:
        reasons.append("Live execution was requested by configuration but is blocked by this build.")
    if quote and quote.get("value") is not None:
        price = float(quote["value"])
        slippage = limits["paper_slippage_bps"] / 10_000
        fill = price * (1 + slippage) if order.side == "BUY" else price * (1 - slippage)
        notional = fill * order.quantity
        if notional > limits["max_trade_notional"]:
            reasons.append(f"Trade notional {notional:,.0f} exceeds the {limits['max_trade_notional']:,.0f} limit.")
        open_trades = database.list_trades("OPEN")
        if len(open_trades) >= limits["max_open_positions"]:
            reasons.append(f"Maximum open positions ({limits['max_open_positions']}) already reached.")
        if any(trade["symbol"] == quote["key"] for trade in open_trades):
            reasons.append(f"An open paper position already exists for {quote['key']}; duplicate exposure is blocked.")
        total_exposure = sum(
            abs(float(trade["entry_price"]) * int(trade["quantity"])) for trade in open_trades
        ) + notional
        if total_exposure > limits["max_total_exposure"]:
            reasons.append(f"Resulting gross exposure {total_exposure:,.0f} exceeds the {limits['max_total_exposure']:,.0f} limit.")
        if order.stop_loss is not None:
            if order.side == "BUY" and order.stop_loss >= fill:
                reasons.append("A long stop-loss must be below the simulated fill.")
            if order.side == "SELL" and order.stop_loss <= fill:
                reasons.append("A short stop-loss must be above the simulated fill.")
        if order.take_profit is not None:
            if order.side == "BUY" and order.take_profit <= fill:
                reasons.append("A long take-profit must be above the simulated fill.")
            if order.side == "SELL" and order.take_profit >= fill:
                reasons.append("A short take-profit must be below the simulated fill.")
        realized_today = database.closed_pnl_since(_start_of_ist_day())
        unrealized = 0.0
        for trade in open_trades:
            trade_quote, _ = await get_quote(trade["symbol"])
            mark = trade_quote["value"] if trade_quote and trade_quote.get("value") is not None else trade["entry_price"]
            if trade["side"] == "BUY":
                unrealized += (mark - trade["entry_price"]) * trade["quantity"] - float(trade.get("entry_fee") or 0)
            else:
                unrealized += (trade["entry_price"] - mark) * trade["quantity"] - float(trade.get("entry_fee") or 0)
        if realized_today + unrealized <= -abs(limits["daily_loss_limit"]):
            reasons.append("Daily loss limit is already breached; new paper risk is blocked.")
        drawdown = _drawdown_from_realized(database.all_closed_pnl())
        if drawdown >= limits["max_drawdown"]:
            reasons.append("Maximum realized drawdown limit is breached; new paper risk is blocked.")
    else:
        fill = None
        notional = 0
    if reasons:
        database.append_audit(
            "paper.order.rejected",
            {"order": order.model_dump(), "reasons": reasons, "quote_meta": quote_meta},
        )
        raise PaperRejected(reasons)
    fee = fill * order.quantity * limits["paper_fee_bps"] / 10_000
    risk_snapshot = {
        "limits": limits,
        "notional": round(notional, 2),
        "quote_meta": quote_meta,
        "quote_source": quote.get("source") if quote else None,
        "live_execution_enabled": False,
    }
    trade = database.create_trade(
        {
            "symbol": quote["key"],
            "side": order.side,
            "quantity": order.quantity,
            "entry_price": round(fill, 2),
            "entry_at": iso(utc_now()),
            "status": "OPEN",
            "stop_loss": order.stop_loss,
            "take_profit": order.take_profit,
            "entry_fee": round(fee, 2),
            "notes": order.notes,
            "quote_source": quote.get("source"),
            "risk_snapshot_json": json.dumps(risk_snapshot, default=str),
        }
    )
    database.append_audit(
        "paper.order.opened",
        {
            "trade_id": trade["id"],
            "symbol": trade["symbol"],
            "side": trade["side"],
            "quantity": trade["quantity"],
            "entry_price": trade["entry_price"],
            "fees": trade["entry_fee"],
            "risk": risk_snapshot,
        },
    )
    return {
        "trade": trade,
        "simulated_fill": round(fill, 2),
        "notional": round(notional, 2),
        "fees": round(fee, 2),
        "quote_meta": quote_meta,
        "risk": await get_risk_snapshot(),
        "warnings": [
            "This is a simulated paper fill, not a broker execution.",
            "Slippage and fees are assumptions; real fills can be worse.",
        ],
    }


async def close_paper_trade(trade_id: int) -> dict:
    database = get_db()
    trade = database.get_trade(trade_id)
    if not trade:
        raise ValueError("Paper trade not found.")
    if trade["status"] != "OPEN":
        raise ValueError("Paper trade is already closed.")
    quote, quote_meta = await get_quote(trade["symbol"])
    if not quote or quote.get("value") is None:
        raise ValueError("No current research mark is available; close is blocked rather than filled with a fabricated price.")
    limits = get_risk_limits()
    slippage = limits["paper_slippage_bps"] / 10_000
    price = float(quote["value"])
    exit_fill = price * (1 - slippage) if trade["side"] == "BUY" else price * (1 + slippage)
    gross = (
        (exit_fill - trade["entry_price"]) * trade["quantity"]
        if trade["side"] == "BUY"
        else (trade["entry_price"] - exit_fill) * trade["quantity"]
    )
    exit_fee = exit_fill * trade["quantity"] * limits["paper_fee_bps"] / 10_000
    net = gross - float(trade.get("entry_fee") or 0) - exit_fee
    updated = database.close_trade(
        trade_id,
        {
            "exit_price": round(exit_fill, 2),
            "exit_at": iso(utc_now()),
            "status": "CLOSED",
            "exit_fee": round(exit_fee, 2),
            "realized_pnl": round(net, 2),
            "exit_quote_source": quote.get("source"),
        },
    )
    database.append_audit(
        "paper.order.closed",
        {
            "trade_id": trade_id,
            "symbol": trade["symbol"],
            "side": trade["side"],
            "entry_price": trade["entry_price"],
            "exit_price": round(exit_fill, 2),
            "gross_pnl": round(gross, 2),
            "fees": round(float(trade.get("entry_fee") or 0) + exit_fee, 2),
            "realized_pnl": round(net, 2),
            "quote_meta": quote_meta,
        },
    )
    return {
        "trade": updated,
        "gross_pnl": round(gross, 2),
        "fees": round(float(trade.get("entry_fee") or 0) + exit_fee, 2),
        "realized_pnl": round(net, 2),
        "quote_meta": quote_meta,
        "risk": await get_risk_snapshot(),
        "warnings": ["Paper exit only. No broker order was transmitted."],
    }


def get_trades(status: str | None = "ALL") -> list[dict]:
    normalized = None if not status or status.upper() == "ALL" else status.upper()
    if normalized not in {None, "OPEN", "CLOSED"}:
        normalized = None
    return get_db().list_trades(normalized)


def get_audit(limit: int = 100) -> dict:
    database = get_db()
    return {
        "entries": database.audit_log(limit),
        "chain_valid": database.verify_audit_chain(),
        "note": "Local SHA-256 hash chain. It detects accidental or casual tampering, not a hostile administrator with database access.",
    }
