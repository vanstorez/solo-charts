from typing import Literal

from pydantic import BaseModel, Field, model_validator


class TimedValue(BaseModel):
    t: int = Field(description="Unix timestamp in milliseconds")
    value: float


class LagRequest(BaseModel):
    anchor: list[TimedValue] = Field(min_length=10)
    response: list[TimedValue] = Field(min_length=10)
    bucket_seconds: int = Field(default=60, ge=10, le=3600)
    max_lag_seconds: int = Field(default=900, ge=0, le=86400)
    min_observations: int = Field(default=30, ge=10, le=10000)
    origin: Literal["observed", "simulated"] = "observed"


class PaperOrderRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=40)
    side: Literal["BUY", "SELL"]
    quantity: int = Field(ge=1, le=1_000_000)
    stop_loss: float | None = Field(default=None, gt=0)
    take_profit: float | None = Field(default=None, gt=0)
    notes: str | None = Field(default=None, max_length=500)


class RiskSettingsUpdate(BaseModel):
    max_open_positions: int | None = Field(default=None, ge=1, le=20)
    max_trade_notional: float | None = Field(default=None, ge=1000, le=10_000_000)
    max_total_exposure: float | None = Field(default=None, ge=1000, le=50_000_000)
    daily_loss_limit: float | None = Field(default=None, ge=100, le=10_000_000)
    max_drawdown: float | None = Field(default=None, ge=100, le=50_000_000)
    paper_slippage_bps: float | None = Field(default=None, ge=0, le=200)
    paper_fee_bps: float | None = Field(default=None, ge=0, le=200)


class KillSwitchRequest(BaseModel):
    engaged: bool
    reason: str | None = Field(default=None, max_length=500)


class AlertRuleRequest(BaseModel):
    kind: Literal["price_above", "price_below", "news_keyword"]
    symbol: str | None = Field(default=None, max_length=40)
    threshold: float | None = Field(default=None, gt=0)
    keyword: str | None = Field(default=None, min_length=2, max_length=120)
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_rule(self):
        if self.kind in {"price_above", "price_below"}:
            if not self.symbol:
                raise ValueError("A symbol is required for price alerts")
            if self.threshold is None:
                raise ValueError("A threshold is required for price alerts")
        if self.kind == "news_keyword" and not (self.keyword or "").strip():
            raise ValueError("A keyword is required for news alerts")
        return self


class BacktestRequest(BaseModel):
    symbol: str = "NIFTY"
    range: Literal["1y", "2y", "5y"] = "2y"
    fast: int = Field(default=20, ge=2, le=100)
    slow: int = Field(default=50, ge=5, le=300)
    cost_bps: float = Field(default=5, ge=0, le=100)
    initial_capital: float = Field(default=500_000, ge=10_000, le=100_000_000)

    @model_validator(mode="after")
    def validate_periods(self):
        if self.fast >= self.slow:
            raise ValueError("fast period must be smaller than slow period")
        return self


class BlackScholesRequest(BaseModel):
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    days: float = Field(gt=0, le=3650)
    volatility: float = Field(gt=0, le=500, description="Annualised volatility in percent")
    rate: float = Field(default=6.5, ge=-50, le=100, description="Annualised risk-free rate in percent")
    option_type: Literal["call", "put"] = "call"


class DemoSeriesRequest(BaseModel):
    origin: Literal["observed", "simulated"] = "simulated"
