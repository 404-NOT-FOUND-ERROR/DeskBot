"""Stage 2 adapter. Node owns clocks, secrets, execution, facts and durable state.

No changes to vendored Asamana. Stdlib lexical retrieval is deliberately not
semantic embedding. One process handles one bounded plan or feedback job.
"""
import asyncio
from collections import Counter
from dataclasses import asdict, fields, is_dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from enum import Enum
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).parent / 'vendor/asamana'))
from agent.agent import Agent
from agent.decision import DecisionEngine, ActionCandidate, _ACTION_SPACE, _message_roster
from agent.goals import GoalEntity, GoalStatus, GoalOrigin
from agent.memory import MemorySystem, memory_collection_name
from agent.memory_types import MemoryStream
from agent.need import NeedEngine, NeedState, NeedType
from agent.personality import PersonalityLayer, SoulLayer, StateLayer, EmotionState, AgentActivityStatus, ActionStatus
from agent.reflection import ReflectionEngine
from agent.relation import RelationSystem
from core.interfaces.action import AgentAction, ActionResult, ActionTarget, Ref
from core.interfaces.embedding import EmbeddingProvider, EmbeddingResult
from core.interfaces.llm import LLMProvider, LLMResponse, LLMRouter, LLMScene, LLMMessage, extract_json
from core.interfaces.perception import SpatialPerception, LocationView, ReachableLocation, VisibleEntity, AmbientEvent, PerceivedPresence, PerceivedIdentity
from core.interfaces.agent_store import AgentRelation
from core.interfaces.message import Message
from core.context import get_log_context, observe_stage, note_active_call_adoption
from providers.agent_store.in_memory import InMemoryAgentStore
from providers.vector_store.in_memory import InMemoryVectorStore
from input_refraction import interpret_inputs, external_goals
from relationship_review import review_relationships
from continuation_contract import continuation_errors, CONTINUATION_CONTRACT, issue_choice_errors, compiled_issue_errors, ISSUE_CHOICE_CONTRACT
from context_projection import BODY_BOUNDARY, stage_context, continuation_view
from life_semantics import production_errors, PRODUCTION_CONTRACT, render_anchored_memory, compiled_method_errors
from contact_contract import (CONTACT_CONTRACT, contact_readiness, contact_intent_errors,
    bind_contact_intent, compiled_contact_errors, social_contact_errors)


class AbortJob(BaseException):
    pass


def plain(value):
    if isinstance(value, Enum): return value.value
    if is_dataclass(value): return plain(asdict(value))
    if isinstance(value, dict): return {str(k): plain(v) for k,v in value.items()}
    if isinstance(value, (list, tuple)): return [plain(v) for v in value]
    return value


def emit(value):
    print(json.dumps(plain(value), ensure_ascii=False), flush=True)


class PipeProvider(LLMProvider):
    def __init__(self, scene, mode, lock): self.scene, self.mode, self.lock = scene, mode, lock

    async def complete(self, messages, temperature=.7, max_tokens=1000, *, json_mode=False):
        async with self.lock:
            emit({'type':'model_request','mode':self.mode,'scene':self.scene,
                  'stage':get_log_context().get('stage',self.scene),
                  'messages':plain(messages),'temperature':temperature,
                  'max_tokens':min(1800, max(256, max_tokens)), 'json_mode':json_mode})
            reply = json.loads(sys.stdin.readline())
            if reply.get('type') != 'model_reply' or reply.get('mode') != self.mode or reply.get('error'):
                raise AbortJob(reply.get('error','invalid_model_reply'))
            content = reply['content']
            if isinstance(content,str): return LLMResponse(content,0,0,'test-fixture')
            return LLMResponse(content['content'],content.get('input_tokens',0),content.get('output_tokens',0),content['model'])


class LexicalRetrieval(EmbeddingProvider):
    """Normalized hashed character bigram/word frequency; no remote API."""
    dimension = 256
    async def embed(self, text):
        text = re.sub(r'\s+','',str(text).lower())
        features = Counter(text[i:i+2] for i in range(max(0,len(text)-1)))
        dense = [0.] * self.dimension
        for token,count in features.items():
            dense[int.from_bytes(hashlib.sha256(token.encode()).digest()[:4],'big') % self.dimension] += count
        norm = sum(v*v for v in dense)**.5 or 1
        return EmbeddingResult([v/norm for v in dense])


class BoundedPersonality(PersonalityLayer):
    def __init__(self, soul, state, context):
        super().__init__(soul,state); self.context = context
    def to_prompt_context(self, *args, **kwargs):
        projected=stage_context(self.context,get_log_context().get('stage',self.context.get('phase','plan')))
        return super().to_prompt_context(*args,**kwargs) + '\n执行边界：'+BODY_BOUNDARY+'\n本阶段实际条件：\n' + prompt_json(projected,self.context)


