"""Two-region trade prices and persistent productive job-capacity adjustment.

This is an Armington-inspired approximation: one tradable basket and one local
basket per region, calibrated to a balanced bilateral flow. It is not a sectoral
forecast. All prices are relative to each region's producer price; US producers
are the common numeraire when clearing the bilateral goods market.
"""

from __future__ import annotations

import math
from typing import Any

from .arithmetic import Scalar


def _field(value: Any, name: str) -> Any:
    return value[name] if isinstance(value, dict) else getattr(value, name)


def baseline_trade(inputs: dict[str, float]) -> tuple[float, float, float]:
    """Return balanced US/ROW import shares and the tradable spending share."""
    beta = inputs.get("tradableShare", 0.4)
    size = inputs["foreignMarketSize"]
    flow = min(
        math.sqrt(inputs["tradeIntensity"] * inputs["foreignTradeIntensity"] * size),
        0.95 * beta * min(1, size),
    )
    return flow, flow / size, beta


def competition_displacement(
    previous_fraction: Any,
    import_share: Any,
    export_volume: Any,
    previous_import_share: Any,
    previous_export_volume: Any,
    previous_net_output: Any,
    tradable_share: float,
    *,
    xp: Any = None,
) -> Any:
    """Signed trade pressure changes available productive job capacity.

    The one-for-one coefficient is an assumption, bounded by tradable exposure.
    Import retreat or export recovery can restore slots; merely looking for work
    cannot. Opposing import/export changes may offset, including import
    substitution following a bilateral ban. Lost varieties still affect prices.
    """
    xp = xp or Scalar
    pressure = (
        import_share
        - previous_import_share
        + (previous_export_volume - export_volume) / xp.maximum(previous_net_output, 1e-9)
    )
    pressure = xp.where(xp.maximum(pressure, -pressure) < 1e-12, 0, pressure)
    return xp.minimum(tradable_share, xp.maximum(0, previous_fraction + pressure))


def trade_retention_burden(
    baseline_burden: Any,
    previous_retained: Any,
    previous_nominal_slots: Any,
    previous_price: Any,
    replacement: Any,
    calibration: dict[str, Any],
    *,
    xp: Any = None,
) -> Any:
    """Add actual retained payroll beyond domestic lost slots to investment costs."""
    xp = xp or Scalar
    extra = (
        calibration["laborIncome"]
        * xp.maximum(0, previous_retained - xp.maximum(0, 1 - previous_nominal_slots))
        * replacement
        * previous_price
        / calibration["capitalIncome"]
    )
    extra = xp.minimum(1, xp.maximum(0, extra))
    return xp.minimum(1, xp.maximum(-1, baseline_burden + (1 - xp.maximum(0, baseline_burden)) * extra))


