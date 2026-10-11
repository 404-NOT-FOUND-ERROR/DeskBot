import hashlib
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).parent/'vendor/asamana'))
from core.interfaces.llm import IndexedRef, extract_json
from agent.personality import SoulLayer, PersonalityLayer
from contract_validation import validate

class ContractsTest(unittest.TestCase):
    def test_vendor_hashes(self):
        root=Path(__file__).parent/'vendor'
        manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
        for entry in manifest['files']:
            self.assertEqual(hashlib.sha256((root/'asamana'/entry['path']).read_bytes()).hexdigest(),entry['sha256'])

    def test_bounded_index_rejects_boolean_unknown_duplicate(self):
        self.assertEqual(IndexedRef(['a','b']).resolve([True,0,9,'#2',2,'person 1']),['b'])

    def test_personality_uses_own_constraints(self):
        soul=SoulLayer(name='喵呜',core_traits=['好奇'],hard_constraints=['没有摄像头'])
        prompt=PersonalityLayer(soul).to_prompt_context()
        self.assertIn('好奇',prompt)
        self.assertIn('没有摄像头',soul.hard_constraints)
        self.assertNotIn('别人的秘密',prompt)

    def test_fenced_json_and_invalid_json(self):
        self.assertEqual(extract_json('```json\n{"x":1}\n```'),{'x':1})
        with self.assertRaises(ValueError):extract_json('not json')

    def test_memory_contract_does_not_allow_practice_or_extra_fields(self):
        value={'schema':'deskbot.cognition.memory-commit.v1','scope':'isolated_mock','request_id':'r','actor_id':'a','memory_id':'m','result_id':'z','root_id':'root','memory_group_id':'group','facts':['observed'],'interpretation':'unknown','recorded_at':'2026-10-09T00:00:00Z','practice_delta':0}
        validate('memory-commit',value)
        for patch in [{'practice_delta':1},{'inventory_delta':1},{'recorded_at':'2026-10-09'}]:
            with self.assertRaises(ValueError):validate('memory-commit',{**value,**patch})

if __name__=='__main__':unittest.main()
