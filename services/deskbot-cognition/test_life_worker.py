import unittest,asyncio
from life_worker import LexicalRetrieval,hydrate,plain,valid_compilation,valid_followup,contract_json,restore_relations,restore_continuity,valid_activity_binding,valid_social_compilation,valid_development_binding
from core.interfaces.llm import LLMResponse
from providers.agent_store.in_memory import InMemoryAgentStore
from collections import deque
from types import SimpleNamespace
from input_refraction import external_goals,valid_interpretations
from agent.motivation import MotivationBlender,ExternalDriveType
from agent.need import NeedType
from relationship_review import review_relationships
class LifeAdapterTests(unittest.TestCase):
 def test_development_choice_requires_own_roots_and_ready_direction(self):
  context={'development':{'topics':[{'topic':'care','active_roots':['task:own'],'recent_success_roots':[]}],'wish_options':[{'direction_id':'wetland_frog','eligible':False}]}}
  self.assertTrue(valid_development_binding({},context))
  self.assertFalse(valid_development_binding({'wish_choice':{'direction_id':'wetland_frog','decision':'propose','reason':'立刻变身'}},context))
  self.assertTrue(valid_development_binding({'wish_choice':{'direction_id':'wetland_frog','decision':'consider','reason':'先了解'}},context))
  self.assertFalse(valid_development_binding({'interest_choice':{'topic':'care','decision':'continue','reason':'别人做过','root_ids':['task:other']}},context))
  self.assertTrue(valid_development_binding({'interest_choice':{'topic':'care','decision':'pause','reason':'等条件','root_ids':['task:own']}},context))
 def test_upstream_relation_review_uses_only_own_evidence_and_skips_unchanged_sources(self):
  class Router:
   calls=0
   async def complete(self,scene,messages,**kwargs):
    self.calls+=1
    self.last=' '.join(m.content for m in messages)
    return LLMResponse('{"updates":[{"target_index":1,"labels":["想合作"],"summary":"我愿意以后再商量，尚未确立共同关系。"}]}',1,1,'mock')
  router=Router();context={'world_id':'w','actor':{'actor_id':'a'},'social':{'relation_evidence':[{'actor_id':'b','name':'苔团','sources':[{'id':'actual-message','text':'对方表示愿意晚些一起聊'}]}]}}
  output=asyncio.run(review_relationships(context,router,SimpleNamespace(soul=SimpleNamespace(name='喵呜')),0))
  self.assertEqual(output[0]['actor_id'],'b');self.assertEqual(output[0]['source_ids'],['actual-message']);self.assertEqual(router.calls,1)
  self.assertNotIn('trust_objective',output[0]);context['social']['personal_views']=output
  self.assertEqual(asyncio.run(review_relationships(context,router,SimpleNamespace(soul=SimpleNamespace(name='喵呜')),1)),[]);self.assertEqual(router.calls,1)
 def test_social_expression_binds_exact_evidence_and_private_contract_choices(self):
  context={'speech_evidence':[{'id':'actual','text':'实际完成一次测记。'}],'social':{'options':[{'option_id':'visit'}],'commitments':[{'id':'own','available_responses':['decline','delay']}]}}
  valid={'operation':'share','receiver_indices':[1],'message_parts':[{'kind':'evidence','evidence_id':'actual','quote':'实际完成一次测记。'}]}
  self.assertTrue(valid_social_compilation(valid,context))
  self.assertFalse(valid_social_compilation({**valid,'message_parts':[{'kind':'evidence','evidence_id':'actual','quote':'已经修好苗架。'}]},context))
  self.assertFalse(valid_social_compilation({**valid,'social':{'operation':'respond','commitment_id':'private','response':'accept'}},context))
  self.assertTrue(valid_social_compilation({**valid,'social':{'operation':'respond','commitment_id':'own','response':'decline'}},context))
 def test_expanded_activity_menu_requires_exact_identity_and_checks_optional_number(self):
  context={'capabilities':{'activities':[{'activity_id':'glow-set-pair','activity_index':9},{'activity_id':'glow-read-pair','activity_index':10}]}}
  self.assertTrue(valid_activity_binding({'operation':'activity','activity_id':'glow-read-pair'},context))
  self.assertFalse(valid_activity_binding({'operation':'activity','activity_id':'glow-read-pair','activity_index':9},context))
  self.assertFalse(valid_activity_binding({'operation':'activity','activity_id':'invent-skill'},context))
  self.assertFalse(valid_activity_binding({'operation':'activity','activity_index':10},context))
 def test_external_input_reuses_need_blending_without_authority_or_stacking(self):
  item={'effect':'offer','question':'一起观察吗','source_id':'one','reason':'收到邀请'}
  goals=external_goals([{**item,'source_id':str(i)} for i in range(8)])
  self.assertTrue(all(g.drive_type==ExternalDriveType.EVENT for g in goals))
  boost=MotivationBlender().external_pressure_boost(goals)
  self.assertAlmostEqual(boost[NeedType.SOCIAL],2/3)
  self.assertEqual(external_goals([{**item,'effect':'none'}]),[])
 def test_semantic_source_validation_retains_negation_and_exact_evidence(self):
  source={'id':'one','content':'不要浇水','category':'user'}
  item={'source_id':'one','kind':'negation','stance':'negated','effect':'none','topic':'浇水','question':'','reason':'否定','evidence_quote':'不要浇水','target_object_ids':[],'confidence':.9}
  self.assertTrue(valid_interpretations({'interpretations':[item]},[source]))
  self.assertFalse(valid_interpretations({'interpretations':[{**item,'effect':'inquiry'}]},[source]))
  self.assertFalse(valid_interpretations({'interpretations':[{**item,'evidence_quote':'今天已浇水'}]},[source]))
 def test_lexical_overlap_is_local_and_not_random_mock_embedding(self):
  async def check():
   provider=LexicalRetrieval();a=await provider.embed('苗床水分偏低');b=await provider.embed('苗床水分记录');c=await provider.embed('星轨导航工具')
   dot=lambda x,y:sum(i*j for i,j in zip(x.dense,y.dense))
   self.assertEqual(a,await provider.embed('苗床水分偏低'));self.assertGreater(dot(a,b),dot(a,c))
  asyncio.run(check())
 def test_state_hydration_retains_goal_origins_and_absolute_step(self):
  raw={'step':24,'emotion':{'primary':'anticipation','intensity':.4,'valence':.1},'short_term_goal_entities':[{'id':'old','text':'继续比较苗床','goal_type':'short_term','origin':'residue','status':'active','created_step':0,'due_step':25}]}
  state=hydrate(raw,'shaping-001','moss-sprout-garden');self.assertEqual(plain(state)['short_term_goal_entities'][0]['due_step'],25);self.assertEqual(state.step,24)
 def test_contract_does_not_guess_aliases_or_accept_boolean_references(self):
  self.assertFalse(valid_followup({'type':'continue','question':'x','reason':'x','delay_hours':1}))
  self.assertFalse(valid_compilation({'operation':'observe','object_index':True,'reason':'x'}))
  self.assertTrue(valid_compilation({'operation':'share','receiver_indices':[1,2],'message':'苗床需要补水','reason':'请教'}))
 def test_semantic_repair_is_an_explicit_second_call(self):
  class Router:
   calls=0
   async def complete(self,*args,**kwargs):
    self.calls+=1
    return LLMResponse('{"type":"continue","question":"x","reason":"x","delay_hours":1}' if self.calls==1 else '{"status":"continue","question":"x","reason":"x","delay_hours":1}',1,1,'mock')
  router=Router();value=asyncio.run(contract_json(router,[],valid_followup));self.assertEqual(router.calls,2);self.assertEqual(value['status'],'continue')
 def test_relations_survive_process_boundaries_without_changing_perspective(self):
  async def check():
   store=InMemoryAgentStore();record={'world_id':'world','from_id':'a','to_id':'b','trust_objective':.6,'affection_objective':.2,'interaction_count':3,'updated_step':24,'to_name':'苔团','labels':['一起做过事'],'updated_at':'2026-10-10T00:00:00Z'}
   await restore_relations(store,{'relations':[record]},'world','a');restored=await store.load_relation('world','a','b');self.assertEqual(restored.interaction_count,3);self.assertEqual(restored.labels,['一起做过事'])
   with self.assertRaisesRegex(ValueError,'private_relation_scope_invalid'):await restore_relations(store,{'relations':[record]},'world','b')
  asyncio.run(check())
 def test_recent_blocked_attempts_survive_worker_recreation_without_becoming_memories(self):
  agent=SimpleNamespace(_foiled_misses={});memory=SimpleNamespace(_recent_foiled=deque(maxlen=12))
  restore_continuity(agent,memory,{'continuity':{'recent_foiled':[[24,'设施占用',['work','bed'],'照料苗床']],'foiled_misses':[{'key':['work','bed'],'count':2,'step':24}]}})
  self.assertEqual(agent._foiled_misses[('work','bed')],(2,24));self.assertEqual(memory._recent_foiled[0][1],'设施占用')
if __name__=='__main__':unittest.main()
