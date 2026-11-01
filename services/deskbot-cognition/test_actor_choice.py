import unittest
import json
from copy import deepcopy
from types import SimpleNamespace
from life_worker import BoundedDecision, BoundedPersonality
from actor_choice import bind_choice
from agent.decision import ActionCandidate
from agent.personality import SoulLayer, StateLayer
from core.interfaces.action import ActionType
from core.interfaces.perception import SpatialPerception, PerceivedPresence, PerceivedIdentity, LocationView


class SingleChoiceTests(unittest.TestCase):
    def setUp(self):
        self.candidates = [ActionCandidate(t, t.value) for t in (ActionType.WORK, ActionType.PHYSICAL, ActionType.REST, ActionType.SEND_MESSAGE, ActionType.MOVE)]
        self.context = {'choice_contract':'single-choice-v1','phase':'plan','actor':{'actor_id':'me','name':'喵呜'},'time':{},'saved':{},'inputs':[],
            'objects':[{'object_index':1,'id':'lamp'}], 'signals':[], 'speech_evidence':[{'id':'task:shade','text':'实际装上罩片。'}],
            'capabilities':{'activities':[{'activity_id':'use','activity_index':1},{'activity_id':'shade','activity_index':2}],
                'share':{'receivers':[{'actor_id':'peer','name':'灯穗'}]},'travel':{'destinations':[{'id':'town','destination_index':1}]}},
            'social':{'options':[{'option_id':'give-water'}]},
            'continuation':{'schema':'deskbot.cognitive-continuation.v3','decision_contract':'issue-choice-v2','step_contract':'completed-steps-v1',
                'current':{'followup_id':'task:old-lamp','completion_target':{'id':'activity:shade'},'resolution_evidence_ids':['task:shade']},
                'completion_targets':[{'id':'activity:shade'},{'id':'activity:use'}]},
            'use_context':{'contract':'finite-use-v1','capacity':24,'production':[{'activity_id':'use','already_held':0,'output_count':4,
                'reserve_limit':4,'uses':[],'accepted_outgoing':[]}]}}
        self.packet = SimpleNamespace(agent_id='me',inbox=[],internal_context=SimpleNamespace(relevant_relations=[]),
            spatial=SpatialPerception(location_id='bank',location_view=LocationView('岸边','现场'),world_time_label='2026-10-25 19:00',current_step=1,
                visible_agents={'seen':PerceivedPresence(identity=PerceivedIdentity(name='路人')),'peer':PerceivedPresence(identity=PerceivedIdentity(name='灯穗'))}))
        self.value = {'act':True,'selected_index':0,'inner_monologue':'罩片已装好，我想实际试一次取水，看看是否够用。',
            'action_description':'试用带罩归途灯取水','expected_outcome':'了解取水时光照够不够', 'activity_id':'use',
            'issue_choice':{'followup_decision':'continue','followup_id':'current','completion_target_id':'selected_activity',
                'step_review':{'reason':'装罩已完成，继续试用'},'followup_closure':None},
            'production_purpose':{'kind':'experiment','reason':'用一次实际取水验证罩片效果'},
            'motivation':'self_continuation','source_ids':[],'prior_root_id':'task:shade'}

    def parse(self, value):
        engine = BoundedDecision(None, context=self.context)
        result = engine._parse_llm_selection(value, self.candidates, self.packet)
        return engine, result

    def test_recorded_use_issue_reference_is_bound_once_without_model_compilation(self):
        before = deepcopy((self.value,self.context))
        engine, selection = self.parse(self.value)
        self.assertIsNotNone(selection,engine.contact_errors)
        c = engine.compiled
        self.assertEqual(c['activity_id'],'use')
        self.assertEqual(c['production_use']['reference_id'],'task:old-lamp')
        self.assertEqual(c['production_use']['target_stock'],4)
        self.assertEqual(c['completion_target_id'],'activity:use')
        self.assertEqual(c['step_review']['evidence_ids'],['task:shade'])
        self.assertEqual((self.value,self.context),before)

    def test_missing_method_and_forged_proofs_remain_rejected(self):
        value = deepcopy(self.value); value.pop('activity_id')
        self.assertIsNone(self.parse(value)[1])
        value = deepcopy(self.value); value['issue_choice']['step_review']['evidence_ids']=['task:fake']
        self.assertIsNone(self.parse(value)[1])
        self.context['continuation']['current']['resolution_evidence_ids']=[]
        self.assertIsNone(self.parse(self.value)[1])

    def test_legacy_choice_has_precise_motivation_error_and_clears_it_on_explicit_correction(self):
        value = deepcopy(self.value); value['motivation'] = 'self_actualization'
        engine, selected = self.parse(value)
        self.assertIsNone(selected)
        self.assertEqual(engine.contract_failure_code, 'cognitive_motivation_invalid')
        self.assertIn('self_actualization', engine._repair_prompt('context'))
        self.assertIsNotNone(engine._parse_llm_selection(self.value, self.candidates, self.packet))
        self.assertIsNone(engine.contract_failure_code)
        self.assertEqual(value['motivation'], 'self_actualization')

    def test_reserve_cap_and_already_proven_experiment_still_apply(self):
        value = deepcopy(self.value);value['production_purpose']={'kind':'reserve','target_stock':8,'reason':'多留一些'}
        self.assertIsNone(self.parse(value)[1])
        value['production_purpose']['target_stock']=4
        self.context['use_context']['production'][0]['already_held']=4
        self.assertIsNone(self.parse(value)[1])
        self.context['continuation']['current']['completed_steps']=[{'target':{'id':'activity:use'}}]
        self.assertIsNone(self.parse(self.value)[1])

    def test_does_not_invent_a_consumer_or_accept_an_unanswered_delivery(self):
        for kind in ('self_use','accepted_delivery'):
            value=deepcopy(self.value);value['production_purpose']={'kind':kind,'reference_id':'imagined','reason':'可能会需要'}
            self.assertIsNone(self.parse(value)[1])
        self.assertIsNone(self.parse({**self.value,'production_use':{'reference_id':'activity:use'}})[1])

    def message(self):
        return {**self.value,'selected_index':3,'activity_id':None,'production_purpose':None,'person_indices':[2],
            'contact':{'kind':'message'},'message_parts':[{'kind':'evidence','evidence_id':'task:shade'},{'kind':'question','text':'你愿意看看吗？'}],
            'issue_choice':{**self.value['issue_choice'],'completion_target_id':None,'step_review':None}}

    def test_people_indices_resolve_to_canonical_receivers_without_silent_drops(self):
        value=self.message();engine,result=self.parse(value)
        self.assertIsNotNone(result,engine.contact_errors)
        self.assertEqual(engine.compiled['receiver_indices'],[1])
        self.assertEqual(engine.contact['receiver_ids'],['peer'])
        self.assertEqual(engine.contact['followup_id'],'task:old-lamp')
        for ids in ([1,2],[2,99],[2,2],[True]):
            self.assertIsNone(self.parse({**value,'person_indices':ids})[1])

    def test_message_body_location_is_lossless_and_conflicting_bodies_are_rejected(self):
        top=self.message(); nested=deepcopy(top)
        nested['contact']['message_parts']=nested.pop('message_parts')
        before=deepcopy(nested)
        first,selected=self.parse(top); second,other=self.parse(nested)
        self.assertIsNotNone(selected,first.contact_errors)
        self.assertIsNotNone(other,second.contact_errors)
        self.assertEqual(first.compiled,second.compiled)
        self.assertEqual(nested,before)
        nested['message_parts']=deepcopy(top['message_parts'])
        self.assertIsNotNone(self.parse(nested)[1])
        nested['message_parts'][1]['text']='我其实要说另一件事。'
        self.assertIsNone(self.parse(nested)[1])

    def test_repeat_message_and_wrong_reply_not_relabelled_as_invitation(self):
        self.context['social'].update(issue_bases=[{'schema':'deskbot.issue-contact.v1','followup_id':'task:old-lamp','evidence_ids':[],'related_source_ids':[]}],
            unanswered_issues=[{'followup_id':'task:old-lamp','receiver_ids':['peer'],'evidence_ids':[],'input_ids':[]}])
        self.assertIsNone(self.parse(self.message())[1])
        self.assertIsNone(self.parse({**self.message(),'contact':{'kind':'reply','reply_to':'external-input'}})[1])

    def test_personal_closure_is_explicit_and_uses_only_selected_issue_proofs(self):
        value=deepcopy(self.value);value.update(selected_index=2,activity_id=None,production_purpose=None)
        value['issue_choice']={'followup_decision':'drop','followup_id':'current','completion_target_id':None,'step_review':None,
            'followup_closure':{'kind':'resolved','reason':'装罩这个步骤已经完成，先到这里'}}
        engine,result=self.parse(value);self.assertIsNotNone(result,engine.contact_errors)
        self.assertEqual(engine.compiled['followup_closure']['evidence_ids'],['task:shade'])
        self.context['continuation']['current']['resolution_evidence_ids']=[]
        self.assertIsNone(self.parse(value)[1])
        value['issue_choice']['followup_closure']['kind']='satisfied'
        self.assertIsNotNone(self.parse(value)[1])

    def test_prompt_contains_one_catalogue_and_preserves_body_boundary_and_alternatives(self):
        engine=BoundedDecision(None,context=self.context)
        personality=BoundedPersonality(SoulLayer(name='喵呜',agent_id='me',core_traits=('好奇',),core_values=('诚实',)),StateLayer(agent_id='me'),self.context)
        system,user,_=engine._build_decision_prompt(personality,self.packet,self.candidates)
        view=json.loads(user)
        self.assertNotIn('capabilities',view['self'])
        self.assertEqual(view['conditions']['capabilities'],self.context['capabilities'])
        self.assertIn('仅屏幕、声音、触摸、单轴转头',system)
        self.assertIn('JSON',system)
        self.assertEqual(view['action_menu'][0]['output_fields']['required_top_level'],['activity_id'])
        self.assertEqual(view['action_menu'][3]['output_fields']['required_top_level'],['person_indices','contact','message_parts'])
        self.assertNotIn('contact_intent',json.dumps(view['action_menu']))
        self.assertFalse(view['visible_or_known_people'][0]['contactable'])


if __name__=='__main__':unittest.main()