class BoundedDecision(DecisionEngine):
    def __init__(self, *args, context, **kwargs):
        super().__init__(*args, **kwargs)
        self.context=context; self.contact=None; self.issue=None; self.production=None; self.method=None; self.contact_errors=[]; self.attempts=0; self.last_payload=None

    def _build_decision_prompt(self, personality, packet, candidates):
        # Upstream's generic output instructions also describe synchronous TALK,
        # broadcasts, errands and forced handovers. Appending a narrower menu is
        # contradictory: use one executor-specific prompt while retaining its
        # needs, personality, memories, relations, target parser and feedback loop.
        awareness=packet.internal_context
        allowed={r['actor_id'] for r in self.context.get('capabilities',{}).get('share',{}).get('receivers',[])}
        people=[{'person_index':i,'actor_id':aid,'name':who.name,'contactable':aid in allowed}
            for i,(aid,who) in enumerate(_message_roster(packet),1)]
        view={'self':personality.to_prompt_context(),
            'direction':plain(getattr(awareness,'need_evaluation',None)),
            'current_emotion':plain(getattr(awareness,'emotion',None)),
            'own_recall':{k:plain(getattr(awareness,k,[])) for k in ('factual_memories','experiential_memories','insights','period_summaries','insight_sources','recent_foiled_attempts')},
            'own_relations':plain(getattr(awareness,'relevant_relations',[])),
            'visible_objects':self.context.get('objects',[]),'visible_or_known_people':people,
            'received_inputs':self.context.get('inputs',[]),'current_signals':self.context.get('signals',[]),
            'current_uses':self.context.get('use_context',{}),
            'contact_readiness':contact_readiness(self.context),
            'action_menu':[{'selected_index':i,'type':a.action_type.value,'meaning':a.description} for i,a in enumerate(candidates)]}
        system='''你是聚形域中正在生活的这个角色。结合自己的需要、性格、经历、关系与尚未完成的问题，自主决定眼下的一步。
先看实际可行性，再表达意愿。个人回忆中的感受不是客观证据；信息的署名、邀请和你的计划均不等于已发生或已接受。
有不同可行选择时按自己的理由权衡，不必为了完成故事或交付进度去行动。可以休息、换一件事或暂缓。
当前已经留言而对方未回应时，换措辞、改称当面、时间已过均不构成新行动。新相关依据、正式约定和实际回复各走自己的通道。
只选择action_menu中一项；selected_index是基础动作编号，不是activity_index。WORK/PHYSICAL的具体方法应匹配capabilities中的活动；observe只看现场，不代替正式测记或生产。材料、时段、冷却以实际条件为准。
联系只可选contactable=true的人，person_indices使用visible_or_known_people的person_index；看到或记得某人不保证现在能联系。MOVE用capabilities.travel.destinations中的destination_index；PHYSICAL只能用visible_objects中的object_index填physical_entity_index。
本地只有异步递话和明确约定，消息本身不能当作同步对话、物品交接或他人答应。实际耗时以执行器为准，estimated_steps填1。
act=true时返回完整JSON：{inner_monologue:20至60字的选择理由,act:true,selected_index:动作编号,activity_id:具体活动ID或null,production_use:用途对象或null,action_description:具体打算,expected_outcome:期望而非事实,estimated_steps:1,issue_choice:事项选择对象}。activity_id与production_use是顶层字段；completion_target_id不能替代activity_id。
act=false时仅保留inner_monologue和act；不要为了填满回合硬编行动。
SEND_MESSAGE另填person_indices、message_content、contact_intent、urgency(low|normal|high|critical)。MOVE另填destination_index。PHYSICAL另填physical_entity_index。其余不相关字段省略。
WORK另填activity_id（capabilities中精确活动ID）；PHYSICAL若实际做活动也填activity_id，若仅观察则填null。编译器只能执行本人选择的这个方法，不在修复时替你换成另一个活动。
'''+CONTACT_CONTRACT+ISSUE_CHOICE_CONTRACT+PRODUCTION_CONTRACT+'''
发送前核对：WORK必须同时写顶层activity_id与issue_choice。没有output的活动production_use=null；有output时按用途合同填写。不从action_description猜活动编号。PHYSICAL观察、REST、MOVE、SEND_MESSAGE的activity_id=null，另有该动作特定字段时照填。'''
        return system,prompt_json(view,self.context),[prompt_json({'objects':view['visible_objects'],'inputs':view['received_inputs']},self.context)]

    def _repair_prompt(self,user_prompt):
        if not self.contact_errors:return user_prompt
        return (user_prompt+'\n上次返回（没有执行）：'+json.dumps(self.last_payload,ensure_ascii=False,separators=(',',':'))
            +'\n只修复明确的字段错误；若本来意愿不再可行，也可重新选择。activity_id是JSON顶层必填字段，不能只写在production_use或completion_target_id里。'
            +'上次未采用原因：'+'；'.join(self.contact_errors)+'。返回完整JSON，不声称已执行。格式校验不是世界事件；角色的inner_monologue只谈生活处境和选择，不把字段错误说成被人拦下或物理上不能做。')

    async def _attempt_selection(self, personality, packet, candidates, system_prompt, user_prompt, given_facts):
        repair=self.attempts>0; self.attempts+=1
        user_prompt=self._repair_prompt(user_prompt)
        with observe_stage('decision_repair' if repair else 'decision'):
            return await super()._attempt_selection(personality,packet,candidates,system_prompt,user_prompt,given_facts)

    def _parse_llm_selection(self, content, candidates, packet=None):
        self.contact=None; self.issue=None; self.production=None; self.method=None
        self.last_payload=content if isinstance(content,dict) else extract_json(content)
        selection=super()._parse_llm_selection(content,candidates,packet)
        if selection is None:return None
        payload=content if isinstance(content,dict) else extract_json(content)
        issue=payload.get('issue_choice')
        self.contact_errors=issue_choice_errors(issue,self.context)
        if self.contact_errors:
            note_active_call_adoption(False,'issue_choice_invalid: '+';'.join(self.contact_errors))
            return None
        if self.context.get('use_context', {}).get('contract') == 'finite-use-v1':
            method = payload.get('activity_id')
            if ((selection.action_type.value == 'work' or method is not None)
                and (selection.action_type.value not in ('work', 'physical') or method not in [a['activity_id'] for a in self.context['capabilities']['activities']])):
                self.contact_errors=['WORK需本人选择给定activity_id；非活动不填该字段']
            else:
                self.contact_errors=production_errors({**(issue or {}),'operation':'activity' if method else 'other','activity_id':method,'production_use':payload.get('production_use')},self.context)
            if self.contact_errors:
                note_active_call_adoption(False,'production_use_invalid: '+';'.join(self.contact_errors));return None
            self.method=method;self.production=plain(payload.get('production_use'))
        if selection.action_type.value=='send_message':
            choice=payload.get('contact_intent')
            self.contact_errors=contact_intent_errors(choice,selection.target.acted_on_agents,self.context)
            if issue is not None and isinstance(choice,dict) and choice.get('followup_id')!=issue.get('followup_id'):
                self.contact_errors.append('contact_intent与issue_choice须引用同一本人事项')
            if self.contact_errors:
                note_active_call_adoption(False,'contact_intent_invalid: '+';'.join(self.contact_errors))
                return None
            self.contact=bind_contact_intent(choice,selection.target.acted_on_agents)
        else:self.contact_errors=[]
        self.issue=plain(issue)
        return selection

    async def decide(self, *, personality, packet):
        self.contact=None; self.issue=None; self.production=None; self.method=None; self.contact_errors=[]; self.attempts=0; self.last_payload=None
        # Keep upstream's type/target semantics while describing DeskBot's actual
        # executor. In particular, it cannot broadcast, summon, or hand over by prose.
        descriptions={
            'send_message':'向当前可联系的一人或多人递送异步留言。可表达问题，或由我选择一个人的正式邀请/约定回应；不是当面同步对话，不能以话语交付物品。按contact_intent声明具体方式。',
            'move':'虚拟化身沿给定通路到相邻地点，耗费实际旅途时间；到达后才能使用那里的设施，不能带走别人。',
            'work':'从给定生活活动中选择具体实践、测记、制作或照料；按材料、时段、冷却执行。保留失败可能，不能凭描述创建未提供的活动。',
            'physical':'对现场物件做给定活动，或只观察一个物件。对人交接必须先以SEND_MESSAGE商量正式约定；不能强制拿走物品或替别人答应。',
            'rest':'按实际体能规则休息，暂时搁置事情，不制造实践或研究结果。',
        }
        candidates=[ActionCandidate(a.action_type,descriptions[a.action_type.value]) for a in _ACTION_SPACE if a.action_type.value in descriptions]
        return await self._llm_select(personality,packet,candidates)


