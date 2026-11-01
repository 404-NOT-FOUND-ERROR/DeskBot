"""Keep Asamana's needs/queue, bind concrete goal steps to the same opportunities.

Replaces its existing generation call, without an additional model pass. Open
aspirations remain unbound; only the world proves a bound step completed.
"""
import json
from copy import deepcopy
from dataclasses import replace
from agent.need import NeedEngine
from agent.goals import GoalStatus
from agent.personality import PersonalityLayer
from core.interfaces.llm import LLMScene, LLMMessage, extract_json
from opportunity_contract import CONTRACT, OPPORTUNITY_PROMPT, opportunity_errors


def parse_goal_opportunities(data, context):
    if not isinstance(data, dict) or not isinstance(data.get('goals'), list) or len(data['goals']) > 2:
        raise ValueError('goal_opportunity_invalid')
    goals, declarations, seen = [], {}, set()
    for raw in data['goals']:
        if isinstance(raw, str):
            raw = {'text':raw, 'next_step':None}
        if not isinstance(raw, dict) or set(raw)-{'text', 'due_in_hours', 'next_step', 'followup_id'}:
            raise ValueError('goal_opportunity_invalid')
        text = raw.get('text')
        if not isinstance(text, str) or not 0 < len(text.strip()) <= 50 or text in seen:
            raise ValueError('goal_opportunity_invalid')
        seen.add(text)
        hours = raw.get('due_in_hours')
        if hours is not None and (type(hours) is not int or not 1 <= hours <= 48):
            raise ValueError('goal_opportunity_invalid')
        # Prior free-text goals carry no executable authority. Never infer a
        # binding from their words when replaying an old response.
        ref = raw.get('next_step')
        if ref is not None:
            if not isinstance(ref, dict) or ref.get('kind') != 'opportunity' or opportunity_errors({'status':'continue', 'next_step':ref, 'followup_id':raw.get('followup_id')}, context):
                raise ValueError('goal_opportunity_unavailable')
            declarations[text] = {'text':text, 'next_step':deepcopy(ref), 'followup_id':raw.get('followup_id')}
        goals.append((text, hours))
    return goals, declarations


def grounded_goal_progress(entities, previous, context):
    bindings = {g['goal_id']:g for g in context.get('goal_opportunities', {}).get('goals', [])}
    old = {g.id:g for g in previous}
    result = []
    for g in entities:
        proof = bindings.get(g.id)
        if proof and g.status == GoalStatus.COMPLETED and not proof.get('evidence_ids'):
            prior = old.get(g.id)
            g = replace(g, status=prior.status if prior and prior.status != GoalStatus.COMPLETED else GoalStatus.ACTIVE,
                        progress_summary='本人有了新的判断，但绑定步骤尚无执行器完成证据；保留复查。')
        result.append(g)
    return result


class OpportunityNeedEngine(NeedEngine):
    def __init__(self, *args, context, **kwargs):
        super().__init__(*args, **kwargs)
        self.context, self.pending_bindings, self.bindings = context, {}, []

    async def _generate_short_term_goals(self, **kwargs):
        if self.context.get('opportunities', {}).get('schema') != CONTRACT['view_schema']:
            return await super()._generate_short_term_goals(**kwargs)
        if self._llm_router is None or kwargs.get('personality') is None or kwargs.get('dominant_need') is None:
            return []
        view = {'self':PersonalityLayer.to_prompt_context(kwargs['personality']), 'dominant_need':kwargs['dominant_need'].value,
                'signals':kwargs.get('perceived_signal_texts') or [], 'memories':(kwargs.get('recent_memory_texts') or [])[:10],
                'foiled':kwargs.get('recent_foiled_texts') or [],
                'external': [getattr(g, 'text', '') for g in kwargs.get('external_goals') or []],
                'queue': [{'id':g.id, 'text':g.text, 'due_step':g.due_step} for g in kwargs.get('current_queue') or []],
                'options': [{k:r.get(k) for k in ('id','title','status','blocker','requires_issue')} for r in self.context['opportunities']['entries']]}
        prompt = OPPORTUNITY_PROMPT + (
            '这是已有需要层的一次短期目标生成。不重复queue里的方向，可没有新目标。'
            '只返回一个 JSON 对象：{goals:[{text:最多50字,due_in_hours:null或1至48整数,next_step:null或{kind:opportunity,id:给定ID},followup_id:null或requires_issue}]}，最多2项。'
            '具体步骤用给定机会ID，并说清只想完成哪一步；更大的愿望或未实现的设想填next_step:null。'
            'blocked只是条件未满足，不表示失败。due_in_hours仅用于确有约定时间的目标，通常为null。')
        response = await self._llm_router.complete(LLMScene.NEED_GOAL_GENERATION,
            [LLMMessage('system',prompt), LLMMessage('user',json.dumps(view,ensure_ascii=False))],
            temperature=.7, max_tokens=500, json_mode=True)
        goals, self.pending_bindings = parse_goal_opportunities(extract_json(response.content), self.context)
        return goals

    async def run(self, **kwargs):
        self.pending_bindings = {}
        prior = {g.id for g in kwargs['personality'].state.short_term_goal_entities}
        evaluation = await super().run(**kwargs)
        self.bindings = [{'goal_id':g.id, **deepcopy(self.pending_bindings[g.text])}
                         for g in evaluation.short_term_goal_entities if g.id not in prior and g.text in self.pending_bindings]
        return evaluation

    async def evaluate_goal_progress(self, **kwargs):
        prior = list(kwargs['personality'].state.short_term_goal_entities)
        result = await super().evaluate_goal_progress(**kwargs)
        return grounded_goal_progress(result, prior, self.context)
