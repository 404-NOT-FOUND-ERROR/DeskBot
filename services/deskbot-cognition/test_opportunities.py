import unittest
from copy import deepcopy
from dataclasses import replace
import life_worker  # Installs the unchanged vendored Asamana import path.
from agent.goals import GoalEntity, GoalStatus
from opportunity_contract import CONTRACT, opportunity_errors
from opportunity_goals import parse_goal_opportunities, grounded_goal_progress
from context_projection import continuation_view


class OpportunityTests(unittest.TestCase):
    def context(self):
        row = {'kind':'opportunity', 'id':'measure', 'opportunity_id':'measure', 'identity':'conditions',
               'title':'实际测记', 'status':'ready', 'available':True, 'requires_issue':None}
        return {'phase':'plan', 'continuation':{'opportunity_contract':CONTRACT['view_schema'],
                'current':None, 'deferred':[], 'next_options':[row], 'wait_options':[row]},
                'goal_opportunities':{'schema':CONTRACT['goal_schema'], 'goals':[]}}

    def test_concrete_goal_retains_exact_reference_while_old_text_is_only_an_aspiration(self):
        goals, bindings = parse_goal_opportunities({'goals':[{'text':'测记明暗', 'next_step':{'kind':'opportunity','id':'measure'}, 'due_in_hours':None},
            {'text':'以后去云海', 'due_in_hours':None}]}, self.context())
        self.assertEqual(goals,[('测记明暗',None),('以后去云海',None)])
        self.assertEqual(list(bindings),['测记明暗'])
        self.assertEqual(parse_goal_opportunities({'goals':['以后去云海']},self.context())[1],{})

    def test_unknown_or_satisfied_opportunities_cannot_be_created_by_goal_names(self):
        for ref in [{'kind':'opportunity','id':'invented'}, {'kind':'activity','id':'measure'}, {'kind':'opportunity','id':'measure','done':True}]:
            with self.assertRaises(ValueError):
                parse_goal_opportunities({'goals':[{'text':'我想办法', 'next_step':ref}]},self.context())
        c=self.context();c['continuation']['next_options']=[]
        with self.assertRaises(ValueError):
            parse_goal_opportunities({'goals':[{'text':'再叫另一个名字', 'next_step':{'kind':'opportunity','id':'measure'}}]},c)
        with self.assertRaises(ValueError):
            parse_goal_opportunities({'goals':[{'text':'测记', 'next_step':{'kind':'opportunity','id':'measure'}, 'followup_id':'invented'}]},self.context())

    def test_goal_format_failure_does_not_generate_a_default_goal_or_fabricated_binding(self):
        for data in [None, {'goals':{}}, {'goals':[{'text':'', 'next_step':None}]},
                     {'goals':[{'text':'明天', 'due_in_hours':True, 'next_step':None}]},
                     {'goals':[{'text':'一个','next_step':None}]*2}]:
            with self.assertRaises(ValueError):parse_goal_opportunities(data,self.context())

    def test_bound_completion_requires_actual_evidence_but_open_appraisal_has_no_world_authority(self):
        g=GoalEntity(id='g',text='测记',goal_type='short_term');completed=replace(g,status=GoalStatus.COMPLETED)
        c=self.context();c['goal_opportunities']['goals']=[{'goal_id':'g','evidence_ids':[]}]
        self.assertEqual(grounded_goal_progress([completed],[g],c)[0].status,GoalStatus.ACTIVE)
        self.assertEqual(g.status,GoalStatus.ACTIVE)
        c['goal_opportunities']['goals'][0]['evidence_ids']=['task:actual']
        self.assertEqual(grounded_goal_progress([completed],[g],c)[0].status,GoalStatus.COMPLETED)
        self.assertEqual(grounded_goal_progress([completed],[g],self.context())[0].status,GoalStatus.COMPLETED)

    def test_wait_conditions_are_shared_and_expired_wait_cannot_be_renewed_in_feedback(self):
        c=self.context();v={'status':'continue','next_step':{'kind':'opportunity','id':'measure'},'wait_for':{'kind':'opportunity','id':'measure'}}
        self.assertIn('followup_condition_already_ready',opportunity_errors(v,c))
        c['continuation']['next_options'][0].update(available=False,status='blocked')
        self.assertEqual(opportunity_errors(v,c),[])
        c['phase']='feedback';c['continuation']['current']={'followup_id':'same','condition':'review_required','wait_for':v['wait_for']}
        self.assertIn('followup_wait_needs_reconsideration',opportunity_errors(v,c))
        parked=c['continuation'].pop('current');c['continuation']['deferred']=[parked];v['followup_id']='same'
        self.assertIn('followup_wait_needs_reconsideration',opportunity_errors(v,c))

    def test_prompt_projection_keeps_condition_identity_without_copying_executable_command_payloads(self):
        c=self.context();c['continuation']['next_options'][0]['binding']={'operation':'activity','secretly_duplicated_payload':'long text'}
        before=deepcopy(c);view=continuation_view(c)
        self.assertNotIn('binding',view['next_options'][0]);self.assertEqual(view['next_options'][0]['identity'],'conditions')
        self.assertEqual(c,before)


if __name__=='__main__':unittest.main()