class BoundedMemory(MemorySystem):
    """Asamana's inner monologue bypasses Personality.to_prompt_context."""
    def __init__(self,*args,context,**kwargs):
        super().__init__(*args,**kwargs); self.context=context; self.anchor_checks=[]

    async def _write_experiential(self, **kwargs):
        result=self.context.get('result') or {};frame=result.get('memory_frame')
        if not frame or kwargs['raw_content']!=result.get('personal_fact'):
            return await super()._write_experiential(**kwargs)
        personality=kwargs['personality']
        # Reuse one memory call. Invalid affect is omitted, never replaced by invented prose.
        with observe_stage('memory'):
            response=await self._llm_router.complete(LLMScene.MEMORY_SUMMARIZATION,[
                LLMMessage('system','你是这个角色，事实已经完整保存。只选择此刻最在意的一项和具体感受，不重新讲述经过、删减留言或推断他人反应。返回JSON：{fact_ids:逐项照录facts的全部id,focus_id:最在意的一个id,feeling:最多160字的第一人称感受}。feeling只写我在意什么、担忧或期待什么；不写刚才做了什么、不重述留言、数量、时间或客观因果。事实将由程序原样与感受一起保留。'),
                LLMMessage('user',prompt_json({'actor':self.context['actor']['name'],'traits':personality.soul.traits_text(),'values':personality.soul.values_text(),
                    'emotion':personality.state.emotion.summary(),'facts':frame['facts'],'at':frame['at'],'related_people':kwargs.get('related_agent_directory') or {}},self.context))
            ],max_tokens=650,json_mode=True)
        value=extract_json(response.content);content=render_anchored_memory(frame,value)
        self.anchor_checks.append({'root_outcome_id':frame['root_outcome_id'],'status':'anchored' if content else 'omitted_invalid_affect','extra_retry':False})
        return content

    async def _complete_memory_prompt(self,system_prompt,user_prompt,*,max_tokens):
        grounding=prompt_json(self.context.get('grounding',{}),self.context)
        return await super()._complete_memory_prompt(
            system_prompt+'\n物品名和归属使用下列现场词义；若叙述过去，仍以该事件原文为准。主观独白写具体在意之处和感受，库存数字和客观过程已在事实流，不再翻写一遍。不能把猜测写成他人的需要、承诺或成果。没有验证的因果写为猜想。当前时间已给定，不沿用过去的今晚/明天。实验与技术标签不作角色称谓。',
            '【当前时间】'+prompt_json(self.context.get('time',{}),self.context)+'\n【现场词义与归属，非新事件】\n'+grounding+'\n'+user_prompt,max_tokens=max_tokens)


def hydrate(data, actor_id, location_id):
    accepted = {f.name for f in fields(StateLayer)}
    state = {k:v for k,v in data.items() if k in accepted}
    state.update(agent_id=actor_id,current_location=location_id,condition=None)
    state['emotion'] = EmotionState(**state.get('emotion',{}))
    state['activity_status'] = AgentActivityStatus(state.get('activity_status','idle'))
    state['action_status'] = ActionStatus(state.get('action_status','idle'))
    for key in ('short_term_goal_entities','long_term_goal_entities'):
        goals=[]
        for raw in state.get(key,[]):
            raw=dict(raw); raw['status']=GoalStatus(raw.get('status','active'))
            raw['origin']=GoalOrigin(raw.get('origin','cognitive'))
            if raw.get('related_need'): raw['related_need']=NeedType(raw['related_need'])
            goals.append(GoalEntity(**raw))
        state[key]=goals
    return StateLayer(**state)


def hydrate_action(data):
    data = dict(data)
    target = data.pop('target',{})
    data.pop('intent',None); data.pop('status',None)
    data['target'] = ActionTarget(**{k:[Ref(**r) for r in target.get(k,[])] for k in ('acts_on','claims','reaches')})
    return AgentAction(**data)


async def contract_json(router,messages,validator,max_tokens=900,repair_hint=None,stage='contract'):
    for attempt in range(2):
        with observe_stage(stage if attempt == 0 else stage+'_repair'):
            reply=await router.complete(LLMScene.DIRECTIVE,messages,max_tokens=max_tokens,json_mode=True)
        value=extract_json(reply.content)
        if isinstance(value,dict) and validator(value): return value
        if not isinstance(value,dict): value={}
        hint=repair_hint(value) if callable(repair_hint) else repair_hint
        messages=messages+[LLMMessage('assistant',reply.content),LLMMessage('user',hint or '该 JSON 不符合给定字段合同。重新检查原合同要求的字段名、数据类型与取值。只修复本次合同，不引入其他阶段字段，不新增事实。')]
    raise ValueError('semantic_contract_rejected_after_retry')


