# Migration reference data

`typescript-parity.json` was captured from commit
`f74ddfff66bfcb58a9afbbdf52817b6758248590`, before replacing the deployed
TypeScript calculator with Python. It contains the full calibration, all 6,480
policy identifiers, eleven economic profiles, and sixteen common-scenario
ballots with selected trajectories and international search diagnostics.

The Python tests require identical policy identifiers and complete ballot
allocations. Economic trajectories allow only floating-point rounding error.
The fixture records the existing model; it is not empirical validation of that
model's assumptions. The underlying population figures are published aggregate
cohorts, not individual Census records.

Do not regenerate this fixture merely to make a failing test pass. Intentional
model changes should explain their expected effect and add separate tests.

The international trade model intentionally changes international trajectories.
The captured oracle is retained unchanged and still verifies domestic trajectories
and ballots. International behavior is covered by trade accounting, directional
response, policy-choice and scalar/batch parity tests.
