import unittest
import asyncio
from types import SimpleNamespace
from life_worker import BoundedMemory,BoundedDecision
from agent.decision import ActionCandidate
from core.interfaces.action import ActionType
from core.interfaces.perception import SpatialPerception,LocationView
from core.interfaces.llm import LLMResponse
from continuation_contract import continuation_errors,issue_choice_errors,compiled_issue_errors
from life_semantics import production_errors,compiled_method_errors,render_anchored_memory

class LifeSemanticsTests(unittest.TestCase):
 def test_recorded_experiment_reference_confusion_names_exact_field_without_changing_intent(self):
  c={'use_context':{'contract':'finite-use-v1','capacity':24,'production':[{'activity_id':'waylight-use','already_held':0}]},'continuation':{'current':{'followup_id':'task:fixture-built-lamp','completed_steps':[{'target':{'id':'activity:waylight-fit-shade'}}]}}}
  v={'operation':'activity','activity_id':'waylight-use','followup_decision':'continue','followup_id':'task:fixture-built-lamp','completion_target_id':'activity:waylight-use','production_use':{'activity_id':'waylight-use','kind':'experiment','target_stock':4,'reference_id':'activity:waylight-use','reason':'检验罩片朝归路时照明够不够'}}
  errors=production_errors(v,c);self.assertEqual(len(errors),1)
  self.assertIn('production_use.reference_id',errors[0]);self.assertIn('task:fixture-built-lamp',errors[0]);self.assertIn('不表示活动不能做',errors[0])
  v['production_use']['reference_id']='task:fixture-built-lamp';self.assertEqual(production_errors(v,c),[])
  v['completion_target_id']=None;self.assertIn('completion_target_id',production_errors(v,c)[0])
 def test_recorded_missing_method_is_explained_without_inferring_it_from_target(self):
  c={'phase':'plan','use_context':{'contract':'finite-use-v1','capacity':24,'production':[]},'capabilities':{'activities':[{'activity_id':'waylight-fit-shade'}]},'continuation':{'schema':'deskbot.cognitive-continuation.v3','decision_contract':'issue-choice-v2','current':{'followup_id':'q'},'completion_targets':[{'id':'activity:waylight-fit-shade'}]}}
  engine=BoundedDecision(None,context=c)
  packet=SimpleNamespace(agent_id='me',spatial=SpatialPerception(location_id='bank',location_view=LocationView('岸边','现场'),current_step=1,world_time_label='2026-10-23 19:00'),inbox=[],internal_context=SimpleNamespace(relevant_relations=[]))
  value={'act':True,'selected_index':0,'action_description':'给归途灯装上遮光罩','issue_choice':{'followup_id':'q','followup_decision':'continue','completion_target_id':'activity:waylight-fit-shade','followup_closure':None,'step_review':None},'production_use':None}
  candidates=[ActionCandidate(ActionType.WORK,'做事')]
  self.assertIsNone(engine._parse_llm_selection(value,candidates,packet));self.assertIsNone(engine.method)
  prompt=engine._repair_prompt('当前现场');self.assertIn('上次返回（没有执行）',prompt);self.assertIn('JSON顶层必填字段',prompt)
  self.assertIn('给归途灯装上遮光罩',prompt)
  self.assertIsNotNone(engine._parse_llm_selection({**value,'activity_id':'waylight-fit-shade'},candidates,packet))
  self.assertEqual(engine.method,'waylight-fit-shade')
 def test_proved_but_unacknowledged_experiment_does_not_justify_repeated_stock(self):
  c={'use_context':{'contract':'finite-use-v1','capacity':24,'production':[{'activity_id':'water','already_held':4}]},'continuation':{'current':{'followup_id':'q','completion_target':{'id':'activity:water'},'resolution_evidence_ids':['task:water']}}}
  v={'operation':'activity','activity_id':'water','followup_decision':'continue','followup_id':'q','completion_target_id':'activity:water','production_use':{'activity_id':'water','kind':'experiment','target_stock':8,'reference_id':'q','reason':'再做一次'}}
  self.assertTrue(production_errors(v,c))
  c['continuation']['current']['resolution_evidence_ids']=[];self.assertEqual(production_errors(v,c),[])
 def test_ready_condition_rejected_in_feedback_but_personal_delay_allowed(self):
  option={'kind':'activity','id':'use','available':True}
  c={'phase':'feedback','continuation':{'schema':'deskbot.cognitive-continuation.v3','wait_contract':'current-method-v1','wait_options':[option],'next_options':[option]}}
  v={'status':'continue','next_step':{'kind':'activity','id':'use'},'wait_for':{'kind':'activity','id':'use'}}
  self.assertTrue(continuation_errors(v,c));self.assertEqual(continuation_errors({**v,'wait_for':None},c),[])
 def test_acknowledged_step_changes_criterion_without_closing_question(self):
  c={'phase':'plan','continuation':{'schema':'deskbot.cognitive-continuation.v3','decision_contract':'issue-choice-v2','step_contract':'completed-steps-v1',
    'current':{'followup_id':'q','completion_target':{'id':'install'},'resolution_evidence_ids':['task:install']},'completion_targets':[{'id':'use'}]}}
  v={'followup_decision':'continue','followup_id':'q','completion_target_id':'use','followup_closure':None,'step_review':{'target_id':'install','reason':'这一步已做完，继续检验','evidence_ids':['task:install']}}
  self.assertEqual(issue_choice_errors(v,c),[])
  self.assertTrue(issue_choice_errors({**v,'step_review':None},c))
  self.assertTrue(compiled_issue_errors({**v,'step_review':None},v))
  self.assertTrue(continuation_errors(v,{**c,'phase':'feedback'}))
 def test_existing_reserve_and_unaccepted_demands_do_not_justify_production(self):
  c={'use_context':{'contract':'finite-use-v1','capacity':24,'production':[{'activity_id':'water','already_held':4,'accepted_outgoing':[],'uses':[{'activity_id':'garden','count':2}]}]}}
  v={'operation':'activity','activity_id':'water','production_use':{'activity_id':'water','kind':'reserve','target_stock':4,'reference_id':None,'reason':'备用'}}
  self.assertTrue(production_errors(v,c))
  v['production_use'].update(kind='accepted_delivery',reference_id='pending',target_stock=8)
  self.assertTrue(production_errors(v,c))
  v['production_use'].update(kind='self_use',reference_id='garden',target_stock=2)
  self.assertTrue(production_errors(v,c))
 def test_memory_frame_cannot_be_shortened_to_greeting_or_invent_extra_facts(self):
  f={'at':'2026-10-23','facts':[{'id':'action','text':'我完成递话。'},{'id':'delivery','text':'完整留言：你好\n罩片已装好\n我想再观察'}]}
  v={'fact_ids':['action','delivery'],'focus_id':'delivery','feeling':'我期待能一起看看，也有点担心打扰。'}
  self.assertIn(f['facts'][1]['text'],render_anchored_memory(f,v))
  self.assertEqual(render_anchored_memory(f,{**v,'fact_ids':['action']}),'')
  self.assertEqual(render_anchored_memory(f,{**v,'fact_ids':['action','delivery','invented']}),'')
 def test_compilation_preserves_method_and_personal_target(self):
  c={'use_context':{'contract':'finite-use-v1','capacity':24,'production':[]}}
  self.assertTrue(compiled_method_errors({'operation':'activity','activity_id':'other'},c,'chosen',None))
  self.assertTrue(compiled_method_errors({'operation':'rest','production_use':{}},c,None,None))
  self.assertEqual(compiled_method_errors({'operation':'rest','production_use':None},c,None,None),[])
 def test_anchored_memory_reuses_one_call_and_omits_invalid_affect_without_retry(self):
  class Router:
   calls=0
   async def complete(self,scene,messages,**kwargs):
    self.calls+=1;self.json_mode=kwargs.get('json_mode')
    return LLMResponse('{"fact_ids":["delivery"],"focus_id":"delivery","feeling":"我有点期待。"}',1,1,'mock')
  memory=object.__new__(BoundedMemory);memory._llm_router=Router();memory.anchor_checks=[]
  memory.context={'actor':{'name':'喵呜'},'result':{'personal_fact':'原始事实','memory_frame':{'root_outcome_id':'m','at':'2026-10-23','facts':[{'id':'delivery','text':'你好\n罩片已装好\n我想再观察'}]}}}
  person=SimpleNamespace(soul=SimpleNamespace(traits_text=lambda:'好奇',values_text=lambda:'真实'),state=SimpleNamespace(emotion=SimpleNamespace(summary=lambda:'期待')))
  text=asyncio.run(memory._write_experiential(raw_content='原始事实',personality=person))
  self.assertIn('罩片已装好\n我想再观察',text);self.assertEqual(memory._llm_router.calls,1);self.assertTrue(memory._llm_router.json_mode)
  memory.context['result']['memory_frame']['facts'].append({'id':'extra','text':'重要的额外事实'})
  self.assertEqual(asyncio.run(memory._write_experiential(raw_content='原始事实',personality=person)),'')
  self.assertEqual(memory._llm_router.calls,2);self.assertEqual(memory.anchor_checks[-1]['status'],'omitted_invalid_affect')

if __name__=='__main__': unittest.main()