def valid_followup(value):
    return (value.get('status') in ('continue','postpone','drop','none') and all(isinstance(value.get(k),str) for k in ('question','reason'))
        and type(value.get('delay_hours')) is int and 1<=value['delay_hours']<=48
        and ('review_after_minutes' not in value or type(value['review_after_minutes']) is int and 10<=value['review_after_minutes']<=2880))

def followup_repair(value,context):
    problems=[]
    if value.get('status') not in ('continue','postpone','drop','none'):problems.append('status必须是continue/postpone/drop/none')
    for key in ('question','reason'):
        if not isinstance(value.get(key),str):problems.append(key+'必须是字符串')
    if type(value.get('delay_hours')) is not int or not 1<=value['delay_hours']<=48:
        problems.append('缺少或错误的delay_hours：它是必填的1至48整数；即使填写review_after_minutes也不能省略')
    if 'review_after_minutes' in value and (type(value['review_after_minutes']) is not int or not 10<=value['review_after_minutes']<=2880):
        problems.append('review_after_minutes必须是10至2880整数')
    problems.extend(continuation_errors(value,context))
    if not valid_continuation_binding(value,context) and not problems:problems.append('wait_for只能使用给定kind/id，已就绪或超时的条件必须重新考虑')
    return '只修复这些字段错误：'+'；'.join(problems)+'。保留原意，不新增事实；返回完整JSON。'


def valid_continuation_binding(value,context):
    if continuation_errors(value,context): return False
    target=value.get('wait_for')
    if target is not None:
        if not isinstance(target,dict) or set(target)!={'kind','id'}: return False
        option=next((o for o in context.get('continuation',{}).get('wait_options',[]) if o['kind']==target['kind'] and o['id']==target['id']),None)
        if not option:return False
        if value.get('operation')=='wait' and value.get('followup_decision') not in ('drop','none'):
            current=context.get('continuation',{}).get('current') or {}
            if option.get('available') or current.get('condition')=='review_required' and current.get('wait_for')==target:return False
    minutes=value.get('review_after_minutes')
    return minutes is None or type(minutes) is int and 10<=minutes<=(240 if value.get('operation')=='wait' else 2880)


def prompt_json(value,context):
    """Display ISO fields with explicit local/UTC labels; canonical values stay untouched."""
    zone=context.get('time',{}).get('zone','Asia/Shanghai')
    def display(item):
        if isinstance(item,dict):return {k:display(v) for k,v in item.items()}
        if isinstance(item,list):return [display(v) for v in item]
        if isinstance(item,str) and len(item)>=20 and item[4:5]=='-' and item[10:11]=='T':
            try:
                instant=datetime.fromisoformat(item.replace('Z','+00:00'))
                if instant.tzinfo:return instant.astimezone(ZoneInfo(zone)).strftime('%Y-%m-%d %H:%M:%S')+' '+zone+' (UTC '+instant.astimezone(timezone.utc).isoformat()+')'
            except (ValueError,KeyError):pass
        return item
    return json.dumps(display(value),ensure_ascii=False,separators=(',',':'))


def valid_compilation(value):
    if value.get('operation') not in ('activity','observe','rest','share','wait','travel') or not isinstance(value.get('reason'),str): return False
    key={'observe':'object_index','travel':'destination_index'}.get(value['operation'])
    if value['operation']=='activity' and not (isinstance(value.get('activity_id'),str) and value['activity_id'] or type(value.get('activity_index')) is int and value['activity_index']>0): return False
    if key and (type(value.get(key)) is not int or value[key]<1): return False
    if value['operation']=='share':
        return isinstance(value.get('receiver_indices'),list) and len(value['receiver_indices'])>0 and all(type(n) is int and n>0 for n in value['receiver_indices']) and (bool(value.get('message','').strip()) or bool(value.get('message_parts')) or bool(value.get('social')))
    return True


def valid_life_compilation(value):
    return (valid_compilation(value) and value.get('motivation') in ('need','self_exploration','self_continuation','invited','accepted_obligation','unknown')
        and isinstance(value.get('source_ids'),list) and all(isinstance(s,str) for s in value['source_ids'])
        and value.get('followup_decision') in ('continue','postpone','drop','new','none')
        and isinstance(value.get('title'),str) and len(value['title'])<=40 and len(value['reason'])<=160
        and isinstance(value.get('message'),str) and len(value['message'])<=180)


def valid_development_binding(value,context):
    if 'development' in value: return False
    development=context.get('development',{})
    choice=value.get('interest_choice')
    if choice:
        topic=next((t for t in development.get('topics',[]) if t['topic']==choice.get('topic')),None)
        if not topic or choice.get('decision') not in ('continue','pause','drop','revisit') or not isinstance(choice.get('reason'),str) or not choice['reason'].strip(): return False
        allowed=topic.get('active_roots',[])+topic.get('recent_success_roots',[])
        if not isinstance(choice.get('root_ids'),list) or not choice['root_ids'] or any(r not in allowed for r in choice['root_ids']): return False
    wish=value.get('wish_choice')
    if wish:
        direction=next((d for d in development.get('wish_options',[]) if d['direction_id']==wish.get('direction_id')),None)
        if not direction or wish.get('decision') not in ('consider','propose','defer') or not isinstance(wish.get('reason'),str) or not wish['reason'].strip(): return False
        if wish['decision']=='propose' and not direction['eligible']: return False
    return True


def valid_activity_binding(value,context):
    if value.get('operation')!='activity': return True
    chosen=next((a for a in context['capabilities']['activities'] if a['activity_id']==value.get('activity_id')),None)
    return bool(chosen and (value.get('activity_index') is None or value['activity_index']==chosen.get('activity_index')))


def valid_source_binding(value,context):
    return all(s in {i['id'] for i in context.get('inputs',[])} for s in value.get('source_ids',[]))



