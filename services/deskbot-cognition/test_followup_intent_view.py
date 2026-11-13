import json
import unittest
from copy import deepcopy
from pathlib import Path
from context_projection import followup_intent_view
from followup_intent import CONTRACT


class FollowupProjectionTest(unittest.TestCase):
    def test_readback_preserves_bound_target_proofs_and_actual_permissions(self):
        capture = json.loads((Path(__file__).resolve().parents[2]/'research/experiments/a32-2026-11-02/followup-shape-counterexample.json').read_text(encoding='utf-8'))
        context = deepcopy(capture['diagnostic_context'])
        history = capture['previous_read_model_value']
        target = {'id':'handoff:water', 'kind':'handoff', 'resource':'water', 'count':4, 'recipient_id':'peer'}
        current = context['continuation']['current']
        current.update({'completion_target':target, 'resolution_evidence_ids':['proof'], 'original_question':'谁想要水？',
                        'intent_evidence':{'unverified_idea':history}, 'completed_steps':[{'target':target,'evidence_ids':['proof']}],
                        'internal_only':'sentinel-do-not-project'})
        ready = {'kind':'opportunity','id':'ready','title':'取水','available':True}
        blocked = {'kind':'opportunity','id':'blocked','title':'补灯','available':False,'blocker':'等材料'}
        foreign = {**blocked,'id':'other','requires_issue':'other-issue'}
        context['followup_intent'].update({'next_options':[ready,blocked,foreign], 'wait_options':[ready,blocked,foreign]})
        context['continuation']['rule'] = capture['legacy_rule_still_present']
        before = deepcopy(context)
        view = followup_intent_view(context, '喵呜')
        self.assertEqual(view['previous_unverified_thought'], history['text'])
        self.assertIsInstance(view['previous_unverified_thought'], str)
        self.assertEqual(view['current_issue']['bound_target'], target)
        self.assertEqual(view['current_issue']['completed_steps'][0]['evidence_ids'], ['proof'])
        self.assertEqual({r['id']:r['allowed_for'] for r in view['options']},
                         {'ready':['next_step'], 'blocked':['next_step','wait_for']})
        text = json.dumps(view, ensure_ascii=False)
        for hidden in (capture['legacy_rule_still_present'],'sentinel-do-not-project','intent_evidence','followup_closure'):
            self.assertNotIn(hidden, text)
        self.assertEqual(view['command_schema'], CONTRACT['command'])
        self.assertEqual(view['command_schema']['properties']['unverified_idea']['type'], 'string')
        self.assertEqual(context, before)
