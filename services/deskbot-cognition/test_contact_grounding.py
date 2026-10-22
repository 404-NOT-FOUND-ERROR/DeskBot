import asyncio
import unittest
from copy import deepcopy
from types import SimpleNamespace
from life_worker import BoundedDecision, BoundedMemory
from contact_contract import contact_readiness, contact_intent_errors, bind_contact_intent, compiled_contact_errors
from agent.decision import ActionCandidate
from agent.personality import SoulLayer, StateLayer, PersonalityLayer
from core.interfaces.action import ActionType
from core.interfaces.perception import SpatialPerception, PerceivedPresence, PerceivedIdentity, LocationView
from core.interfaces.llm import LLMResponse


class ContactGroundingTests(unittest.TestCase):
    def context(self):
        return {'schema':'deskbot.cognitive-life.context.v3','actor':{'actor_id':'me','name':'喵呜'},'time':{'zone':'Asia/Shanghai'},
          'inputs':[{'id':'unrelated'},{'id':'related'}],'continuation':{'current':{'followup_id':'lamp'},'deferred':[{'followup_id':'garden'}]},
          'capabilities':{'share':{'receivers':[{'actor_id':'a','name':'苔团'},{'actor_id':'b','name':'灯穗'}]}},
          'social':{'options':[{'option_id':'give-water'}],
            'issue_bases':[{'schema':'deskbot.issue-contact.v1','followup_id':'lamp','evidence_ids':[],'related_source_ids':[]}],
            'unanswered_issues':[{'followup_id':'lamp','receiver_ids':['a','b'],'evidence_ids':[],'input_ids':[]}],
            'replies':[{'message_id':'heard:1','sender_id':'a'}]},'saved':{'outbox':[]}}

    def test_repeat_is_rejected_before_compile_but_reply_other_issue_and_relevant_new_evidence_remain_open(self):
        c=self.context(); choice={'kind':'message','followup_id':'lamp','source_ids':[]}
        self.assertFalse(contact_readiness(c)[0]['plain_message_available'])
        self.assertTrue(contact_intent_errors(choice,['a'],c)) # Narrowing recipients is not a new method.
        self.assertTrue(contact_intent_errors({**choice,'source_ids':['unrelated']},['a'],c))
        self.assertEqual(contact_intent_errors({**choice,'followup_id':'garden'},['a'],c),[])
        self.assertEqual(contact_intent_errors({**choice,'kind':'reply','reply_to':'heard:1'},['a'],c),[])
        self.assertTrue(contact_intent_errors({**choice,'kind':'reply','reply_to':'heard:1'},['b'],c))
        c['social']['issue_bases'][0]['related_source_ids']=['related']
        self.assertTrue(contact_readiness(c)[0]['plain_message_available'])
        self.assertTrue(contact_intent_errors(choice,['a'],c)) # Must actually cite the newly relevant source.
        self.assertEqual(contact_intent_errors({**choice,'source_ids':['related']},['a'],c),[])
        c['social']['issue_bases'][0]['evidence_ids']=['task:actual-related']
        self.assertEqual(contact_intent_errors(choice,['a'],c),[])

    def test_formal_offer_requires_actor_choice_one_person_and_actual_availability(self):
        c=self.context(); choice={'kind':'invite','option_id':'give-water','followup_id':'lamp','source_ids':[]}
        before=deepcopy(choice)
        self.assertTrue(contact_intent_errors(choice,['a','b'],c))
        self.assertEqual(contact_intent_errors(choice,['b'],c),[])
        self.assertTrue(contact_intent_errors(choice,['visible-but-not-contactable'],c))
        c['social']['invitation_availability']=[{'option_id':'give-water','receiver_id':'b','available':False}]
        self.assertTrue(contact_intent_errors(choice,['b'],c));self.assertEqual(choice,before)

    def test_external_named_invitation_has_no_local_reply_address(self):
        c=self.context();c['social']['unanswered_issues']=[];c['social']['replies']=[]
        choice={'kind':'reply','followup_id':'lamp','source_ids':['related'],'reply_to':'related'}
        errors=contact_intent_errors(choice,['b'],c)
        self.assertTrue(errors);self.assertIn('不是镇内已收消息',errors[0]);self.assertIn('只有[]',errors[0])
        # The actor may choose to discuss received information, but code does not
        # relabel it as a direct reply or identify an external signature as a peer.
        self.assertEqual(contact_intent_errors({**choice,'kind':'message'},['b'],c),[])
        self.assertEqual(choice['kind'],'reply')

    def test_prompt_has_one_supported_action_contract_and_marks_noncontactable_people(self):
        c=self.context(); engine=BoundedDecision(None,context=c)
        spatial=SpatialPerception(location_id='bank',location_view=LocationView('岸边','现场'),world_time_label='2026-10-22 09:00',current_step=1,
            visible_agents={aid:PerceivedPresence(identity=PerceivedIdentity(name=name)) for aid,name in [('seen','波果'),('a','苔团')]})
        packet=SimpleNamespace(agent_id='me',spatial=spatial,inbox=[],internal_context=SimpleNamespace(relevant_relations=[]))
        soul=SoulLayer(name='喵呜',agent_id='me',role='居民',core_traits=('好奇',),core_values=('可靠',))
        personality=PersonalityLayer(soul,StateLayer(agent_id='me'))
        system,user,_=engine._build_decision_prompt(personality,packet,[ActionCandidate(ActionType.SEND_MESSAGE,'留言')])
        import json
        view=json.loads(user)
        self.assertEqual([(p['person_index'],p['contactable']) for p in view['visible_or_known_people']],[(1,False),(2,True)])
        for unsupported in ('TALK','ERRAND','message_announce','physical_recipient_index'):
            self.assertNotIn(unsupported,system)
        self.assertIn('own_recall',view);self.assertIn('direction',view);self.assertIn('自己的需要',system)

    def test_recorded_reask_is_rejected_at_upstream_selection_and_not_rewritten_as_an_offer(self):
        c=self.context(); engine=BoundedDecision(None,context=c)
        spatial=SpatialPerception(location_id='bank',location_view=LocationView('岸边','现场'),world_time_label='2026-10-22 09:00',current_step=1,
            visible_agents={r['actor_id']:PerceivedPresence(identity=PerceivedIdentity(name=r['name'])) for r in c['capabilities']['share']['receivers']})
        packet=SimpleNamespace(agent_id='me',spatial=spatial,inbox=[],internal_context=SimpleNamespace(relevant_relations=[]))
        candidates=[ActionCandidate(ActionType.SEND_MESSAGE,'留言'),ActionCandidate(ActionType.WORK,'做事')]
        payload={'selected_index':0,'person_indices':[1,2],'action_description':'当面问清谁要水',
            'contact_intent':{'kind':'message','followup_id':'lamp','source_ids':[]}}
        self.assertIsNone(engine._parse_llm_selection(payload,candidates,packet));self.assertIsNone(engine.contact)
        self.assertEqual(payload['contact_intent']['kind'],'message')
        payload['contact_intent'].update(kind='invite',option_id='give-water')
        self.assertIsNone(engine._parse_llm_selection(payload,candidates,packet))
        payload['person_indices']=[2]
        self.assertIsNotNone(engine._parse_llm_selection(payload,candidates,packet))
        self.assertEqual(engine.contact['receiver_ids'],['b'])
        self.assertEqual(engine.contact['kind'],'invite')

    def test_compiler_cannot_change_chosen_message_or_receiver_into_its_own_social_plan(self):
        c=self.context(); choice=bind_contact_intent({'kind':'message','followup_id':'garden','source_ids':[]},['a'])
        v={'operation':'share','receiver_indices':[1],'followup_id':'garden','source_ids':[],'social':None,'reply_to':None}
        self.assertEqual(compiled_contact_errors(v,c,choice),[])
        for change in ({'social':{'operation':'invite','option_id':'give-water'}},{'receiver_indices':[2]},{'followup_id':'lamp'},{'operation':'rest'}):
            self.assertTrue(compiled_contact_errors({**v,**change},c,choice))
        self.assertTrue(compiled_contact_errors(v,c,None))
        self.assertEqual(compiled_contact_errors({'operation':'activity'},c,None),[])

    def test_memory_path_receives_vocabulary_and_owner_without_modifying_fact_or_extra_model_call(self):
        c=self.context(); c['grounding']={'resources':{'raw_water':'泉水原水','water':'清水'},
            'assets':[{'asset_id':'lamp:1','owner_id':'me','owner_name':'我'}],
            'quantities':{'waylight.charge':'光叶的蓄光量，不是电池电量'}}
        class Router:
            def __init__(self):self.requests=[]
            async def complete(self,scene,messages,**kwargs):
                self.requests.append(messages);return LLMResponse('手边的光终于帮上忙了，我有点踏实。',0,0,'fixture')
        router=Router();memory=BoundedMemory(router,None,None,context=c,world_id='fictional',agent_id='me')
        soul=SoulLayer(name='喵呜',agent_id='me',role='居民',core_traits=('好奇',),core_values=('可靠',))
        personality=PersonalityLayer(soul,StateLayer(agent_id='me'))
        fact='我实际净滤得到4份清水，背包water=4。'
        text=asyncio.run(memory._write_experiential(raw_content=fact,personality=personality))
        self.assertIn('踏实',text);self.assertEqual(len(router.requests),1)
        prompt=router.requests[0][-1].content
        self.assertIn(fact,prompt);self.assertIn('泉水原水',prompt);self.assertIn('蓄光量',prompt);self.assertIn('"owner_name":"我"',prompt)
        self.assertEqual(fact,'我实际净滤得到4份清水，背包water=4。')


if __name__=='__main__':unittest.main()
