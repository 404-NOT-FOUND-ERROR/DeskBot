"""Compile future intentions, never infer a fact from model prose."""
import json
from copy import deepcopy
from pathlib import Path
CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'contracts/cognitive-followup-intent.v1.json').read_text(encoding='utf-8'))

def compile_intent(raw,context):
    c=CONTRACT; view=context.get('followup_intent',{})
    def fail(): raise ValueError(c['error'])
    if (view.get('schema')!=c['schema'] or not isinstance(raw,dict)
        or not set(c['required']).issubset(raw) or set(raw)-set(c['required']+c['optional'])
        or raw.get('status') not in c['statuses'] or type(raw.get('delay_hours')) is not int or not 1<=raw['delay_hours']<=48
        or raw.get('basis_ids')!=[b['id'] for b in view['bases']]):fail()
    def select(ref,rows):
        if ref is None:return None
        if not isinstance(ref,dict) or set(ref)!={'kind','id'}:fail()
        row=next((r for r in rows if r['kind']==ref['kind'] and r['id']==ref['id']),None)
        if row is None:fail()
        return row
    nxt=select(raw['next_step'],view['next_options']); wait=select(raw.get('wait_for'),view['wait_options'])
    if 'unverified_idea' in raw and (not isinstance(raw['unverified_idea'],str) or not raw['unverified_idea'].strip() or len(raw['unverified_idea'])>160):fail()
    if 'review_after_minutes' in raw and (type(raw['review_after_minutes']) is not int or not 10<=raw['review_after_minutes']<=2880):fail()
    current=context['continuation'].get('current') or {}
    if raw.get('followup_id') is not None and raw['followup_id']!=current.get('followup_id'):fail()
    receipt=next((b for b in view['bases'] if b['kind']=='receipt'),None)
    def title(row):return row.get('title',row.get('label',row['id']))
    question=(c['questions'][raw['status']] if raw['status'] in ('drop','none') else
        c['questions']['next'].replace('{title}',title(nxt)) if nxt else
        c['questions']['wait'].replace('{title}',title(wait)) if wait else c['questions'][raw['status']])
    out={'status':raw['status'],'question':question,'reason':receipt['summary'] if receipt else view['bases'][0]['summary'],
         'delay_hours':raw['delay_hours'],'next_step':deepcopy(raw['next_step'])}
    for key in ('wait_for','review_after_minutes','followup_id'):
        if key in raw:out[key]=deepcopy(raw[key])
    if receipt:out['communication_evidence_id']=receipt['id']
    if raw.get('closure') is not None:
        cl=raw['closure']
        if (not isinstance(cl,dict) or set(cl)!={'kind','evidence_ids'} or cl.get('kind') not in c['closures']
            or not isinstance(cl['evidence_ids'],list) or any(not isinstance(i,str) for i in cl['evidence_ids']) or not current):fail()
        out['followup_closure']={'followup_id':current['followup_id'],'kind':cl['kind'],'reason':c['closures'][cl['kind']], 'evidence_ids':deepcopy(cl['evidence_ids'])}
    return out
