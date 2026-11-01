import unittest
import json
from copy import deepcopy
import life_worker
from agent.goals import GoalEntity, GoalStatus
from agent.personality import SoulLayer, PersonalityLayer
from goal_lifecycle import CONTRACT, parse_updates
from opportunity_goals import OpportunityNeedEngine
from core.interfaces.llm import LLMResponse


class GoalLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_progress_skips_call_but_preserves_closed_history_and_new_goal_formation(self):
        _,c=self.setup_context();c['evidence_refs']={'schema':'deskbot.evidence-refs.v1','entries':[]}
        c['goal_lifecycle']['goals']=[];c['actor']={'actor_id':'test'}
        calls=[]
        class Router:
            async def complete(self,scene,messages,**kwargs):
                calls.append(messages)
                return LLMResponse(json.dumps({'goal_updates':[{'operation':'new','goal_id':'goal:new','text':'试着理解夜晚的光',
                    'criterion_id':None,'next_step':None,'reason':'我想带着一个问题继续观察'}]}),0,0,'offline-stub')
        p=PersonalityLayer(SoulLayer(name='测试居民',agent_id='test'))
        closed=GoalEntity(id='closed',text='旧任务',goal_type='short_term',status=GoalStatus.COMPLETED)
        p.set_short_term_goal_entities([closed]);need=OpportunityNeedEngine(Router(),context=c)
        result=await need.evaluate_goal_progress(step=40,action_description='休息',action_result='休息结束',personality=p)
        self.assertEqual(result,[closed]);self.assertEqual(calls,[])
        self.assertEqual(need.maintenance,{'called':False,'reason':'no_live_goals'})
        c['phase']='plan';p.set_short_term_goal_entities([])
        await need._generate_short_term_goals(personality=p,now_step=41)
        self.assertEqual(len(calls),1);self.assertEqual(need.updates[0]['operation'],'new')
        self.assertEqual(need.lifecycle_entities[0].text,'试着理解夜晚的光')

    async def test_live_overnight_goal_still_calls_maintenance_and_open_inquiry_cannot_complete(self):
        goal,c=self.setup_context();c['evidence_refs']={'schema':'deskbot.evidence-refs.v1','entries':[]}
        calls=[]
        class Router:
            async def complete(self,scene,messages,**kwargs):
                calls.append(json.loads(messages[-1].content))
                return LLMResponse(json.dumps({'goal_updates':[{'operation':'postpone','goal_id':goal.id,'reason':'今晚先休息','review_in_hours':12}]}),0,0,'offline-stub')
        p=PersonalityLayer(SoulLayer(name='测试居民',agent_id='test'));p.set_short_term_goal_entities([goal])
        need=OpportunityNeedEngine(Router(),context=c)
        result=await need.evaluate_goal_progress(step=40,action_description='休息',action_result='休息结束',personality=p)
        self.assertEqual(len(calls),1);self.assertEqual(result[0].status,GoalStatus.INTERRUPTED)
        self.assertNotIn('criteria',calls[0]['goals']);self.assertNotIn('next_options',calls[0])
        self.assertEqual(calls[0]['goals']['goals'][0]['completion_criteria'],{'kind':'open_inquiry'})
        self.assertEqual(result[0].id,goal.id)

    def setup_context(self):
        goal=GoalEntity(id='goal:old',text='等下个夜晚再看',goal_type='short_term',created_step=0,due_step=2)
        c={'phase':'feedback','at':'2026-11-02T12:00:00Z','continuation':{'next_options':[]},
           'goal_lifecycle':{'schema':CONTRACT['schema'],'criteria':[], 'goals':[{
            'goal_id':goal.id,'text':goal.text,'completion_criteria':{'kind':'open_inquiry'},
            'lifecycle_status':'active','review_due':True,'evidence_ids':[]}]}}
        return goal,c

    async def test_no_router_does_not_reap_an_overnight_goal_or_mutate_its_deadline(self):
        goal,c=self.setup_context();p=PersonalityLayer(SoulLayer(name='测试居民',agent_id='test'))
        p.set_short_term_goal_entities([goal])
        need=OpportunityNeedEngine(None,context=c)
        result=await need.evaluate_goal_progress(step=40,action_description='休息',action_result='休息结束',personality=p)
        self.assertEqual(result[0].id,goal.id);self.assertEqual(result[0].status,GoalStatus.ACTIVE)
        self.assertEqual(result[0].due_step,2);self.assertEqual(need.updates,[])

    async def test_near_text_goals_keep_distinct_ids_without_similarity_merging(self):
        _,c=self.setup_context();c['phase']='plan';c['goal_lifecycle']['goals']=[]
        goals,updates=parse_updates({'goal_updates':[
            {'operation':'new','goal_id':None,'text':'测记无遮罩夜里的灯光','reason':'比较条件一'},
            {'operation':'new','goal_id':None,'text':'测记有遮罩夜里的灯光','reason':'比较条件二'}]},c,[],0)
        self.assertEqual(len(goals),2);self.assertNotEqual(goals[0].id,goals[1].id)
        self.assertEqual(parse_updates({'goal_updates':updates},c,[],0)[0],goals)

    async def test_postpone_resume_and_abandon_are_explicit_not_completed(self):
        goal,c=self.setup_context()
        result,_=parse_updates({'goal_updates':[{'goal_id':goal.id,'operation':'postpone','review_in_hours':12,'reason':'休息后再看'}]},c,[goal],20)
        self.assertEqual(result[0].status,GoalStatus.INTERRUPTED);self.assertEqual(goal.status,GoalStatus.ACTIVE)
        c['goal_lifecycle']['goals'][0]['lifecycle_status']='postponed'
        resumed,_=parse_updates({'goal_updates':[{'goal_id':goal.id,'operation':'resume','reason':'现在有余力'}]},c,result,32)
        self.assertEqual(resumed[0].status,GoalStatus.ACTIVE);self.assertEqual(resumed[0].due_step,goal.due_step)
        with self.assertRaisesRegex(ValueError,'goal_completion_without_result'):
            parse_updates({'goal_updates':[{'goal_id':goal.id,'operation':'complete','reason':'感觉已经理解'}]},c,result,32)

    async def test_unknown_updates_cannot_silently_delete_or_replace_the_queue(self):
        goal,c=self.setup_context();before=deepcopy(goal)
        with self.assertRaises(ValueError):parse_updates({'goal_updates':[{'goal_id':'unknown','operation':'complete','reason':'完成'}]},c,[goal],40)
        self.assertEqual(goal,before)


if __name__=='__main__':unittest.main()
