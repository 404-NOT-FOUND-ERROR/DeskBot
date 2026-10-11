"""Stage 2 adapter. Node owns clocks, secrets, execution, facts and durable state.

No changes to vendored Asamana. Stdlib lexical retrieval is deliberately not
semantic embedding. One process handles one bounded plan or feedback job.
"""
import asyncio
from collections import Counter
from dataclasses import asdict, fields, is_dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).parent / 'vendor/asamana'))
from agent.agent import Agent
from agent.decision import DecisionEngine, _ACTION_SPACE
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
from core.context import get_log_context
from providers.agent_store.in_memory import InMemoryAgentStore
from providers.vector_store.in_memory import InMemoryVectorStore
from input_refraction import interpret_inputs, external_goals
from relationship_review import review_relationships


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
    def __init__(self, soul, state, constraints):
        super().__init__(soul,state); self.constraints = constraints
    def to_prompt_context(self, *args, **kwargs):
        return super().to_prompt_context(*args,**kwargs) + '\n聚形域执行边界：\n' + self.constraints


class BoundedDecision(DecisionEngine):
    def _build_decision_prompt(self, personality, packet, candidates):
        system, user, facts = super()._build_decision_prompt(personality, packet, candidates)
        menu = ', '.join(f'{i}={a.action_type.value}' for i,a in enumerate(candidates))
        boundary = '\n本轮 selected_index 只在基础动作菜单中选择：'+menu+'。生活活动 activity_id 不是这个编号；选择具体测记/照料/制作时用 WORK 或有目标的 PHYSICAL，并把具体方法写进 action_description。后续编译器才会绑定 activity_id。不能把活动序号填到 selected_index。'
        return system+boundary, user+boundary, facts

    async def decide(self, *, personality, packet):
        return await self._llm_select(personality,packet,[a for a in _ACTION_SPACE if a.action_type.value in ('send_message','work','physical','rest','move')])


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


async def contract_json(router,messages,validator,max_tokens=900,repair_hint=None):
    for attempt in range(2):
        reply=await router.complete(LLMScene.DIRECTIVE,messages,max_tokens=max_tokens,json_mode=True)
        value=extract_json(reply.content)
        if validator(value): return value
        hint=repair_hint(value) if callable(repair_hint) else repair_hint
        messages=messages+[LLMMessage('assistant',reply.content),LLMMessage('user',hint or '该 JSON 不符合给定字段合同。重新检查原合同要求的字段名、数据类型与取值。只修复本次合同，不引入其他阶段字段，不新增事实。')]
    raise ValueError('semantic_contract_rejected_after_retry')


