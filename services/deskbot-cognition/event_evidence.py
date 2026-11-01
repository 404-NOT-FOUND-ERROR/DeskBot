"""The same event evidence contract as Node; never invent a corrected choice."""
import json
from pathlib import Path

CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'contracts/cognitive-event-evidence.v1.json').read_text(encoding='utf-8'))


class EvidenceError(ValueError):
    def __init__(self, kind, detail):
        self.code=CONTRACT['errors'][kind]
        super().__init__(self.code+'；'+detail)


def validate_obligation(payload, context):
    view=context.get('event_evidence') or {}
    if view.get('schema')!=CONTRACT['schema']:
        return
    ref=payload.get('obligation_ref')
    if payload.get('motivation')!='accepted_obligation':
        if ref is not None:
            raise EvidenceError('obligation','只有accepted_obligation填写obligation_ref；不要附带无关约定')
        return
    if (not isinstance(ref,dict) or set(ref)!=set(CONTRACT['obligation_ref_fields'])
        or type(ref.get('terms_revision')) is not int
        or not any(o['commitment_id']==ref.get('commitment_id') and o['terms_revision']==ref['terms_revision']
                   and payload['choice_id'] in o['choice_ids'] for o in view.get('obligations',[]))):
        raise EvidenceError('obligation',CONTRACT['obligation_rule'])


def communication_errors(value,context):
    receipt=(context.get('result') or {}).get('effects',{}).get('communication')
    if not receipt:
        return [CONTRACT['errors']['communication']+'；没有本次回执，不可编造communication_evidence_id'] if value.get('communication_evidence_id') is not None else []
    if (receipt.get('schema')!=CONTRACT['receipt_schema'] or value.get('communication_evidence_id')!=receipt['id']
        or value.get('reason')!=receipt['summary']):
        return [CONTRACT['errors']['communication']+'；'+CONTRACT['feedback_rule']
                +' 本次communication_evidence_id='+receipt['id']+'；reason='+receipt['summary']]
    return []
