"""Build the small, strict JSON Schema subset validated by both bridge ends."""
import json
from pathlib import Path

def text(n=240): return {'type':'string','minLength':1,'maxLength':n}
def integer(): return {'type':'integer','minimum':0}
def obj(properties): return {'type':'object','additionalProperties':False,'required':list(properties),'properties':properties}
def arr(items,n=20): return {'type':'array','items':items,'maxItems':n}
def stamp(): return {'type':'string','format':'date-time'}
def const(value): return {'const':value}
common={'scope':const('isolated_mock'),'request_id':text(100),'actor_id':text(80)}
event=obj({'event_id':text(100),'root_id':text(100),'source':const('lab.synthetic'),'visibility':{'enum':['public','actor_private']},'text':text(600),'occurred_at':stamp()})
known=obj({'object_id':text(80),'name':text(80),'version':integer(),'state':obj({'moisture':{'type':'number','minimum':0,'maximum':1},'light':{'type':'number','minimum':0,'maximum':1}})})
context=obj({'schema':const('deskbot.cognition.context.v1'),**common,'context_digest':text(64),'actor_version':integer(),'cognition_sequence':integer(),'created_at':stamp(),'expires_at':stamp(),'identity':obj({'name':text(80),'role':text(120),'traits':arr(text(180),6),'values':arr(text(180),6),'hard_constraints':arr(text(240),6)}),'location_id':text(80),'known_objects':arr(known,8),'visible_events':arr(event,12),'memories':arr(obj({'memory_id':text(120),'text':text(600),'root_id':text(100)}),6),'allowed_primitives':arr({'enum':['observe']},1)})
proposal=obj({'schema':const('deskbot.cognition.proposal.v1'),**common,'context_digest':text(64),'expected_actor_version':integer(),'interpretation':text(600),'goal':text(240),'intent':obj({'primitive':const('observe'),'object_id':text(80),'expected_object_version':integer()}),'source_event_ids':arr(text(100),12),'generated_at':stamp(),'provider_mode':const('mock')})
result=obj({'schema':const('deskbot.cognition.result.v1'),**common,'result_id':text(120),'root_id':text(100),'status':const('completed'),'primitive':const('observe'),'object_id':text(80),'observed_state':known['properties']['state'],'occurred_at':stamp(),'execution_mode':const('isolated_sample'),'practice_delta':const(0)})
memory=obj({'schema':const('deskbot.cognition.memory-commit.v1'),**common,'memory_id':text(140),'result_id':text(120),'root_id':text(100),'memory_group_id':text(140),'facts':arr(text(400),8),'interpretation':text(600),'recorded_at':stamp(),'practice_delta':const(0)})
for name,schema in [('context',context),('proposal',proposal),('result',result),('memory-commit',memory)]:
    schema={'$schema':'https://json-schema.org/draft/2020-12/schema', '$id':f'deskbot.cognition.{name}.v1', **schema}
    folder=Path(__file__).parent/'contracts'
    folder.mkdir(exist_ok=True)
    (folder/f'{name}.v1.json').write_text(json.dumps(schema,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