def valid_followup(value):
    return value.get('status') in ('continue','postpone','drop','none') and all(isinstance(value.get(k),str) for k in ('question','reason')) and type(value.get('delay_hours')) is int and 1<=value['delay_hours']<=48


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
    invalid=[s for s in value.get('source_ids',[]) if s not in {i['id'] for i in context.get('inputs',[])}]
    if invalid:hints.append(f'source_ids 中这些不属于外来输入：{invalid}。现场观察证据不能写入source_ids，移除它们。保留真正影响选择的给定输入ID。')
    for i,part in enumerate(value.get('message_parts',[])):
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
    step=max(0,int((at-epoch).total_seconds()//3600)); start=(epoch+timedelta(hours=8)).hour*3600
    time_label=lambda n: ((at if n==step else epoch+timedelta(hours=n))+timedelta(hours=8)).strftime('%Y-%m-%d %H:%M 上海')
    lock=asyncio.Lock()
    router=LLMRouter({s:PipeProvider(s.value,context['mode'],lock) for s in LLMScene})
    capability_names=json.loads(json.dumps(context['capabilities']))
    for activity in capability_names.get('activities',[]): activity.pop('activity_index',None)
    constraints='现实身体无摄像头、不能走动，仅圆屏、声音、触摸、单轴转头。虚拟化身可在聚形域按真实任务行动。\n' + json.dumps(capability_names,ensure_ascii=False)
    constraints += '\n时间：当前 '+time_label(step)+'。原始记录中以 Z 结尾的是 UTC 时间，上海时间需加八小时，不能混作同一时区。'
    constraints += '\n只知道给定现场和自己的记录；不能声明库存、技能、角色或外壳已改变。所有方法必须由 Node 核验。\n未完成事项：'+json.dumps(saved.get('followup'),ensure_ascii=False)
    constraints += '\n我的实际随身材料：'+json.dumps(context.get('inventory'),ensure_ascii=False)
    constraints += '\n我的实际测记：'+json.dumps(context.get('inquiry'),ensure_ascii=False)
    constraints += '\n我的回声与余辉记录：'+json.dumps(context.get('resonant_inquiry'),ensure_ascii=False)
    constraints += '\n我的实际兴趣、机会、愿望和试做：'+json.dumps(context.get('development'),ensure_ascii=False)
    constraints += '\n第一次自选探索还不能证明稳定爱好。需要实际返回，受邀劳动也不自动成为兴趣。已有试做可选对应的实际活动，不必每天做；条件受阻可以暂缓或换方法。'
    constraints += '\n我的明确约定与可商量事项：'+json.dumps(context.get('social'),ensure_ascii=False)
    constraints += '\n交流不能替对方答应，普通问候没有关系奖励。可回复一条实际收到的消息，可明确邀请、答应、拒绝、商量延期或退出。已接受的安排保留在世界事务中，不因目标队列变化而消失。'
    constraints += '\n现场数字以当前实际记录为准。别人的留言属于未核验说法，不能当作实际任务结果。没有自己的已完成记录，不要声称刚浇过水、做过照料或收获；可以提出想做或询问。'
    weights=actor.get('need_weights',{})
    soul=SoulLayer(name=actor['name'],agent_id=actor['actor_id'],role=actor['role'],core_traits=actor['traits'],core_values=actor['values'],
                   background=actor.get('background',''),hard_constraints=(constraints,),
                   innate_needs=tuple(NeedState(t,t.value,.35,weight=weights.get(t.value,1)) for t in NeedType))
    state=hydrate(saved.get('state',{}),actor['actor_id'],context['location']['id'])
    # Actual energy/appetite is a read-only physiological input, not generated evidence.
    state.need_intensities['physiological']=max(actor.get('appetite',.2),1-actor.get('energy',.8))
    personality=BoundedPersonality(soul,state,constraints)
    store=InMemoryAgentStore(); vectors=InMemoryVectorStore(); embedding=LexicalRetrieval()
    await restore_relations(store,saved,context['world_id'],actor['actor_id'])
    memory=MemorySystem(router,embedding,vectors,world_id=context['world_id'],agent_id=actor['actor_id'],is_main_character=actor['actor_id']=='shaping-001',
                        seconds_per_step=3600,world_start_second_of_day=start,time_label_for=time_label)
    await memory.ensure_collections()
    for entry in saved.get('memories',[]):
        payload=entry['payload']; stream=MemoryStream(payload['stream']); vector=await embedding.embed(payload.get('stored_content') or payload['raw_content'])
        await vectors.upsert(memory_collection_name(context['world_id'],actor['actor_id'],stream),entry['id'],vector.dense,None,payload)
    await memory.warm_recent_memories(step,lookback_steps=24*14)
    # Upstream counter is process-local. Node namespaces every new memory by job; old IDs preserved.
    memory._seq=int(saved.get('memory_sequence',0))
    need=NeedEngine(router,seconds_per_step=3600,world_start_second_of_day=start)
    agent=Agent(world_id=context['world_id'],agent_id=actor['actor_id'],personality=personality,decision_engine=BoundedDecision(router,seconds_per_step=3600,world_start_second_of_day=start),
                memory_system=memory,need_engine=need,relation_system=RelationSystem(store,world_id=context['world_id'],agent_id=actor['actor_id']),agent_store=store,llm_router=router,
                is_main_character=actor['actor_id']=='shaping-001',seconds_per_step=3600,world_start_second_of_day=start)
    restore_continuity(agent,memory,saved)
    spatial=SpatialPerception(location_id=context['location']['id'],location_view=LocationView(context['location']['name'],context['location']['description']),
         world_time_label=time_label(step),current_step=step,world_time_hour=(at+timedelta(hours=8)).hour,
         visible_entities=[VisibleEntity(entity_id=o['id'],name=o['name'],entity_type='landmark',description=o['description'],content=json.dumps(o['state'],ensure_ascii=False)) for o in context['objects']],
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
        if plan.action:
            await agent.begin_ongoing_step(plan=plan,estimated_steps=1)
            compile_prompt={'speaker':{'id':actor['actor_id'],'name':actor['name']},'at':context['at'],'intent':plain(plan.action),'capabilities':context['capabilities'],'objects':context['objects'],'prior_followup':saved.get('followup'),
                'available_sources':context.get('inputs',[]),'input_interpretations':interpretations,'prior_result_root':saved.get('last_result',{}).get('root_outcome_id'),
                'causality_contract':'同时返回 motivation: need|self_exploration|self_continuation|invited|accepted_obligation|unknown，source_ids: 实际影响本次选择的给定来源id数组，prior_root_id: 延续本人实际旧事的结果id或null。当前需要驱动填need；有自由余裕的首次探索填self_exploration；继续过去亲自做过的事填self_continuation并引用结果；受用户/居民请求填invited并引用来源；履行已经接受的约定填accepted_obligation并提供commitment_id。不虚构来源或把每个选择都标成自主。',
                'contract':'将意图编译为 JSON：{operation: activity|observe|rest|share|wait|travel, destination_index:1起或null, activity_id: 给定活动的精确ID或null, activity_index: 活动上明确标注的编号或null, object_index:1起或null, receiver_indices:1起的收件人编号数组, message:实际说出的消息或空字符串, title:短标题, reason:方法与限制, followup_decision:continue|postpone|drop|new|none}。只能选给定能力。activity 必须返回精确 activity_id；如另填 activity_index 必须与该条 activity_index 一致，不能自己数数组位置。意图涉及实际测记、试验、制作、排湿或移动时，优先匹配有明确条件和效果的 activity；observe 只是看一看，不能代替正式测记或产生作品。travel 的 destination_index 绑定 capabilities.travel.destinations 编号；上游 move 意图必须编译为 travel，不得当成已抵达或当地已完成活动。不把工作默认当成已完成，也不制造物品。observe 必须绑定一个对象，rest 不得伪装完成研究。share 必须在 receiver_indices 填入 capabilities.share.receivers 里至少一人的编号；向多人留言可填多个编号，不可填null。留言不代表对方答应或已建立关系。activity 包含未满足条件时也可提出，会被服务端拒绝并反馈。'}
            compile_prompt['social']=context.get('social',{})
            compile_prompt['speech_evidence']=context.get('speech_evidence',[])
            compile_prompt['speech_contract']='share必须用message_parts数组（最多3段），message填空字符串，不直接发自由事实叙述。每段为{kind:evidence,evidence_id:给定证据ID}或{kind:question|hypothesis|intention|greeting,text:最多160字}。事实仅选择speech_evidence编号，由服务端呈现完整原文，系统会标注观察/听闻/实际结果。猜想和打算各自标注未核验/未执行；自由文本不许声称已完成、别人已答应或已经证实。greeting只允许你好、谢谢你、回头见、早上好、晚上好。若是在回复消息，reply_to填social.replies中的精确message_id，否则null。正式邀请需social:{operation:invite,option_id:可用选项ID}；回复约定需social:{operation:respond,commitment_id:自己的约定ID,response:accept|decline|delay|withdraw,delay_minutes:延期15至240整数}。正式时间只写在social.delay_minutes，系统据此表达；附言不要写时刻或时长，避免两套时间冲突。没有正式社交命令则social:null。只邀请一个人，不能从话语推断对方答应。'
            compile_prompt['format_limits']='只返回一个简短 JSON 对象，不复述上下文。title最多40字，reason最多160字，message最多180字。motivation、source_ids（无来源填[]）、prior_root_id（无则null）、followup_decision 均不可省略。不得加入解释段落。没有本人已完成任务证据，不说刚忙完、刚照料完、刚到达；问候可直接开始。'
            compile_prompt['development']=context.get('development')
            compile_prompt['development_contract']='interest_choice 和 wish_choice 是输出JSON顶层字段，不可再套development对象。通常两者填 null。确实决定改变当前投入时可填 interest_choice:{topic:给定主题,decision:continue|pause|drop|revisit,reason:具体原因,root_ids:该主题给定active_roots或recent_success_roots的非空子集}；只表达选择，不凭话增加喜欢或实践。如果我确实想提出或暂缓某个新角色，可填 wish_choice:{direction_id:给定方向,decision:consider|propose|defer,reason:具体原因}；propose仅在eligible为true时可用，仍不改变外观。不同于“可以提出”，“我现在愿意提出”需要我自己的选择。不为满足进度强行换角色。'
            compile_prompt['speech_contract']+='证据段简化为{kind:evidence,evidence_id:给定ID}即可，不需要quote字段，服务器会逐字插入带来源的完整原文。若仍填写quote必须与speech_evidence.text完全一致，不能只抄social.replies.text。'
            output['compiled']=await contract_json(router,[LLMMessage('system','你是聚形域意图编译器。只返回一个简短完整 JSON。'),LLMMessage('user',json.dumps(compile_prompt,ensure_ascii=False))],lambda value: valid_life_compilation(value) and valid_activity_binding(value,context) and valid_source_binding(value,context) and valid_social_compilation(value,context) and valid_development_binding(value,context),max_tokens=1600,repair_hint=lambda value: compilation_repair(value,context))
        else: output['compiled']={'operation':'wait','reason':'本回合没有可采用的行动。','followup_decision':'postpone'}
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
        output['followup']=await contract_json(router,[LLMMessage('system','你就是此角色。基于已经核验的结果，留下一项诚实的后续。只返回 JSON。'),
             LLMMessage('user',json.dumps({'personality':personality.to_prompt_context(),'actual_result':result,'prior_followup':saved.get('followup'),
              'now':context['at'],'contract':'{"status":"continue|postpone|drop|none", "question":"仍想做或暂时放下什么", "reason":"为什么", "delay_hours":1至48整数}。status字段名必须是status，不能写type。delay_hours 从 now 的实际时间计算；用具体事项描述后续，不写与delay_hours不符的明天/今晚。受阻应改变办法或等待具体条件，不能声称失败的工作已完成。'},ensure_ascii=False))],valid_followup)
    else: raise ValueError('unknown_phase')
    await memory.drain_writes()
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
