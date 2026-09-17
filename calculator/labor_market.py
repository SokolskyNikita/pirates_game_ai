"""Fixed-population labor matching with sticky contracts and one turnover round.

Counts are fractions of the initial workforce, never new people. The two slot
pools keep aggregate contractual wage bills rather than individual histories.
An incumbent's contract changes only when that position changes hands; the
within-pool average used for replacement is an explicit aggregation assumption.
"""

from __future__ import annotations

from typing import Any

from .arithmetic import Scalar


def initial_labor(zero: Any = 0.0) -> dict[str, Any]:
    return {
        "original_filled": zero + 1,
        "original_bill": zero + 1,
        "new_filled": zero,
        "new_bill": zero,
        "retained": zero,
        "searching": zero,
        "exited": zero,
        "nominal_slots": zero + 1,
        "slots": zero + 1,
        "employment": zero + 1,
        "wage_bill": zero + 1,
        "market_wage": zero + 1,
        "average_wage": zero + 1,
        "newly_displaced": zero,
        "hired": zero,
        "competitive_displacement": zero,
        "unfilled_slots": zero,
    }


def _ratio(numerator: Any, denominator: Any, xp: Any) -> Any:
    return numerator / xp.maximum(denominator, 1e-15)


def advance_labor(
    old: dict[str, Any],
    affected: Any,
    job_change: float,
    exposure: Any,
    search_share: float,
    replacement: Any,
    trade_loss: Any = 0,
    *,
    xp: Any = None,
) -> dict[str, Any]:
    """Retire affected roles, allocate vacancies, then permit one replacement round.

    New/transformed slots are (affected share + net job change) times exposure.
    Retained staff redeploy first at the original wage, without a second wage.
    Search is a choice on each layoff, not a yearly chance of creating a job.
    A non-searcher does not reappear in a later year. The hiring wage is the
    slots-to-available-workers ratio (capped at one); existing contracts remain
    sticky until replacement. A retention mandate prohibits competitive firing.
    """
    xp = xp or Scalar
    original_slots = xp.maximum(0, 1 - affected) * (1 - trade_loss)
    new_slots = xp.maximum(0, affected + job_change * exposure) * (1 - trade_loss)
    slots = original_slots + new_slots
    nominal_slots = xp.maximum(0, 1 + job_change * exposure)
    original = xp.minimum(old["original_filled"], original_slots)
    new = xp.minimum(old["new_filled"], new_slots)
    original_bill = old["original_bill"] * _ratio(original, old["original_filled"], xp)
    new_bill = old["new_bill"] * _ratio(new, old["new_filled"], xp)
    removed = xp.maximum(0, old["original_filled"] + old["new_filled"] - original - new)
    protected = replacement > 0
    retained = old["retained"] + xp.where(protected, removed, 0)
    laid_off = xp.where(protected, 0, removed)
    searching = old["searching"] + search_share * laid_off
    exited = old["exited"] + (1 - search_share) * laid_off
    available = original + new + searching + retained
    market_wage = xp.minimum(1, _ratio(slots, available, xp))
    market_wage = xp.where(slots > 0, market_wage, 0)

    # Remember incumbents before this year's hires. New hires cannot be fired
    # recursively in the same round merely because another worker is searching.
    old_original, old_new = original, new
    old_original_bill, old_new_bill = original_bill, new_bill
    vacancy_original = xp.maximum(0, original_slots - original)
    vacancy_new = xp.maximum(0, new_slots - new)
    vacancies = vacancy_original + vacancy_new
    redeployed = xp.minimum(retained, vacancies)
    share_original = _ratio(vacancy_original, vacancies, xp)
    original_redeploy = redeployed * share_original
    new_redeploy = redeployed - original_redeploy
    original = original + original_redeploy
    new = new + new_redeploy
    original_bill = original_bill + original_redeploy
    new_bill = new_bill + new_redeploy
    retained = retained - redeployed
    vacancy_original = vacancy_original - original_redeploy
    vacancy_new = vacancy_new - new_redeploy
    vacancies = vacancy_original + vacancy_new
    hired = xp.minimum(searching, vacancies)
    original_hires = hired * _ratio(vacancy_original, vacancies, xp)
    new_hires = hired - original_hires
    original = original + original_hires
    new = new + new_hires
    original_bill = original_bill + original_hires * market_wage
    new_bill = new_bill + new_hires * market_wage
    searching = searching - hired

    eligible_original = xp.where(
        _ratio(old_original_bill, old_original, xp) > market_wage + 1e-12, old_original, 0
    )
    eligible_new = xp.where(_ratio(old_new_bill, old_new, xp) > market_wage + 1e-12, old_new, 0)
    eligible = eligible_original + eligible_new
    swaps = xp.where(protected, 0, xp.minimum(searching, eligible))
    swap_original = swaps * _ratio(eligible_original, eligible, xp)
    swap_new = swaps - swap_original
    original_bill = original_bill - swap_original * (
        _ratio(old_original_bill, old_original, xp) - market_wage
    )
    new_bill = new_bill - swap_new * (_ratio(old_new_bill, old_new, xp) - market_wage)
    searching = searching - (1 - search_share) * swaps
    exited = exited + (1 - search_share) * swaps

    employed = original + new
    wage_bill = original_bill + new_bill
    return {
        "original_removed": old["original_filled"] - old_original,
        "new_removed": old["new_filled"] - old_new,
        "removed": removed,
        "protected_removed": xp.where(protected, removed, 0),
        "search_layoffs": search_share * laid_off,
        "original_redeploy": original_redeploy,
        "new_redeploy": new_redeploy,
        "original_hires": original_hires,
        "new_hires": new_hires,
        "original_survivors": old_original,
        "new_survivors": old_new,
        "swap_original": swap_original,
        "swap_new": swap_new,
        "search_swaps": search_share * swaps,
        "original_filled": original,
        "original_bill": original_bill,
        "new_filled": new,
        "new_bill": new_bill,
        "retained": retained,
        "searching": searching,
        "exited": exited,
        "nominal_slots": nominal_slots,
        "slots": slots,
        "employment": employed,
        "wage_bill": wage_bill,
        "market_wage": market_wage,
        "average_wage": xp.where(employed > 0, _ratio(wage_bill, employed, xp), 0),
        "newly_displaced": removed + swaps,
        "hired": hired + redeployed + swaps,
        "competitive_displacement": swaps,
        "unfilled_slots": xp.maximum(0, slots - employed),
    }
