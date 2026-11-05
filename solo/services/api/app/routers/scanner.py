from fastapi import APIRouter, Query

from ..services import scanner

router = APIRouter(prefix="/api/scanner", tags=["market scanner"])


@router.get("")
async def scan(
    condition: str = Query(default="rsi_oversold"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
    symbols: str | None = Query(default=None),
):
    symbol_list = [s.strip() for s in symbols.split(",")] if symbols else None
    return await scanner.scan_market(condition, interval, range, symbol_list)


@router.get("/conditions")
async def list_conditions():
    return {
        "conditions": scanner.SCAN_CONDITIONS,
        "descriptions": {
            "rsi_oversold": "RSI < 30 (potential buy)",
            "rsi_overbought": "RSI > 70 (potential sell)",
            "macd_bullish": "MACD histogram positive",
            "macd_bearish": "MACD histogram negative",
            "price_above_sma20": "Price above 20-day SMA",
            "price_below_sma20": "Price below 20-day SMA",
            "price_above_vwap": "Price above VWAP",
            "price_below_vwap": "Price below VWAP",
            "bb_squeeze": "Bollinger Band squeeze (low volatility)",
            "bb_breakout_up": "Price above upper Bollinger Band",
            "bb_breakout_down": "Price below lower Bollinger Band",
            "adx_strong_trend": "ADX > 25 (strong trend)",
        },
    }
