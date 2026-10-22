import unittest
from copy import deepcopy
from types import SimpleNamespace
from continuation_contract import continuation_errors, issue_choice_errors, compiled_issue_errors
from context_projection import continuation_view, stage_context
from life_worker import BoundedDecision, followup_repair, valid_continuation_binding
from agent.decision import ActionCandidate
from core.interfaces.action import ActionType
from core.interfaces.perception import SpatialPerception, LocationView

class CurrentReviewTests(unittest.TestCase):
    def context(self):
        return {'phase':'plan','continuation':{'schema':'deskbot.cognitive-continuation.v3','decision_contract':'issue-choice-v1',
            'current':{'followup_id':'issue','question':'等两小时','reason':'灯刚用过','last_reviewed_at':'yesterday',
                'original_question':'能否兼顾光与暗','current_conditions':{'assessed_at':'today','next_step':{'minutes_until_clock_ready':0}},
                'resolution_evidence_ids':[]},'completion_targets':[{'id':'activity:install'}]}}

    def test_dated_appraisal_is_separated_at_all_stages_without_rewriting_saved_world(self):
        c=self.context();before=deepcopy(c)
        for view in [continuation_view(c),stage_context(c,'decision')['continuation'],stage_context(c,'feedback')['continuation']]:
            cur=view['current']
            self.assertNotIn('reason',cur);self.assertEqual(cur['previous_review']['reason'],'灯刚用过')
            self.assertEqual(cur['current_conditions']['next_step']['minutes_until_clock_ready'],0)
            self.assertEqual(cur['original_question'],'能否兼顾光与暗')
        self.assertEqual(c,before)

    def test_recorded_contract_wait_failure_gives_precise_repair_and_accepts_same_contract_or_no_step(self):
        c={'continuation':{'schema':'deskbot.cognitive-continuation.v3','wait_options':[{'kind':'commitment','id':'c'}],
           'next_options':[{'kind':'social','id':'give-water'},{'kind':'commitment','id':'c'}]}}
        v={'status':'continue','question':'等回话','reason':'尚未交接','delay_hours':1,'next_step':{'kind':'social','id':'give-water'},'wait_for':{'kind':'commitment','id':'c'}}
        self.assertFalse(valid_continuation_binding(v,c));self.assertIn('邀请已送出',followup_repair(v,c))
        self.assertTrue(valid_continuation_binding({**v,'next_step':v['wait_for']},c))
        self.assertTrue(valid_continuation_binding({**v,'next_step':None},c))

    def test_actor_binds_before_work_and_compiler_may_not_choose_or_close_for_them(self):
        c=self.context();engine=BoundedDecision(None,context=c)
        packet=SimpleNamespace(agent_id='me',spatial=SpatialPerception(location_id='bank',location_view=LocationView('岸边','现场'),current_step=1,world_time_label='2026-10-22 09:00'),inbox=[],internal_context=SimpleNamespace(relevant_relations=[]))
        candidates=[ActionCandidate(ActionType.WORK,'做事')]
        payload={'selected_index':0,'action_description':'实际装罩'}
        self.assertIsNone(engine._parse_llm_selection(payload,candidates,packet))
        choice={'followup_id':'issue','followup_decision':'continue','completion_target_id':'activity:install','followup_closure':None}
        self.assertEqual(issue_choice_errors(choice,c),[])
        payload['issue_choice']=choice
        self.assertIsNotNone(engine._parse_llm_selection(payload,candidates,packet))
        self.assertEqual(engine.issue,choice)
        for delta in ({'completion_target_id':None},{'followup_decision':'none'},{'followup_id':None}):
            self.assertTrue(compiled_issue_errors({**choice,**delta},choice))
        self.assertEqual(compiled_issue_errors(choice,choice),[])

    def test_subjective_closure_remains_a_choice_and_objective_closure_requires_prior_evidence(self):
        c=self.context();choice={'followup_id':'issue','followup_decision':'drop','completion_target_id':None,
            'followup_closure':{'followup_id':'issue','kind':'resolved','reason':'这一步做完','evidence_ids':['task:install']}}
        self.assertTrue(issue_choice_errors(choice,c))
        c['continuation']['current']['resolution_evidence_ids']=['task:install']
        self.assertEqual(issue_choice_errors(choice,c),[])
        choice['followup_closure'].update(kind='satisfied',evidence_ids=[])
        self.assertEqual(issue_choice_errors(choice,c),[])
        self.assertTrue(continuation_errors({'current_conditions':{'target_status':'achieved'}},c))

if __name__=='__main__':unittest.main()
