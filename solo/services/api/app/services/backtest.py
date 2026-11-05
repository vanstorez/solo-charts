from datetime import datetime, timezone

from ..indicators import ema, max_drawdown, round_values
from ..schemas import BacktestRequest
from ..timeutil import iso, utc_now
from .market import get_chart


def _date(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).date().isoformat()


def _metrics(trades: list[dict], equity_curve: list[dict], initial_capital: float) -> dict:
    wins = [trade for trade in trades if trade["pnl"] > 0]
    losses = [trade for trade in trades if trade["pnl"] < 0]
    gross_profit = sum(trade["pnl"] for trade in wins)
    gross_loss = abs(sum(trade["pnl"] for trade in losses))
    final_equity = equity_curve[-1]["equity"] if equity_curve else initial_capital
    equity_values = [initial_capital] + [point["equity"] for point in equity_curve]
    return {
        "trades": len(trades),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 2) if trades else None,
        "average_win": round(gross_profit / len(wins), 2) if wins else None,
        "average_loss": round(-gross_loss / len(losses), 2) if losses else None,
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss else None,
        "expectancy_per_trade": round(sum(trade["pnl"] for trade in trades) / len(trades), 2) if trades else None,
        "total_pnl": round(final_equity - initial_capital, 2),
        "total_return_pct": round((final_equity / initial_capital - 1) * 100, 2),
        "max_drawdown": max_drawdown(equity_values),
        "final_equity": round(final_equity, 2),
        "total_costs": round(sum(trade["costs"] for trade in trades), 2),
        "sharpe": None,
        "sharpe_note": "Not reported from a small number of closed trades; it would imply false precision.",
    }


def run_ema_backtest(request: BacktestRequest) -> dict:
    return _run_ema_backtest_sync(request)


async def run_ema_backtest_async(request: BacktestRequest) -> dict:
    chart = None
    try:
        chart = await get_chart(request.symbol, "1d", request.range)
    except Exception as exc:
        return {
            "available": False,
            "reason": f"Historical candles are unavailable: {str(exc)[:240]}",
            "generated_at": iso(utc_now()),
        }
    return _simulate(chart, request)


def _run_ema_backtest_sync(request: BacktestRequest) -> dict:
    import asyncio

    try:
        chart = asyncio.run(get_chart(request.symbol, "1d", request.range))
    except Exception as exc:
        return {
            "available": False,
            "reason": f"Historical candles are unavailable: {str(exc)[:240]}",
            "generated_at": iso(utc_now()),
        }
    return _simulate(chart, request)


def _simulate(chart: dict, request: BacktestRequest) -> dict:
    bars = chart["bars"]
    if len(bars) < request.slow + 5:
        return {
            "available": False,
            "reason": f"Need at least {request.slow + 5} candles; received {len(bars)}.",
            "meta": chart["meta"],
            "generated_at": iso(utc_now()),
        }
    closes = [bar["c"] for bar in bars]
    fast = ema(closes, request.fast)
    slow = ema(closes, request.slow)
    trades = []
    equity = request.initial_capital
    position = None
    for index in range(max(request.slow, 1), len(bars) - 1):
        if fast[index] is None or slow[index] is None or fast[index - 1] is None or slow[index - 1] is None:
            continue
        signal = fast[index] > slow[index]
        previous_signal = fast[index - 1] > slow[index - 1]
        execution_bar = bars[index + 1]
        if position is None and signal and not previous_signal:
            fill = execution_bar["o"] * (1 + request.cost_bps / 10_000)
            quantity = equity / fill
            position = {
                "entry_index": index + 1,
                "entry_at": execution_bar["t"],
                "entry": fill,
                "quantity": quantity,
                "equity_before": equity,
            }
        elif position is not None and not signal and previous_signal:
            exit_fill = execution_bar["o"] * (1 - request.cost_bps / 10_000)
            gross = (exit_fill - position["entry"]) * position["quantity"]
            costs = (position["entry"] + exit_fill) * position["quantity"] * request.cost_bps / 10_000
            pnl = gross
            equity = position["equity_before"] + pnl
            trades.append(
                {
                    "entry_at": iso(datetime.fromtimestamp(position["entry_at"] / 1000, timezone.utc)),
                    "exit_at": iso(datetime.fromtimestamp(execution_bar["t"] / 1000, timezone.utc)),
                    "entry_date": _date(position["entry_at"]),
                    "exit_date": _date(execution_bar["t"]),
                    "entry": round(position["entry"], 2),
                    "exit": round(exit_fill, 2),
                    "quantity": round(position["quantity"], 4),
                    "pnl": round(pnl, 2),
                    "return_pct": round((exit_fill / position["entry"] - 1) * 100, 2),
                    "costs": round(costs, 2),
                    "bars_held": index + 1 - position["entry_index"],
                }
            )
            position = None
    open_position = None
    if position is not None:
        last = bars[-1]
        mark = last["c"]
        gross = (mark - position["entry"]) * position["quantity"]
        open_position = {
            "entry_at": iso(datetime.fromtimestamp(position["entry_at"] / 1000, timezone.utc)),
            "entry": round(position["entry"], 2),
            "mark": round(mark, 2),
            "quantity": round(position["quantity"], 4),
            "unrealized_pnl": round(gross, 2),
            "note": "Open at the end of the sample; not included in closed-trade equity metrics.",
        }
    equity_curve = [{"date": chart["bars"][max(request.slow, 0)]["t"], "equity": request.initial_capital}]
    running = request.initial_capital
    for trade in trades:
        running += trade["pnl"]
        exit_ms = int(datetime.fromisoformat(trade["exit_at"]).timestamp() * 1000)
        equity_curve.append({"date": exit_ms, "equity": round(running, 2)})
    metrics = _metrics(trades, equity_curve, request.initial_capital)
    return {
        "available": True,
        "strategy": {
            "name": f"EMA {request.fast}/{request.slow} long-only",
            "symbol": chart["symbol"],
            "name_label": chart["name"],
            "range": request.range,
            "execution": "Signal on daily close; enter or exit at the next session open. No shorting.",
            "cost_bps_per_side": request.cost_bps,
            "initial_capital": request.initial_capital,
            "caveat": "All-in fractional position sizing is a research simplification. It ignores lot sizes, margin, taxes, impact and borrow constraints.",
        },
        "metrics": metrics,
        "trades": trades[-100:],
        "open_position": open_position,
        "equity_curve": [
            {
                "date": datetime.fromtimestamp(point["date"] / 1000, timezone.utc).date().isoformat()
                if point["date"] > 10_000_000_000
                else point["date"],
                "equity": point["equity"],
            }
            for point in equity_curve
        ],
        "data_quality": {
            "bars": len(bars),
            "first_bar": _date(bars[0]["t"]),
            "last_bar": _date(bars[-1]["t"]),
            "meta": chart["meta"],
        },
        "generated_at": iso(utc_now()),
        "disclaimer": "Historical simulation. Past performance is not evidence of future returns. Survivorship, taxes, liquidity and regime change can invalidate the result.",
    }