def valid_social_compilation(value,context):
    import re
    if value.get('operation')!='share': return True
    if social_contact_errors(value,context): return False
    parts=value.get('message_parts')
    if not isinstance(parts,list) or len(parts)>3: return False
    for part in parts:
        if not isinstance(part,dict): return False
        if part.get('kind')=='evidence':
            source=next((e for e in context.get('speech_evidence',[]) if e['id']==part.get('evidence_id')),None)
            if not source or 'quote' in part and source['text']!=part['quote']: return False
        elif part.get('kind') not in ('question','hypothesis','intention','greeting') or not isinstance(part.get('text'),str) or not 0<len(part['text'])<=160: return False
        else:
            if re.search(r'已经|已完成|刚刚.*[做浇修]|刚[做浇修]|答应了|同意了|证明了|证实了|我做过|我浇过|我修过',part['text']): return False
            if value.get('social') and re.search(r'[零一二三四五六七八九十\d]+(?:分钟|小时|点)|上午|下午|明天|今晚',part['text']): return False
            if part['kind']=='greeting':
                greeting=re.sub(r'[\s，。！？!?,、]','',part['text'])
                for receiver in context.get('capabilities',{}).get('share',{}).get('receivers',[]):
                    if greeting.startswith(receiver['name']): greeting=greeting[len(receiver['name']):]
                    elif greeting.endswith(receiver['name']): greeting=greeting[:-len(receiver['name'])]
                if greeting not in ('你好','谢谢你','回头见','早上好','晚上好'): return False
    social=value.get('social')
    if social:
        if len(value['receiver_indices'])!=1: return False
        if social.get('operation')=='invite':
            if not any(o['option_id']==social.get('option_id') for o in context.get('social',{}).get('options',[])): return False
        elif social.get('operation')=='respond':
            c=next((c for c in context.get('social',{}).get('commitments',[]) if c['id']==social.get('commitment_id')),None)
            if not c or social.get('response') not in c['available_responses']: return False
            if social.get('response')=='delay' and (type(social.get('delay_minutes')) is not int or not 15<=social['delay_minutes']<=240): return False
        else: return False
    return bool(parts or social)


def compilation_repair(value,context):
    import re
    hints=['只修复意图编译JSON，不加status/delay_hours。activity使用精确activity_id。证据段仅写kind/evidence_id。']
    hints.extend(continuation_errors(value,context))
    hints.extend(social_contact_errors(value,context))
    if value.get('operation')=='share' and value.get('social') and len(value.get('receiver_indices',[]))!=1:
        hints.append('正式social约定的receiver_indices必须恰好一个收件人；不可同时邀请多人。由本人选择一个给定编号，或放弃此次约定并选择其他行动，不自动拆分或替别人接受。')
    if value.get('operation')=='share' and not isinstance(value.get('message_parts'),list):
        hints.append('缺少顶层message_parts数组。message_parts和reply_to必须与operation同级，不可放入speech对象；删除speech外层，保留原段落含义。share只送达留言，不能把物品交付写成已完成。')
    invalid=[s for s in value.get('source_ids',[]) if s not in {i['id'] for i in context.get('inputs',[])}]
    if invalid:hints.append(f'source_ids 中这些不属于外来输入：{invalid}。现场观察证据不能写入source_ids，移除它们。保留真正影响选择的给定输入ID。')
    for i,part in enumerate(value.get('message_parts',[])):
        if not isinstance(part,dict):
            hints.append(f'message_parts[{i}]必须是段落对象。')
            continue
        if part.get('kind')!='evidence' and re.search(r'已经|已完成|刚刚.*[做浇修]|刚[做浇修]|答应了|同意了|证明了|证实了|我做过|我浇过|我修过',part.get('text','')):
            hints.append(f'message_parts[{i}]在自由文字中包含已完成/已承诺断言。实际事实请用给定evidence_id独立引用；question只保留尚待回答的问题，intention只说未来打算。不能仅换成hypothesis标签绕过事实核验。')
        if part.get('kind')=='greeting':
            hints.append(f'message_parts[{i}]的greeting请直接用“你好”或“谢谢你”，不写人名。说话者是{context["actor"]["name"]}。')
        if value.get('social') and re.search(r'[零一二三四五六七八九十\d]+(?:分钟|小时|点)|上午|下午|明天|今晚',part.get('text','')):
            hints.append(f'message_parts[{i}]含禁止的时间文字，请删除这段中的时刻/时长，只表达意愿。实际时间由social条款自动生成，无需再说。')
    hints.append('可选interest_choice和wish_choice若不符合本人给定证据或当前意愿，请填null；不要虚构结果或为了进度提出角色。')
    return ''.join(hints)


