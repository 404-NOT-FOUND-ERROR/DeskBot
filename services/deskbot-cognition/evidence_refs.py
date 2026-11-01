"""Use the same actor-visible evidence types as the Node adoption boundary."""
import json
from pathlib import Path
CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'contracts/cognitive-evidence-refs.v1.json').read_text(encoding='utf-8'))

class EvidenceReferenceError(ValueError):
    def __init__(self,code):
        super().__init__(code)
        self.code=code

def classify_evidence(ids,view,use='choice_context'):
    c=CONTRACT; result={'source_ids':[],'own_evidence_ids':[],'context_evidence_ids':[]}
    if not isinstance(ids,list) or any(not isinstance(i,str) for i in ids):raise EvidenceReferenceError(c['errors']['unavailable'])
    for id in dict.fromkeys(ids):
        row=next((r for r in view.get('entries',[]) if r['id']==id),None)
        if row is None:raise EvidenceReferenceError(c['errors']['unavailable'])
        if row.get('status')!='available':raise EvidenceReferenceError(c['errors']['stale'])
        spec=c['types'].get(row.get('kind'),{})
        if use not in row.get('uses',[]) or use not in spec.get('uses',[]):raise EvidenceReferenceError(c['errors']['use'])
        result[spec['bucket']].append(id)
    return result
