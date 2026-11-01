import unittest
from copy import deepcopy
import life_worker
from agent.goals import GoalEntity, GoalStatus
from agent.personality import SoulLayer, PersonalityLayer
from goal_lifecycle import CONTRACT, parse_updates
from opportunity_goals import OpportunityNeedEngine


class GoalLifecycleTests(unittest.IsolatedAsyncioTestCase):
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
