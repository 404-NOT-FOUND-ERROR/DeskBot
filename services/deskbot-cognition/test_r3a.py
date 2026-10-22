import unittest
from copy import deepcopy
from continuation_contract import continuation_errors
from context_projection import stage_context, BODY_BOUNDARY
from life_worker import BoundedPersonality, social_contact_errors, contract_json
from agent.personality import SoulLayer, StateLayer
from core.context import observe_stage, get_log_context
from core.interfaces.llm import LLMResponse
import asyncio

class R3ATests(unittest.TestCase):
    def view(self):
        return {'phase':'plan','continuation':{'schema':'deskbot.cognitive-continuation.v3',
            'current':{'followup_id':'i','resolution_evidence_ids':['task:matching']},
            'completion_evidence_ids':['task:message'], 'completion_targets':[{'id':'install'}],
            'deferred_capacity':{'used':8,'limit':8}}}

    def test_closure_must_use_own_matching_evidence_and_no_generated_predicate(self):
        c=self.view()
        v={'status':'none','followup_id':'i','followup_closure':{'followup_id':'i','kind':'resolved','reason':'实际完成','evidence_ids':['task:message']}}
        self.assertTrue(continuation_errors(v,c))
        v['followup_closure']['evidence_ids']=['task:matching']
        self.assertEqual(continuation_errors(v,c),[])
        self.assertTrue(continuation_errors({**v,'completion_target_id':'install'},c))
        self.assertTrue(continuation_errors({**v,'completion_target':{}},c))
        v['followup_closure'].update(kind='satisfied',evidence_ids=[])
        self.assertEqual(continuation_errors(v,c),[])

    def test_full_queue_is_visible_before_a_paid_repair(self):
        self.assertTrue(continuation_errors({'followup_decision':'new'},self.view()))
        self.assertEqual(continuation_errors({'followup_decision':'continue','followup_id':'i'},self.view()),[])

    def test_related_contact_parity_and_unrelated_source(self):
        c={'continuation':{'current':{'followup_id':'i'}},'capabilities':{'share':{'receivers':[{'actor_id':'peer'}]}},
           'social':{'issue_bases':[{'schema':'deskbot.issue-contact.v1','followup_id':'i','evidence_ids':['old'],'related_source_ids':['related']}],
                     'unanswered_issues':[{'followup_id':'i','receiver_ids':['peer'],'evidence_ids':['old'],'input_ids':[]}]}}
        v={'operation':'share','receiver_indices':[1],'source_ids':['unrelated']}
        self.assertTrue(social_contact_errors(v,c))
        self.assertEqual(social_contact_errors({**v,'source_ids':['related']},c),[])
        c['social']['issue_bases'][0]['evidence_ids'].append('new-related')
        self.assertEqual(social_contact_errors(v,c),[])

    def test_projection_keeps_existing_identity_facts_and_alternatives_without_mutation(self):
        c={'phase':'plan','time':{'utc':'2026-10-22T00:00:00Z'},'inventory':{'water':4},
           'continuation':{'current':{'followup_id':'i','completion_target':{'id':'water'},'resolution_evidence_ids':['task:water']},
                           'deferred':[{'followup_id':'old'}],'completion_targets':[{'id':'water'}],'next_options':[{'id':'water'}]},
           'capabilities':{'activities':[{'id':'care'},{'id':'explore'}]},'development':{'interests':['cooking']},
           'social':{'commitments':[{'id':'promise'}]},'waylight':{'law':'actual-law'}}
        old=deepcopy(c)
        for stage in ('motivation','decision'):
            self.assertEqual(stage_context(c,stage)['capabilities'],c['capabilities'])
        for stage in ('perception','feedback','memory'):
            p=stage_context(c,stage)
            self.assertEqual(p['continuation']['current'],c['continuation']['current'])
            self.assertEqual(p['social']['commitments'],c['social']['commitments'])
            self.assertNotIn('capabilities',p)
        soul=SoulLayer(name='喵呜',agent_id='me',role='居民',core_traits=('好奇',),core_values=('诚实',),hard_constraints=(BODY_BOUNDARY,))
        personality=BoundedPersonality(soul,StateLayer(agent_id='me'),c)
        with observe_stage('decision'): text=personality.to_prompt_context()
        self.assertEqual(text.count(BODY_BOUNDARY),1)
        self.assertIn('好奇',text);self.assertIn('诚实',text)
        self.assertEqual(c,old)

    def test_contract_repair_is_separate_in_usage_observation(self):
        class Router:
            def __init__(self): self.stages=[]
            async def complete(self,*args,**kwargs):
                self.stages.append(get_log_context()['stage'])
                return LLMResponse('{"ok":'+('false' if len(self.stages)==1 else 'true')+'}',0,0,'fixture')
        router=Router()
        result=asyncio.run(contract_json(router,[],lambda v:v.get('ok'),stage='compile'))
        self.assertTrue(result['ok']);self.assertEqual(router.stages,['compile','compile_repair'])

if __name__=='__main__': unittest.main()
