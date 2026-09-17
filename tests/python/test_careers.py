"""Known career identity and convergence to the independently computed job stocks."""

import unittest

import numpy as np

from calculator.careers import EXITED, NEW, ORIGINAL, RETAINED, SEARCHING, Careers, voter_weights
from calculator.config import normalize_inputs
from calculator.model import solve_model
from calculator.policies import current_policy, make_policy
from calculator.population import CALIBRATION
from calculator.preferences import assumptions, preferences
from calculator.trajectory import production_trajectory


class CareerTests(unittest.TestCase):
    def test_deterministic_paths_follow_continuum_and_never_revive_exits(self):
        for retention in (0, 0.5, 1.25):
            inputs = normalize_inputs()
            policy = make_policy({**current_policy(), "replacement": retention})
            tracker = Careers(paths=1000)
            for step in production_trajectory(inputs, policy, None, CALIBRATION):
                exited = tracker.state == EXITED
                states = tracker.advance(step.us["labor_state"])
                self.assertTrue(np.all(states[exited] == EXITED))
                for code, key in (
                    (ORIGINAL, "original_filled"),
                    (NEW, "new_filled"),
                    (RETAINED, "retained"),
                    (SEARCHING, "searching"),
                    (EXITED, "exited"),
                ):
                    self.assertAlmostEqual(
                        np.mean(states == code), step.us["labor_state"][key], delta=0.00101
                    )

    def test_pause_keeps_careers_and_complete_elimination_removes_every_job(self):
        for pace in (0, 1, 2):
            tracker = Careers()
            for step in production_trajectory(
                normalize_inputs({"jobChange": -1, "jobSearch": 0}), current_policy(pace), None, CALIBRATION
            ):
                tracker.advance(step.us["labor_state"])
            self.assertTrue(np.all(tracker.state == (ORIGINAL if pace == 0 else EXITED)))

    def test_individual_utilities_differ_with_known_careers(self):
        m = solve_model()
        result = m["evaluateLight"](current_policy())
        matrix = np.asarray(result["usUtilities"]).reshape(-1, preferences().career_paths)
        self.assertGreater(np.max(np.ptp(matrix, axis=1)), 0.1)
        self.assertEqual(len(result["usUtilities"]), len(m["weights"]))
        self.assertAlmostEqual(sum(m["weights"]), 1)

    def test_research_preferences_are_scoped_and_do_not_change_fiscal_resources(self):
        model = solve_model()
        before = model["evaluate"](current_policy())
        with assumptions(discount=0.1, curvature=0, career_paths=40):
            after = model["evaluate"](current_policy())
            self.assertEqual(len(after["usUtilities"]), len(CALIBRATION["weights"]) * 40)
            self.assertEqual(before["us"], after["us"])
            self.assertAlmostEqual(sum(voter_weights(CALIBRATION["weights"])), 1)
        self.assertEqual(preferences().career_paths, 100)
