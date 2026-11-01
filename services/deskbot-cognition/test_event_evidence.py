import json
import unittest
from pathlib import Path
from event_evidence import validate_obligation, communication_errors, EvidenceError

ROOT=Path(__file__).resolve().parents[2]
VECTORS=json.loads((ROOT/'contracts/fixtures/event-evidence.v1.json').read_text(encoding='utf-8'))


class EventEvidenceTests(unittest.TestCase):
    def test_shared_obligation_vectors(self):
        for row in VECTORS['obligation_cases']:
            with self.subTest(row['name']):
                if row['valid']:
                    validate_obligation(row['payload'],VECTORS['context'])
                else:
                    with self.assertRaises(EvidenceError):validate_obligation(row['payload'],VECTORS['context'])

    def test_shared_communication_vectors(self):
        for row in VECTORS['communication_cases']:
            with self.subTest(row['name']):
                context={'result':{'effects':{'communication':VECTORS['receipt']}}}
                self.assertEqual(not communication_errors(row['value'],context),row['valid'])
        self.assertTrue(communication_errors({'communication_evidence_id':'invented'},{}))

    def test_recorded_false_attribution_is_rejected_not_sanitized(self):
        original=json.loads((ROOT/'services/deskbot-cognition/evaluations/fixtures/r3a-event-evidence-20261031.json').read_text(encoding='utf-8'))
        before=json.dumps(original,ensure_ascii=False)
        with self.assertRaises(EvidenceError):validate_obligation(original['selected'],VECTORS['context'])
        self.assertTrue(communication_errors(original['adopted_followup'],{'result':{'effects':{'communication':VECTORS['receipt']}}}))
        self.assertEqual(before,json.dumps(original,ensure_ascii=False))

    def test_legacy_no_receipt_does_not_invent_one(self):
        self.assertEqual(communication_errors({'reason':'保留旧记录'},{}),[])
        validate_obligation({'motivation':'accepted_obligation'}, {})

if __name__=='__main__':unittest.main()
