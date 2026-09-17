"""Declared finite assumption grid for the fully static simulator."""

from itertools import product

from calculator.config import DEFAULT_INPUTS

CHOICES = {key: [value] for key, value in DEFAULT_INPUTS.items()}
CHOICES.update(
    usAiGrowth=[0, 0.05],
    productivityGain=[0, 0.4],
    jobChange=[-1, -0.9, 0, 1],
    jobsAffected=[0, 1],
    jobSearch=[0, 0.85],
)
VARIABLE_KEYS = [key for key, values in CHOICES.items() if len(values) > 1]


def requests():
    for values in product(*(CHOICES[key] for key in VARIABLE_KEYS)):
        inputs = {**DEFAULT_INPUTS, **dict(zip(VARIABLE_KEYS, values, strict=True))}
        if inputs["jobsAffected"] < max(0, -inputs["jobChange"]):
            continue
        for mode, objective in [
            ("us-only", "prosperity"),
            ("strategic", "workers"),
            ("strategic", "prosperity"),
            ("strategic", "output"),
        ]:
            for pause, plurality in product((False, True), repeat=2):
                yield dict(
                    inputs=inputs,
                    mode=mode,
                    foreignObjective=objective,
                    pauseUnavailable=pause,
                    statusQuoUnavailable=plurality,
                )


def lookup_key(request):
    return "|".join(
        map(
            str,
            [
                request["mode"],
                request["foreignObjective"] if request["mode"] == "strategic" else "-",
                int(request["pauseUnavailable"]),
                int(request["statusQuoUnavailable"]),
                *(CHOICES[key].index(request["inputs"][key]) for key in VARIABLE_KEYS),
            ],
        )
    )
