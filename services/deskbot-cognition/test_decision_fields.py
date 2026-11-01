import unittest
from copy import deepcopy
from types import SimpleNamespace as NS
from decision_fields import CONTRACT, MOTIVATIONS, MOTIVATION_PROMPT, DecisionFieldError, validate_motivation
from catalogue_choice import bind_catalogue_choice
from failure_contract import cognitive_failure


class DecisionFieldsTests(unittest.TestCase):
    def test_need_names_and_nonstrings_are_rejected_with_precise_shared_diagnostics(self):
        for value in ('self_actualization', 'social', '', None, False, [], {'kind': 'need'}):
            with self.subTest(value=value), self.assertRaises(DecisionFieldError) as raised:
                validate_motivation(value)
            self.assertEqual(raised.exception.code, 'cognitive_motivation_invalid')
            self.assertIn('motivation', str(raised.exception))
            self.assertIn('|'.join(MOTIVATIONS), str(raised.exception))
            failure = cognitive_failure(raised.exception.code)
            self.assertEqual(failure['layer'], 'contract')
            self.assertFalse(failure['record_as_experience'])

    def test_valid_categories_are_preserved_and_described_without_inventing_an_intention(self):
        for kind in MOTIVATIONS:
            self.assertEqual(validate_motivation(kind), kind)
            self.assertIn(kind + '=' + CONTRACT['motivation']['meanings'][kind], MOTIVATION_PROMPT)
        self.assertIn('程序不替本人映射或决定', MOTIVATION_PROMPT)

    def test_catalogue_rejects_before_binding_and_does_not_rewrite_raw_choice(self):
        context = {'choice_catalogue': {'choices': []}}
        payload = {'act': True, 'choice_id': 'not-even-bound', 'inner_monologue': '我想试一试',
                   'expected_outcome': '了解情况', 'issue': {'decision': 'none', 'id': None},
                   'motivation': 'self_actualization', 'source_ids': []}
        before = deepcopy((payload, context))
        with self.assertRaisesRegex(DecisionFieldError, 'self_actualization'):
            bind_catalogue_choice(payload, context, [NS(action_type=NS(value='work'))], [])
        self.assertEqual((payload, context), before)


if __name__ == '__main__':
    unittest.main()