def trade_market(
    inputs: dict[str, float],
    us_policy: dict[str, Any],
    foreign_policy: dict[str, Any],
    us: Any,
    foreign: Any,
    *,
    xp: Any = None,
) -> dict[str, Any]:
    """Clear goods trade including AI-service profit remittances.

    Supports floats or NumPy arrays through the same equations. A bilateral ban
    removes imported varieties, AI imports and modeled cross-border AI-service
    returns. It does not purport to simulate all international asset ownership.
    """
    xp = xp or Scalar
    size = inputs["foreignMarketSize"]
    theta = inputs.get("tradeElasticity", 4)
    baseline_us, baseline_foreign, beta = baseline_trade(inputs)
    a_us = baseline_us / beta if beta else 0
    a_foreign = baseline_foreign / beta if beta else 0
    opened = us_policy.get("allowFreeTrade", True) & foreign_policy.get("allowFreeTrade", True)
    if baseline_us == 0 or xp.all(opened == False):  # noqa: E712 - supports array masks
        zero = 0 * _field(us, "output") + 0 * _field(foreign, "output")
        return {
            "open": opened,
            "usPriceIndex": zero + (1 - a_us) ** (-beta / theta),
            "foreignPriceIndex": zero + (1 - a_foreign) ** (-beta / theta),
            "usImportShare": zero,
            "foreignImportShare": zero,
            "usExportShare": zero,
            "foreignExportShare": zero,
            "usExportVolume": zero,
            "foreignExportVolume": zero,
            "relativeProducerPrice": zero + 1,
            "usFlow": zero,
            "foreignFlow": zero,
            "residual": zero,
        }
    q_us = xp.maximum(1e-9, _field(us, "output") - _field(us, "investment") - _field(us, "adjustment"))
    q_foreign = xp.maximum(
        1e-9, _field(foreign, "output") - _field(foreign, "investment") - _field(foreign, "adjustment")
    )
    mobile = 0.6 * inputs["capitalMobility"] * inputs["foreignStrength"]
    attract_us = (0.15 + _field(us, "adoption")) * xp.exp(
        -4 * inputs["capitalMobility"] * _field(us, "burden")
    )
    attract_foreign = (
        size
        * inputs["foreignStrength"]
        * (0.15 + _field(foreign, "adoption"))
        * xp.exp(-4 * inputs["capitalMobility"] * _field(foreign, "burden"))
    )
    attraction = attract_us / (attract_us + attract_foreign)

    def at_price(log_price: Any) -> tuple[Any, ...]:
        price = xp.exp(log_price)
        cheap_foreign = xp.exp(-theta * log_price)
        cheap_us = xp.exp(theta * log_price)
        basket_us = 1 - a_us + a_us * cheap_foreign
        basket_foreign = 1 - a_foreign + a_foreign * cheap_us
        imports_us = beta * a_us * cheap_foreign / basket_us
        imports_foreign = beta * a_foreign * cheap_us / basket_foreign
        flow = mobile * (
            _field(us, "rents") + price * size * _field(foreign, "rents")
        ) * attraction - mobile * _field(us, "rents")
        # With no bilateral exposure there are no modeled traded AI services.
        flow = flow if baseline_us > 0 else 0 * flow
        expenditure_us = q_us + flow
        expenditure_foreign = price * size * q_foreign - flow
        residual = imports_us * expenditure_us - imports_foreign * expenditure_foreign - flow
        return (
            price,
            imports_us,
            imports_foreign,
            flow,
            expenditure_us,
            expenditure_foreign,
            residual,
            basket_us,
            basket_foreign,
        )

    low: Any = -20.0
    high: Any = 20.0
    for _ in range(48):
        middle = (low + high) / 2
        residual = at_price(middle)[6]
        # Higher foreign prices reduce US imports and increase foreign imports.
        low = xp.where(residual > 0, middle, low)
        high = xp.where(residual > 0, high, middle)
    (
        price,
        imports_us,
        imports_foreign,
        flow,
        expenditure_us,
        expenditure_foreign,
        residual,
        basket_us,
        basket_foreign,
    ) = at_price((low + high) / 2)
    # The zero-exposure case has no unique relative price; retain the numeraire.
    if baseline_us == 0:
        price = 1 + 0 * price
        residual = 0 * residual
    open_us_cpi = basket_us ** (-beta / theta)
    open_foreign_cpi = basket_foreign ** (-beta / theta)
    closed_us_cpi = (1 - a_us) ** (-beta / theta)
    closed_foreign_cpi = (1 - a_foreign) ** (-beta / theta)
    return {
        "open": opened,
        "usPriceIndex": xp.where(opened, open_us_cpi, closed_us_cpi),
        "foreignPriceIndex": xp.where(opened, open_foreign_cpi, closed_foreign_cpi),
        "usImportShare": xp.where(opened, imports_us, 0),
        "foreignImportShare": xp.where(opened, imports_foreign, 0),
        "usExportShare": xp.where(opened, imports_foreign * expenditure_foreign / q_us, 0),
        "foreignExportShare": xp.where(opened, imports_us * expenditure_us / (price * size * q_foreign), 0),
        "usExportVolume": xp.where(opened, imports_foreign * expenditure_foreign, 0),
        "foreignExportVolume": xp.where(opened, imports_us * expenditure_us / (price * size), 0),
        "relativeProducerPrice": xp.where(opened, price, 1),
        "usFlow": xp.where(opened, flow, 0),
        "foreignFlow": xp.where(opened, -flow / (price * size), 0),
        "residual": xp.where(opened, residual, 0),
    }