async def run(context):
    if context.get('schema') not in ('deskbot.cognitive-life.context.v2','deskbot.cognitive-life.context.v3'): raise ValueError('invalid_context_version')
    actor=context['actor']; saved=context.get('saved',{}); at=datetime.fromisoformat(context['at'].replace('Z','+00:00'))
    epoch=datetime.fromisoformat(context['epoch'].replace('Z','+00:00'))
    # Elapsed world hours, never number of API calls. Fine execution timestamps stay in Node.
    zone=ZoneInfo(context.get('time',{}).get('zone','Asia/Shanghai'))
    step=max(0,int((at-epoch).total_seconds()//3600)); start=epoch.astimezone(zone).hour*3600
    time_label=lambda n: (at if n==step else epoch+timedelta(hours=n)).astimezone(zone).strftime('%Y-%m-%d %H:%M:%S')+' '+str(zone)
    lock=asyncio.Lock()
    router=LLMRouter({s:PipeProvider(s.value,context['mode'],lock) for s in LLMScene})
    weights=actor.get('need_weights',{})
    soul=SoulLayer(name=actor['name'],agent_id=actor['actor_id'],role=actor['role'],core_traits=actor['traits'],core_values=actor['values'],
                   background=actor.get('background',''),hard_constraints=(BODY_BOUNDARY,),
                   innate_needs=tuple(NeedState(t,t.value,.35,weight=weights.get(t.value,1)) for t in NeedType))
    state=hydrate(saved.get('state',{}),actor['actor_id'],context['location']['id'])
    # Actual energy/appetite is a read-only physiological input, not generated evidence.
    state.need_intensities['physiological']=max(actor.get('appetite',.2),1-actor.get('energy',.8))
    personality=BoundedPersonality(soul,state,context)
    store=InMemoryAgentStore(); vectors=InMemoryVectorStore(); embedding=LexicalRetrieval()
    await restore_relations(store,saved,context['world_id'],actor['actor_id'])
    memory=BoundedMemory(router,embedding,vectors,context=context,world_id=context['world_id'],agent_id=actor['actor_id'],is_main_character=actor['actor_id']=='shaping-001',
                        seconds_per_step=3600,world_start_second_of_day=start,time_label_for=time_label)
    await memory.ensure_collections()
    for entry in saved.get('memories',[]):
        payload=entry['payload']; stream=MemoryStream(payload['stream']); vector=await embedding.embed(payload.get('stored_content') or payload['raw_content'])
        await vectors.upsert(memory_collection_name(context['world_id'],actor['actor_id'],stream),entry['id'],vector.dense,None,payload)
    await memory.warm_recent_memories(step,lookback_steps=24*14)
    # Upstream counter is process-local. Node namespaces every new memory by job; old IDs preserved.
    memory._seq=int(saved.get('memory_sequence',0))
    need=NeedEngine(router,seconds_per_step=3600,world_start_second_of_day=start)
    decision=BoundedDecision(router,context=context,seconds_per_step=3600,world_start_second_of_day=start)
    agent=Agent(world_id=context['world_id'],agent_id=actor['actor_id'],personality=personality,decision_engine=decision,
                memory_system=memory,need_engine=need,relation_system=RelationSystem(store,world_id=context['world_id'],agent_id=actor['actor_id']),agent_store=store,llm_router=router,
                is_main_character=actor['actor_id']=='shaping-001',seconds_per_step=3600,world_start_second_of_day=start)
    restore_continuity(agent,memory,saved)
    spatial=SpatialPerception(location_id=context['location']['id'],location_view=LocationView(context['location']['name'],context['location']['description']),
         world_time_label=time_label(step),current_step=step,world_time_hour=at.astimezone(zone).hour,
         visible_entities=[VisibleEntity(entity_id=o['id'],name=o['name'],entity_type='landmark',description=o['description'],content=prompt_json(o['state'],context)) for o in context['objects']],
         visible_agents={p['actor_id']:PerceivedPresence(identity=PerceivedIdentity(name=p['name'])) for p in context.get('visible_people',[])},
         ambient_events=[AmbientEvent(content=s) for s in context.get('signals',[])],
         reachable_locations=[ReachableLocation(location_id=p['id'],view=LocationView(p['name'],p['description']),travel_seconds=p['travel_seconds']) for p in context['capabilities'].get('travel',{}).get('destinations',[])])
    for p in [*saved.get('known_people',[]),*context.get('visible_people',[])]: agent.remember_agent(p['actor_id'],PerceivedIdentity(name=p['name']))
    agent.refresh_situation(spatial)
    output={'schema':'deskbot.cognitive-life.proposal.v3','actor_id':actor['actor_id'],'step':step,'phase':context['phase']}
    if context['phase']=='perceive':
        # Only admitted, unconsumed sources are memorized. Ambient prose is still available to planning,
        # but cannot silently become a new factual source on every plan.
        spatial.ambient_events=[]
        messages=[Message(id=s['id'],world_id=context['world_id'],sender_id=s['sender_id'],sender_name=s['sender_name'],
            sender_is_agent=s.get('sender_is_agent',False),content=s['content'],recipients=[actor['actor_id']],location_scope=None,
            deliver_step=step,created_step=step,metadata={'deskbot_source':s['id']}) for s in context.get('perceptions',[])]
        await agent.perceive_step(spatial=spatial,inbox=messages,broadcasts=[],step=step)
    elif context['phase']=='interpret':
        output['interpretations']=await interpret_inputs(context,router)
    elif context['phase']=='plan':
        output['interpretations']=await interpret_inputs(context,router)
        interpretations=[*context.get('refraction',{}).get('active',[]),*output['interpretations']]
        agent.pending_external_goals=external_goals(interpretations)
        plan=await agent.plan_step(step=step,spatial=spatial,inbox=[],broadcasts=[])
        output['decision_status']=plain(plan.decision_status)
        if plain(plan.decision_status)=='failed': raise ValueError('upstream_decision_failed')
        agent.personality.apply_need_state(step=step,active_needs=[n.type.value for n in plan.need_evaluation.active_needs],dominant_need=plain(plan.need_evaluation.dominant_need),
               long_term_goals=plan.need_evaluation.long_term_goals,short_term_goal_entities=plan.need_evaluation.short_term_goal_entities)
        output['needs']=plain(plan.need_evaluation)
        output['action']=plain(plan.action)
        output['decision_contact']=plain(decision.contact)
        output['decision_issue']=plain(decision.issue)
        output['decision_method']=decision.method
        output['decision_production']=plain(decision.production)
        if plan.action:
            await agent.begin_ongoing_step(plan=plan,estimated_steps=1)
            compile_prompt={'speaker':{'id':actor['actor_id'],'name':actor['name']},'at':context['at'],'intent':plain(plan.action),'capabilities':context['capabilities'],'objects':context['objects'],
                'available_sources':context.get('inputs',[]),'input_interpretations':interpretations,'prior_result_root':saved.get('last_result',{}).get('root_outcome_id'),
                'causality_contract':'同时返回 motivation: need|self_exploration|self_continuation|invited|accepted_obligation|unknown，source_ids: 实际影响本次选择的给定来源id数组，prior_root_id: 延续本人实际旧事的结果id或null。当前需要驱动填need；有自由余裕的首次探索填self_exploration；继续过去亲自做过的事填self_continuation并引用结果；受用户/居民请求填invited并引用来源；履行已经接受的约定填accepted_obligation并提供commitment_id。不虚构来源或把每个选择都标成自主。',
                'contract':'将意图编译为 JSON：{operation: activity|observe|rest|share|wait|travel, destination_index:1起或null, activity_id: 给定活动的精确ID或null, activity_index: 活动上明确标注的编号或null, object_index:1起或null, receiver_indices:1起的收件人编号数组, message:实际说出的消息或空字符串, title:短标题, reason:方法与限制, followup_decision:continue|postpone|drop|new|none}。只能选给定能力。activity 必须返回精确 activity_id；如另填 activity_index 必须与该条 activity_index 一致，不能自己数数组位置。意图涉及实际测记、试验、制作、排湿或移动时，优先匹配有明确条件和效果的 activity；observe 只是看一看，不能代替正式测记或产生作品。travel 的 destination_index 绑定 capabilities.travel.destinations 编号；上游 move 意图必须编译为 travel，不得当成已抵达或当地已完成活动。不把工作默认当成已完成，也不制造物品。observe 必须绑定一个对象，rest 不得伪装完成研究。share 必须在 receiver_indices 填入 capabilities.share.receivers 里至少一人的编号；向多人留言可填多个编号，不可填null。留言不代表对方答应或已建立关系。activity 包含未满足条件时也可提出，会被服务端拒绝并反馈。'}
            compile_prompt['social']=context.get('social',{})
            compile_prompt['speech_evidence']=context.get('speech_evidence',[])
            compile_prompt['speech_contract']='share必须用message_parts数组（最多3段），message填空字符串，不直接发自由事实叙述。每段为{kind:evidence,evidence_id:给定证据ID}或{kind:question|hypothesis|intention|greeting,text:最多160字}。事实仅选择speech_evidence编号，由服务端呈现完整原文，系统会标注观察/听闻/实际结果。猜想和打算各自标注未核验/未执行；自由文本不许声称已完成、别人已答应或已经证实。greeting只允许你好、谢谢你、回头见、早上好、晚上好。若是在回复消息，reply_to填social.replies中的精确message_id，否则null。正式邀请需social:{operation:invite,option_id:可用选项ID}；回复约定需social:{operation:respond,commitment_id:自己的约定ID,response:accept|decline|delay|withdraw,delay_minutes:延期15至240整数}。正式时间只写在social.delay_minutes，系统据此表达；附言不要写时刻或时长，避免两套时间冲突。没有正式社交命令则social:null。只邀请一个人，不能从话语推断对方答应。'
            compile_prompt['format_limits']='只返回一个简短 JSON 对象，不复述上下文。title最多40字，reason最多160字，message最多180字。motivation、source_ids（无来源填[]）、prior_root_id（无则null）、followup_decision、followup_id（继续原问题必须精确引用current/deferred ID，无关联填null）均不可省略。source_ids只选available_sources的外来输入ID，不放本人task结果、sent留言或现场observation ID；自己的旧事放prior_root_id。不得加入解释段落。没有本人已完成任务证据，不说刚忙完、刚照料完、刚到达；问候可直接开始。'
            compile_prompt['development']=context.get('development')
            compile_prompt['time']=context.get('time')
            compile_prompt['continuation']=continuation_view(context)
            compile_prompt['use_context']=context.get('use_context')
            compile_prompt['decision_issue']=decision.issue
            compile_prompt['decision_method']=decision.method
            compile_prompt['decision_production']=decision.production
            compile_prompt['method_contract']='decision_method非null时operation=activity且activity_id逐字相同。production_use逐字复制decision_production（包括null）；不能替本人换活动或编造用途。step_review也必须从decision_issue原样复制，不能忘记。'
            compile_prompt['decision_issue_contract']='decision_issue全部字段逐项保留到输出顶层，包括step_review。本人选择研究范围和是否收束，编译器不能另换完成标准或替本人放下。reason以当下条件和本人本次选择为准，不照抄previous_review中的过时理由。'
            compile_prompt['waylight']=context.get('waylight')
            compile_prompt['grounding']=context.get('grounding')
            compile_prompt['decision_contact']=decision.contact
            compile_prompt['decision_contact_contract']='decision_contact是本人在决策阶段已选好的联系方式、收件人、事项及来源。只把receiver_ids换成receiver_indices；其他字段保留原选择。它为null时不能新增share。不能把普通问话修复成邀请或改变约定内容；编译失败不等于本人改了主意。'
            compile_prompt['continuation_contract']=CONTINUATION_CONTRACT+'wait的review_after_minutes为10至240整数，已经ready或超时的等待不可自动续期；可解除等待或改办法。'
            compile_prompt['development_contract']='interest_choice 和 wish_choice 是输出JSON顶层字段，不可再套development对象。通常两者填 null。确实决定改变当前投入时可填 interest_choice:{topic:给定主题,decision:continue|pause|drop|revisit,reason:具体原因,root_ids:该主题给定active_roots或recent_success_roots的非空子集}；只表达选择，不凭话增加喜欢或实践。如果我确实想提出或暂缓某个新角色，可填 wish_choice:{direction_id:给定方向,decision:consider|propose|defer,reason:具体原因}；propose仅在eligible为true时可用，仍不改变外观。不同于“可以提出”，“我现在愿意提出”需要我自己的选择。不为满足进度强行换角色。'
            compile_prompt['speech_contract']+='message_parts、reply_to、social都是输出JSON顶层字段，与operation同级，不能放进speech对象。证据段简化为{kind:evidence,evidence_id:给定ID}即可，不需要quote字段，服务器会逐字插入带来源的完整原文。若仍填写quote必须与speech_evidence.text完全一致，不能只抄social.replies.text。'
            compile_prompt['speech_contract']+='问候建议直接用“你好”，不要加姓名。对外说话直接谈收到的内容与自己的意愿，不复述“隔离”“夹具”等实验标签。未核实的署名仍称“署名为…的来信”，不当作本人已确认的意见。'
            output['compiled']=await contract_json(router,[LLMMessage('system','你是聚形域意图编译器。只返回一个简短完整 JSON。'),LLMMessage('user',prompt_json(compile_prompt,context))],lambda value: valid_life_compilation(value) and valid_activity_binding(value,context) and valid_source_binding(value,context) and valid_social_compilation(value,context) and valid_development_binding(value,context) and valid_continuation_binding(value,context) and not compiled_contact_errors(value,context,decision.contact) and not compiled_issue_errors(value,decision.issue) and not compiled_method_errors(value,context,decision.method,decision.production),max_tokens=1600,repair_hint=lambda value: compilation_repair(value,context)+'；'.join(compiled_contact_errors(value,context,decision.contact)+compiled_issue_errors(value,decision.issue)+compiled_method_errors(value,context,decision.method,decision.production)),stage='compile')
        else:
            current=context.get('continuation',{}).get('current')
            output['compiled']={'operation':'wait','reason':'本人本回合决定暂不行动。','followup_decision':'postpone' if current else 'none',
                'followup_id':current['followup_id'] if current else None,'motivation':'need','source_ids':[],
                'review_after_minutes':60,'next_step':None,'wait_for':None}
    elif context['phase']=='reflect':
        output['reflection']=plain(await ReflectionEngine(router,memory,personality,agent_id=actor['actor_id'],seconds_per_step=3600,time_label_for=time_label,world_start_second_of_day=start).reflect(step))
    elif context['phase']=='relate':
        output['relation_views']=await review_relationships(context,router,personality,step)
    elif context['phase']=='maintain':
        await memory.apply_decay(step)
        await agent.revise_long_term_goals(step=step)
    elif context['phase']=='feedback':
        action=hydrate_action(context['action']); result=context['result']
        actual=ActionResult(action=action,expected_outcome=action.expected_outcome,outcome=result['fact'],gist=result['fact'][:120],
             factual_memory=result['personal_fact'],succeeded=result['success'],not_executed=result.get('not_executed',False),failure_reason=result.get('failure_reason',''))
        await agent.finalize_ongoing_action(result=actual,step=step)
        await memory.drain_writes()
        if context.get('reflect'):
            reflection=await ReflectionEngine(router,memory,personality,agent_id=actor['actor_id'],seconds_per_step=3600,time_label_for=time_label,world_start_second_of_day=start).reflect(step)
            output['reflection']=plain(reflection)
        output['followup']=await contract_json(router,[LLMMessage('system','你就是此角色。基于已经核验的结果，留下一项诚实的后续。actual_result.effects 是执行器作用：share 只送达留言，不交付物品；原计划和标题不是完成证据。reservation.inputs 已在开始时预扣，不从结果 after 再扣一次。引用结束库存用 after 或冻结背包。没有实际回复/合同不能说已答应或已履约。只返回 JSON。'),
             LLMMessage('user',prompt_json({'personality':PersonalityLayer.to_prompt_context(personality),'actual_result':result,
              'now':context.get('time',context['at']),'continuation':continuation_view(context),'grounding':context.get('grounding'),'use_context':context.get('use_context'),'issue_contract':CONTINUATION_CONTRACT,
              'contract':'必须返回status、question、reason、delay_hours、next_step五个字段。示例：{"status":"continue","question":"再实际试一次","reason":"仍有问题","delay_hours":1,"next_step":null}。next_step从next_options选kind/id；没有具体办法明确填null。status取continue/postpone/drop/none；delay_hours必填1至48整数，即使加了review_after_minutes也不可省略。可选wait_for:null或{kind:activity|reply|commitment,id:给定ID}，可选review_after_minutes:10至2880整数。若提供分钟字段，以它安排下一次复查；否则用delay_hours。从now的实际时间计算，不写不符的明天/今晚。可绑定给定测记或已送达消息，服务端核对条件。受阻应改变办法或等待具体条件；question表达未来想做什么，不补写没发生的读数、判断或承诺。'},context))],lambda value:valid_followup(value) and valid_continuation_binding(value,context),repair_hint=lambda value:followup_repair(value,context),stage='followup')
    else: raise ValueError('unknown_phase')
    await memory.drain_writes()
    output['memory_anchor_checks']=memory.anchor_checks
    output['state']=plain(personality.state); output['memory_sequence']=memory._seq
    original={m['id']:m['payload'] for m in saved.get('memories',[])}
    output['memories']=[];output['memory_updates']=[]
    for stream in MemoryStream:
        for record in await vectors.list_all(memory_collection_name(context['world_id'],actor['actor_id'],stream)):
            payload=plain(record.payload)
            payload['source_ids']=json.loads(payload.get('source_ids_json','[]'))
            if record.id not in original: output['memories'].append({'id':record.id,'payload':payload})
            else:
                change={key:payload[key] for key in ('retrieval_count','last_accessed_step','decay_score') if key in payload and payload[key]!=original[record.id].get(key)}
                if change: output['memory_updates'].append({'id':record.id,**change})
    output['relations']=plain(await store.load_all_relations(context['world_id'],actor['actor_id']))
    output['continuity']={'recent_foiled':plain(list(memory._recent_foiled)),
        'foiled_misses':[{'key':list(key),'count':value[0],'step':value[1]} for key,value in agent._foiled_misses.items()]}
    await memory.aclose()
    return output


async def restore_relations(store,saved,world_id,actor_id):
    accepted={f.name for f in fields(AgentRelation)}
    for raw in saved.get('relations',[]):
        if raw.get('world_id')!=world_id or raw.get('from_id')!=actor_id: raise ValueError('private_relation_scope_invalid')
        await store.save_relation(AgentRelation(**{k:v for k,v in raw.items() if k in accepted}))


def restore_continuity(agent,memory,saved):
    continuity=saved.get('continuity') or {}
    for item in continuity.get('recent_foiled',[])[-12:]:
        step,text,key,gist=item
        memory._recent_foiled.append((int(step),str(text),tuple(key) if key else None,str(gist)))
    for item in continuity.get('foiled_misses',[])[-24:]:
        agent._foiled_misses[tuple(item['key'])]=(int(item['count']),int(item['step']))


if __name__=='__main__':
    try: emit({'type':'completed','value':asyncio.run(run(json.loads(sys.stdin.readline())))})
    except BaseException as error:
        emit({'type':'error','error':str(error)[:500]}); sys.exit(1)
