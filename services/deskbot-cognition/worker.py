"""One bounded Node-owned session over NDJSON. Never opens a DB or network socket."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).parent/'vendor/asamana'))
from agent.personality import SoulLayer, PersonalityLayer
from core.interfaces.llm import IndexedRef, LLMMessage, LLMProvider, LLMResponse, LLMRouter, LLMScene, extract_json
from contract_validation import validate

def emit(value):
    print(json.dumps(value,ensure_ascii=False),flush=True)

def read():
    line=sys.stdin.readline()
    if not line or len(line)>262144: raise ValueError('missing/oversize bridge frame')
    return json.loads(line)

class NodeProvider(LLMProvider):
    async def complete(self,messages,temperature=.7,max_tokens=1000,*,json_mode=False):
        emit({'type':'model_request','messages':[{'role':m.role,'content':m.content} for m in messages],'temperature':temperature,'max_tokens':max_tokens,'json_mode':json_mode,'mode':'mock'})
        reply=read()
        if reply.get('type')!='model_reply' or reply.get('mode')!='mock': raise ValueError('mock broker reply required')
        return LLMResponse(content=reply['content'],input_tokens=0,output_tokens=0,model='stage1-mock')

async def cognition(context):
    validate('context',context)
    identity=context['identity']
    soul=SoulLayer(name=identity['name'],agent_id=context['actor_id'],role=identity['role'],core_traits=identity['traits'],core_values=identity['values'],hard_constraints=identity['hard_constraints'])
    personality=PersonalityLayer(soul)
    references=IndexedRef([o['object_id'] for o in context['known_objects']])
    events=IndexedRef([e['event_id'] for e in context['visible_events']])
    # Upstream to_prompt_context does not render hard_constraints; the adapter must.
    prompt=personality.to_prompt_context()+'\n硬约束：'+'；'.join(soul.hard_constraints)+'\n这是隔离的工程样例，不是现实中已经发生的故事。只解释允许看到的事件，提出 observe 意图；不得声称研究完成、取得技能或换形。\n'+json.dumps({'objects':[{'index':i+1,**o} for i,o in enumerate(context['known_objects'])],'events':[{'index':i+1,**e} for i,e in enumerate(context['visible_events'])],'memories':context['memories']},ensure_ascii=False)+'\n返回 JSON：interpretation, goal, object_index, event_indices。'
    provider=NodeProvider()
    router=LLMRouter({scene:provider for scene in LLMScene})
    response=await router.complete(LLMScene.AGENT_DECISION_MAIN,[LLMMessage(role='user',content=prompt)],json_mode=True,max_tokens=500)
    parsed=extract_json(response.content)
    object_ids=references.resolve([parsed.get('object_index')])
    source_ids=events.resolve(parsed.get('event_indices',[]))
    if len(object_ids)!=1 or not source_ids: raise ValueError('unresolved object/source reference')
    target=next(o for o in context['known_objects'] if o['object_id']==object_ids[0])
    proposal={'schema':'deskbot.cognition.proposal.v1','scope':'isolated_mock','request_id':context['request_id'],'actor_id':context['actor_id'],'context_digest':context['context_digest'],'expected_actor_version':context['actor_version'],'interpretation':parsed['interpretation'],'goal':parsed['goal'],'intent':{'primitive':'observe','object_id':target['object_id'],'expected_object_version':target['version']},'source_event_ids':source_ids,'generated_at':datetime.now(timezone.utc).isoformat(),'provider_mode':'mock'}
    validate('proposal',proposal)
    return proposal

def memory(frame):
    context=validate('context',frame['context'])
    proposal=validate('proposal',frame['proposal'])
    result=validate('result',frame['result'])
    for value in [proposal,result]:
        if value['request_id']!=context['request_id'] or value['actor_id']!=context['actor_id']: raise ValueError('session mismatch')
    if result['object_id']!=proposal['intent']['object_id']: raise ValueError('result target mismatch')
    target=result['object_id']
    value={'schema':'deskbot.cognition.memory-commit.v1','scope':'isolated_mock','request_id':context['request_id'],'actor_id':context['actor_id'],'memory_id':context['request_id']+':memory','result_id':result['result_id'],'root_id':result['root_id'],'memory_group_id':context['actor_id']+':'+result['root_id'],'facts':[f"隔离样例中观察 {target}：水分 {result['observed_state']['moisture']}，蓄光 {result['observed_state']['light']}。"],'interpretation':proposal['interpretation'],'recorded_at':result['occurred_at'],'practice_delta':0}
    return validate('memory-commit',value)

try:
    frame=read()
    if frame['type']=='context': value=asyncio.run(cognition(frame['context']))
    elif frame['type']=='result': value=memory(frame)
    else: raise ValueError('unknown bridge operation')
    emit({'type':'completed','value':value})
except Exception as error:
    emit({'type':'error','error':str(error)[:300]})
    sys.exit(1)
