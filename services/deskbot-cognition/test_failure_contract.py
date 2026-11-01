import unittest
from failure_contract import cognitive_failure, error_frame


class FailureContractTests(unittest.TestCase):
    def test_wrapper_preserves_known_cause_and_stage_without_guessing_details(self):
        value = cognitive_failure('python_session_failed', cause_code='upstream_decision_failed', phase='plan', stage='decision_repair')
        self.assertEqual(value['layer'], 'decision')
        self.assertEqual(value['stage'], 'decision_repair')
        self.assertFalse(value['retryable'])
        self.assertFalse(value['record_as_experience'])

    def test_error_frame_handles_invalid_context_and_excludes_prose_from_report(self):
        frame = error_frame(ValueError('private source text'), [], 'decision')
        self.assertEqual(frame['failure']['code'], 'unknown_error')
        self.assertNotIn('private', str(frame['failure']))
        self.assertIsNone(frame['failure']['actor_id'])

    def test_budget_and_contract_errors_are_separate(self):
        self.assertEqual(cognitive_failure('budget_exhausted')['layer'], 'budget')
        self.assertEqual(cognitive_failure('semantic_contract_rejected_after_retry')['layer'], 'contract')
        self.assertEqual(cognitive_failure('new_unknown_code')['layer'], 'unknown')
