import unittest,asyncio
from life_worker import LexicalRetrieval,hydrate,plain,valid_compilation,valid_followup,contract_json,restore_relations,restore_continuity,valid_activity_binding,valid_social_compilation,valid_development_binding,valid_continuation_binding,prompt_json,followup_repair,compilation_repair
from core.interfaces.llm import LLMResponse
from providers.agent_store.in_memory import InMemoryAgentStore
from collections import deque
from types import SimpleNamespace
from input_refraction import external_goals,valid_interpretations
from agent.motivation import MotivationBlender,ExternalDriveType
from agent.need import NeedType
from relationship_review import review_relationships
from continuation_contract import continuation_errors
class LifeAdapterTests(unittest.TestCase):
 def test_recorded_r3_completion_claim_in_question_gets_an_exact_repair_hint(self):
  context={'actor':{'name':'喵呜'},'inputs':[],'speech_evidence':[{'id':'task:shade','text':'安装罩片的实际记录。'}]}
  value={'operation':'share','receiver_indices':[1],'message_parts':[
   {'kind':'greeting','text':'你好'},{'kind':'evidence','evidence_id':'task:shade'},
   {'kind':'question','text':'罩我已经装上了，亮度从约零点九三降到约零点五八。你愿意一起看取水时够不够亮？'}]}
  self.assertFalse(valid_social_compilation(value,context))
  hint=compilation_repair(value,context)
  self.assertIn('message_parts[2]在自由文字中包含已完成',hint)
  value['message_parts'][2]['text']='你愿意一起看取水时够不够亮？'
  self.assertTrue(valid_social_compilation(value,context))
 def test_paraphrased_contact_requires_an_actual_new_basis_or_a_formal_proposal(self):
  context={'actor':{'name':'喵呜'},'continuation':{'current':{'followup_id':'issue'}},
   'capabilities':{'share':{'receivers':[{'actor_id':'b','name':'灯穗'}]}},
   'social':{'contact_basis':{'substantive_root':'task:old'},
    'unanswered_issues':[{'followup_id':'issue','substantive_root':'task:old','receiver_ids':['b'],'input_ids':['known']}],
    'options':[{'option_id':'give-water'}]}}
  value={'operation':'share','receiver_indices':[1],'source_ids':['known'],'message_parts':[{'kind':'question','text':'换个说法，当面聊呢？'}]}
  self.assertFalse(valid_social_compilation(value,context))
  self.assertIn('不要换措辞',compilation_repair(value,context))
  self.assertTrue(valid_social_compilation({**value,'social':{'operation':'invite','option_id':'give-water'}},context))
  self.assertTrue(valid_social_compilation({**value,'source_ids':['new-external-input']},context))
  context['social']['contact_basis']['substantive_root']='task:new-observation'
  self.assertTrue(valid_social_compilation(value,context))
 def test_continuation_identity_and_explicit_closure_are_not_guessed_from_titles(self):
  view={'schema':'deskbot.cognitive-continuation.v2','current':{'followup_id':'issue','from_root_outcome_id':'task:old'},
   'deferred':[],'completion_evidence_ids':['task:done'],'next_options':[]}
  context={'continuation':view}
  bad={'motivation':'self_continuation','prior_root_id':'task:old','followup_decision':'new'}
  self.assertTrue(continuation_errors(bad,context))
  fixed={**bad,'followup_decision':'continue','followup_id':'issue'}
  self.assertEqual(continuation_errors(fixed,context),[])
  self.assertTrue(continuation_errors({'status':'none','next_step':None},context))
  close={'status':'none','followup_id':'issue','followup_closure':{'followup_id':'issue','kind':'resolved','reason':'实际结束','evidence_ids':['task:done']}}
  self.assertEqual(continuation_errors(close,context),[])
  close['followup_closure']['evidence_ids']=['invented']
  self.assertTrue(continuation_errors(close,context))
 def test_wait_target_must_match_typed_next_step_and_social_contract(self):
  view={'schema':'deskbot.cognitive-continuation.v2','current':None,'next_options':[{'kind':'social','id':'give-water'},{'kind':'commitment','id':'gift'}],
   'wait_options':[{'kind':'reply','id':'sent','commitment_id':'gift'}]}
  value={'status':'continue','next_step':{'kind':'social','id':'give-water'},'wait_for':{'kind':'activity','id':'collect-water'}}
  self.assertTrue(continuation_errors(value,{'continuation':view}))
  value.update(next_step={'kind':'commitment','id':'gift'},wait_for={'kind':'reply','id':'sent'})
  self.assertEqual(continuation_errors(value,{'continuation':view}),[])
 def test_feedback_cannot_rebind_to_an_unrelated_deferred_issue(self):
  context={'phase':'feedback','continuation':{'schema':'deskbot.cognitive-continuation.v2',
   'current':{'followup_id':'current'},'deferred':[{'followup_id':'old'}]}}
  self.assertTrue(continuation_errors({'status':'postpone','next_step':None,'followup_id':'old'},context))
 def test_r3_nested_speech_is_rejected_and_repair_reports_all_source_and_shape_errors(self):
  context={'actor':{'name':'喵呜'},'inputs':[],'speech_evidence':[{'id':'task:own','text':'实际净滤四份清水。'}]}
  nested={'operation':'share','receiver_indices':[1],'message':'','source_ids':['task:own'],
   'speech':{'message_parts':[{'kind':'evidence','evidence_id':'task:own'}],'reply_to':None}}
  self.assertFalse(valid_social_compilation(nested,context))
  hint=compilation_repair(nested,context)
  self.assertIn('顶层message_parts',hint);self.assertIn('不属于外来输入',hint)
  repaired={**nested,'source_ids':[],'message_parts':nested['speech']['message_parts'],'reply_to':None}
  repaired.pop('speech')
  self.assertTrue(valid_social_compilation(repaired,context))
 def test_prompt_time_view_preserves_canonical_context_and_labels_midnight(self):
  context={'time':{'zone':'Asia/Shanghai'}};data={'at':'2026-10-11T18:04:00Z','text':'任务:2026-10-11T18:04:00Z'}
  shown=prompt_json(data,context);self.assertIn('2026-10-12 02:04:00 Asia/Shanghai',shown);self.assertIn('UTC',shown)
  self.assertEqual(data['at'],'2026-10-11T18:04:00Z');self.assertIn('任务:2026-10-11T18:04:00Z',shown)
 def test_ready_and_overdue_conditions_need_reconsideration_not_renewed_wait(self):
  target={'kind':'activity','id':'echo-read-bell'};context={'continuation':{'wait_options':[{**target,'available':True}]}}
  self.assertFalse(valid_continuation_binding({'operation':'wait','wait_for':target},context))
  self.assertTrue(valid_continuation_binding({'operation':'activity','wait_for':target},context))
  target={'kind':'reply','id':'own'};context={'continuation':{'wait_options':[{**target,'available':False}],'current':{'condition':'review_required','wait_for':target}}}
  self.assertFalse(valid_continuation_binding({'operation':'wait','wait_for':target},context))
  self.assertTrue(valid_continuation_binding({'operation':'wait','wait_for':None,'followup_decision':'postpone'},context))
  self.assertFalse(valid_continuation_binding({'wait_for':{'kind':'reply','id':'private'}},context))
  self.assertFalse(valid_continuation_binding({'operation':'wait','review_after_minutes':True},context))
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
 def test_r3_missing_delay_reports_exact_error_without_inventing_timing(self):
  value={'status':'continue','question':'试一次取水','reason':'已装罩还没用过','review_after_minutes':30}
  self.assertFalse(valid_followup(value))
  self.assertIn('delay_hours',followup_repair(value,{}))
  self.assertNotIn('delay_hours',value)
  self.assertTrue(valid_followup({**value,'delay_hours':1}))
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
