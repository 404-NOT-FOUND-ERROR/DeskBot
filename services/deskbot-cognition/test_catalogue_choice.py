import unittest
from types import SimpleNamespace as NS
from catalogue_choice import bind_catalogue_choice
from life_semantics import render_anchored_memory


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.context={'continuation':{'current':{'followup_id':'issue-1','completion_target':{'id':'activity:old'},'resolution_evidence_ids':['task:old']},'deferred':[]},
            'choice_catalogue':{'choices':[{'id':'chosen','title':'做一个真实步骤','binding':{'operation':'activity','activity_id':'new'}}]},'saved':{}}
        self.payload={'act':True,'choice_id':'chosen','inner_monologue':'我还想知道下一步的效果','expected_outcome':'增进了解',
            'issue':{'decision':'continue','id':'current'},'motivation':'self_continuation','source_ids':[]}
        self.candidates=[NS(action_type=NS(value='work'))]

    def bind(self):
        return bind_catalogue_choice(self.payload,self.context,self.candidates,[])[1]

    def test_archives_only_proved_step_and_preserves_unfinished_goal(self):
        c=self.bind()
        self.assertEqual(c['step_review']['evidence_ids'],['task:old'])
        self.assertEqual(c['completion_target_id'],'activity:new')
        self.context['continuation']['current']['resolution_evidence_ids']=[]
        c=self.bind();self.assertIsNone(c['step_review'])
        self.assertEqual(c['completion_target_id'],'activity:old')

    def test_cannot_override_method_with_prose_or_extra_payload(self):
        self.payload['activity_id']='forged'
        with self.assertRaises(ValueError):self.bind()
        del self.payload['activity_id'];self.payload['inner_monologue']='我已经把水送给邻居了'
        self.assertEqual(self.bind()['activity_id'],'new')

    def test_lossless_nested_causality_and_owned_result_citation(self):
        self.context['inputs']=[]
        self.payload['issue'].update(motivation=self.payload.pop('motivation'),source_ids=['task:old'])
        del self.payload['source_ids']
        c=self.bind()
        self.assertEqual(c['source_ids'],[])
        self.assertEqual(c['own_evidence_ids'],['task:old'])
        self.assertEqual(c['prior_root_id'],'task:old')
        self.assertEqual(c['activity_id'],'new')
        self.assertEqual(c['reason'],self.payload['inner_monologue'])
        self.payload['motivation']='need'
        with self.assertRaisesRegex(ValueError,'冲突'):self.bind()

    def test_unknown_result_prefix_is_not_evidence(self):
        self.payload['source_ids']=['task:invented']
        with self.assertRaisesRegex(ValueError,'未知证据'):self.bind()

    def test_affect_cannot_invent_facts_and_keeps_every_anchor(self):
        frame={'affect_contract':'bounded-affect-v1','at':'now','facts':[{'id':'a','text':'没有交付水。'},{'id':'b','text':'对方未回复。'}]}
        output=render_anchored_memory(frame,{'focus_id':'b','feeling':'uncertain','wish':'wait'})
        self.assertIn('没有交付水。',output);self.assertIn('对方未回复。',output);self.assertIn('第2项',output)
        self.assertEqual(render_anchored_memory(frame,{'focus_id':'b','feeling':'他因为收到水很开心','wish':'wait'}),'')
        self.assertEqual(render_anchored_memory(frame,{'focus_id':'b','feeling':'curious','wish':'wait','fact_ids':['b']}),'')


if __name__=='__main__':unittest.main()
