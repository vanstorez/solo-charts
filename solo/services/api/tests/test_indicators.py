import pytest

from app.indicators import atr, ema, max_drawdown, pearson, rsi, sma


def test_sma_and_ema_shapes():
    values = [float(value) for value in range(1, 11)]
    assert sma(values, 3)[2] == pytest.approx(2.0)
    assert sma(values, 3)[-1] == pytest.approx(9.0)
    ema_values = ema(values, 3)
    assert ema_values[1] is None
    assert ema_values[2] == pytest.approx(2.0)
    assert ema_values[-1] > ema_values[-2]


def test_rsi_extremes():
    rising = [float(value) for value in range(1, 40)]
    falling = [float(value) for value in range(40, 1, -1)]
    assert rsi(rising, 14)[-1] == pytest.approx(100)
    assert rsi(falling, 14)[-1] == pytest.approx(0)


def test_atr_and_drawdown():
    bars = [
        {"o": 100 + index, "h": 102 + index, "l": 98 + index, "c": 100 + index}
        for index in range(30)
    ]
    assert atr(bars, 14)[-1] == pytest.approx(4.0)
    dd = max_drawdown([100, 120, 90, 130])
    assert dd["pct"] == pytest.approx(25.0)


def test_pearson_rejects_zero_variance():
    assert pearson([1, 1, 1], [1, 2, 3]) is None
    assert pearson([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)
