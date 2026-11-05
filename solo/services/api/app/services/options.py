import math

from ..schemas import BlackScholesRequest
from ..timeutil import iso, utc_now


def _normal_cdf(value: float) -> float:
    return 0.5 * (1 + math.erf(value / math.sqrt(2)))


def _normal_pdf(value: float) -> float:
    return math.exp(-0.5 * value * value) / math.sqrt(2 * math.pi)


def calculate_black_scholes(payload: BlackScholesRequest) -> dict:
    spot = payload.spot
    strike = payload.strike
    years = payload.days / 365
    volatility = payload.volatility / 100
    rate = payload.rate / 100
    if years <= 0 or volatility <= 0:
        raise ValueError("Days and volatility must be positive.")
    sqrt_years = math.sqrt(years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * volatility * volatility) * years) / (
        volatility * sqrt_years
    )
    d2 = d1 - volatility * sqrt_years
    discount = math.exp(-rate * years)
    if payload.option_type == "call":
        price = spot * _normal_cdf(d1) - strike * discount * _normal_cdf(d2)
        delta = _normal_cdf(d1)
        theta = (
            -(spot * _normal_pdf(d1) * volatility) / (2 * sqrt_years)
            - rate * strike * discount * _normal_cdf(d2)
        ) / 365
        breakeven = strike + price
    else:
        price = strike * discount * _normal_cdf(-d2) - spot * _normal_cdf(-d1)
        delta = _normal_cdf(d1) - 1
        theta = (
            -(spot * _normal_pdf(d1) * volatility) / (2 * sqrt_years)
            + rate * strike * discount * _normal_cdf(-d2)
        ) / 365
        breakeven = strike - price
    gamma = _normal_pdf(d1) / (spot * volatility * sqrt_years)
    vega = spot * _normal_pdf(d1) * sqrt_years / 100
    intrinsic = max(spot - strike, 0) if payload.option_type == "call" else max(strike - spot, 0)
    return {
        "inputs": payload.model_dump(),
        "price": round(price, 4),
        "intrinsic_value": round(intrinsic, 4),
        "time_value": round(price - intrinsic, 4),
        "breakeven": round(breakeven, 4),
        "greeks": {
            "delta": round(delta, 4),
            "gamma": round(gamma, 6),
            "vega_per_1pct_vol": round(vega, 4),
            "theta_per_day": round(theta, 4),
        },
        "interpretation": {
            "delta": "Approximate change in option price per ₹1 move in the underlying.",
            "gamma": "Approximate change in delta per ₹1 move in the underlying.",
            "vega": "Approximate change in option price for a 1 percentage-point volatility move.",
            "theta": "Approximate change in option price per calendar day, all else equal.",
        },
        "assumptions": "European exercise, constant volatility and rate, no dividends, no transaction costs. Indian index options are European and cash-settled; individual stock options and early exercise need separate modelling.",
        "limitations": "This is a calculator, not a live option chain. It does not use NSE bid/ask, open interest, implied-volatility skew, expiry-day effects or broker margins.",
        "generated_at": iso(utc_now()),
    }
