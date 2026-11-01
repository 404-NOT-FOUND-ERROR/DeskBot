import asyncio
import json
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from continuation_contract import continuation_errors, FEEDBACK_CONTINUATION_CONTRACT
from context_projection import continuation_view
from followup_phases import CONTRACT, feedback_error_code, feedback_field_errors
from life_worker import contract_json, followup_repair, valid_followup, valid_continuation_binding


class FollowupPhasesTests(unittest.TestCase):
    def context(self):
        return {'phase': 'feedback', 'continuation': {
            'schema': 'deskbot.cognitive-continuation.v3', 'decision_contract': 'issue-choice-v2',
            'step_contract': 'completed-steps-v1', 'rule': 'plan step_review instruction',
            'completion_targets': [{'id': 'activity:install'}],
            'current': {'followup_id': 'q', 'completion_target': {'id': 'activity:install'},
                        'resolution_evidence_ids': ['task:done'], 'completed_steps': []},
            'next_options': [], 'wait_options': []}}

    def test_feedback_rejects_plan_and_server_fields_including_null_without_mutation(self):
        value = {'status': 'continue', 'question': '继续研究', 'reason': '一步已经完成',
                 'delay_hours': 1, 'next_step': None}
        self.assertEqual(continuation_errors(value, self.context()), [])
        for field in CONTRACT['plan_only_fields'] + CONTRACT['server_fields'] + ['invented_field']:
            for extra in (None, {}, 'continue'):
                with self.subTest(field=field, extra=extra):
                    v = {**value, field: extra}; before = deepcopy(v)
                    self.assertTrue(continuation_errors(v, self.context()))
                    self.assertEqual(feedback_error_code(v), CONTRACT['feedback']['invalid_code'])
                    self.assertEqual(v, before)

    def test_feedback_projection_keeps_proof_but_removes_plan_affordances(self):
        c = self.context(); before = deepcopy(c); view = continuation_view(c)
        for field in ('completion_targets', 'decision_contract', 'step_contract'):
            self.assertNotIn(field, view)
        self.assertEqual(view['current'], c['continuation']['current'])
        self.assertIn('当前是结果反馈阶段', view['rule'])
        self.assertNotIn('step_review:{', FEEDBACK_CONTINUATION_CONTRACT)
        self.assertEqual(c, before)
        self.assertIn('completion_targets', continuation_view({**c, 'phase': 'plan'}))

    def test_recorded_repair_requests_removal_instead_of_completing_plan_object(self):
        raw = json.loads((Path(__file__).parent / 'evaluations/fixtures/r3a-followup-phase-20261031.json').read_text(encoding='utf-8'))
        for call in raw['calls']:
            if call['turn'] == 3 and call['stage'] in ('followup', 'followup_repair'):
                value = json.loads(call['content']); hint = followup_repair(value, self.context())
                self.assertIn('请删除', hint)
                self.assertIn('step_review', hint)
                self.assertIn('不要补全', hint)
                self.assertIn('下一次计划', hint)
                self.assertNotIn('原target_id', hint)

    def test_feedback_can_close_existing_target_with_evidence_or_continue_without_archiving(self):
        value = {'status': 'drop', 'question': '', 'reason': '本人收束这一问题', 'delay_hours': 1,
                 'next_step': None, 'followup_id': 'q',
                 'followup_closure': {'followup_id': 'q', 'kind': 'resolved', 'reason': '这一步已经完成', 'evidence_ids': ['task:done']}}
        self.assertTrue(valid_continuation_binding(value, self.context()))
        value['followup_closure']['evidence_ids'] = ['task:invented']
        self.assertFalse(valid_continuation_binding(value, self.context()))
        # A separate personal decision to stop remains legal without physical proof.
        value['followup_closure'].update(kind='satisfied', evidence_ids=[])
        self.assertTrue(valid_continuation_binding(value, self.context()))

    def test_once_bounded_repair_reports_current_failure_not_previous_attempt(self):
        good = {'status': 'continue', 'question': '继续', 'reason': '还有疑问', 'delay_hours': 1, 'next_step': None}
        class Router:
            def __init__(self, replies): self.replies = replies; self.calls = 0
            async def complete(self, *args, **kwargs):
                reply = self.replies[self.calls]; self.calls += 1
                return SimpleNamespace(content=json.dumps(reply))
        for repair, code in (({**good, 'step_review': {}}, 'cognitive_followup_phase_invalid'),
                             ({**good, 'delay_hours': 0}, 'semantic_contract_rejected_after_retry')):
            router = Router([{**good, 'step_review': {}}, repair])
            with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                asyncio.run(contract_json(router, [], lambda v: valid_followup(v) and not feedback_field_errors(v),
                                          failure_code=feedback_error_code, stage='followup'))
            self.assertEqual(router.calls, 2)


if __name__ == '__main__': unittest.main()
