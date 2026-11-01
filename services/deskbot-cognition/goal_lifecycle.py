"""Versioned adaptation of the existing short-term queue, not a second planner.

The world owns completion predicates/evidence. This adapter proposes ID-addressed
transitions using the existing motivation/progress calls. No fuzzy merge, FIFO
failure or hour-count reaping applies to the new contract. Old contexts replay
through the original adapter unchanged.
"""
import hashlib
import json
import re
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from agent.goals import GoalEntity, GoalStatus
from opportunity_contract import opportunity_errors

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / 'contracts/cognitive-goal-lifecycle.v1.json').read_text(encoding='utf-8'))
PROMPT = CONTRACT['rule'] + (
    '只返回JSON {goal_updates:[]}；没有必要变化时为空。每项为'
    '{operation:new|continue|replan|postpone|resume|abandon|complete,goal_id:已有ID或新建时null,reason:最多200字}。'
    'new仅在plan允许，另有text最多50字、criterion_id给定标准ID或null、next_step给定机会kind/id或null、followup_id给定ID或null。'
    'replan保留goal_id及完成标准，另填next_step与followup_id。其他操作不得更改方法。'
    '未终结的操作可填review_in_hours:1至48整数（默认6）；它仅是个人复查时间，不是约定截止。'
    '目标以ID引用；不可换文字重建已有目标。不同条件的研究即使措辞近似也有不同标准。'
    '每次最多2个新目标，总计最多6个未了结目标；不要为腾位置自动放下。postpone后可以resume。'
    'complete仅在给定evidence_ids非空时可用；开放研究可保留或abandon，不以一次成功自动完成。'
    '已过复查时间或方法受阻均不表示失败；请决定保留、换办法、暂缓或放下。'
)


def enabled(context):
    return context.get('goal_lifecycle', {}).get('schema') == CONTRACT['schema']


def parse_updates(data, context, entities, step):
    if not isinstance(data, dict) or set(data) != {'goal_updates'} or not isinstance(data['goal_updates'], list) or len(data['goal_updates']) > CONTRACT['max_updates']:
        raise ValueError('goal_lifecycle_invalid')
    if sum(isinstance(u,dict) and u.get('operation')=='new' for u in data['goal_updates'])>CONTRACT['max_new']:
        raise ValueError('goal_capacity_review_required')
    view = context['goal_lifecycle']; records = {g['goal_id']:deepcopy(g) for g in view['goals']}
    current = {g.id:deepcopy(g) for g in entities}; seen = set(); updates = []
    for raw in data['goal_updates']:
        if not isinstance(raw, dict) or set(raw)-{'operation','goal_id','reason','text','criterion_id','next_step','followup_id','review_in_hours'}:
            raise ValueError('goal_lifecycle_invalid')
        u = deepcopy(raw); op = u.get('operation'); gid = u.get('goal_id'); reason = u.get('reason')
        if op not in CONTRACT['operations'] or not isinstance(reason,str) or not reason.strip() or len(reason)>200:
            raise ValueError('goal_lifecycle_invalid')
        if op == 'new':
            text = u.get('text'); criterion_id = u.get('criterion_id')
            if context['phase'] != 'plan' or not isinstance(text,str) or not text.strip() or len(text)>50:
                raise ValueError('goal_lifecycle_invalid')
            if gid is None:
                seed = [context.get('actor',{}).get('actor_id'),context.get('at'),step,text,criterion_id]
                gid = 'goal:' + hashlib.sha256(json.dumps(seed,ensure_ascii=False).encode()).hexdigest()[:24]
                u['goal_id'] = gid
            if gid in records or gid in current:raise ValueError('goal_identity_changed')
            criteria = next((k for k in view['criteria'] if k['id']==criterion_id),None) if criterion_id else {'kind':'open_inquiry','title':text}
            if not criteria:raise ValueError('goal_criterion_changed')
            if any(g['lifecycle_status'] in ('active','postponed') and (g['text']==text or criterion_id and g['completion_criteria'].get('id')==criterion_id) for g in records.values()):
                raise ValueError('goal_duplicate_use_existing_id')
            record = {'goal_id':gid,'text':text,'completion_criteria':deepcopy(criteria),'lifecycle_status':'active','evidence_ids':[]}
            records[gid] = record
            current[gid] = GoalEntity(id=gid,text=text,goal_type='short_term',created_step=step)
        else:
            record = records.get(gid)
            if not record or gid not in current or op not in CONTRACT['transitions'].get(record['lifecycle_status'],[]):
                raise ValueError('goal_transition_invalid')
            if 'text' in u and u['text']!=record['text'] or 'criterion_id' in u and u['criterion_id']!=record['completion_criteria'].get('id'):
                raise ValueError('goal_criterion_immutable')
        if not isinstance(gid,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9:._-]{0,159}',gid) or gid in ('constructor','prototype') or gid in seen:
            raise ValueError('goal_lifecycle_invalid')
        seen.add(gid)
        if op in ('new','replan'):
            if context['phase']!='plan':raise ValueError('goal_replan_requires_plan')
            ref = u.get('next_step'); criterion = record['completion_criteria']
            if criterion['kind']!='open_inquiry' and not ref:raise ValueError('goal_method_required')
            if ref:
                if opportunity_errors({'status':'continue','next_step':ref,'followup_id':u.get('followup_id')},context):raise ValueError('goal_method_not_compatible')
                method = next((r for r in context['continuation']['next_options'] if r['kind']==ref['kind'] and r['id']==ref['id']),None)
                candidate = next((k for k in view['criteria'] if method and method.get('opportunity_id') in k['opportunity_ids']),None)
                if not method or not method.get('opportunity_id') or not (criterion['kind']=='open_inquiry' or criterion['kind']=='exact_opportunity' and criterion.get('identity')==method.get('identity') or criterion.get('id') and candidate and candidate['id']==criterion['id']):
                    raise ValueError('goal_method_not_compatible')
        elif u.get('next_step') is not None or u.get('followup_id') is not None:raise ValueError('goal_replan_required')
        if op=='complete' and (record['completion_criteria']['kind']=='open_inquiry' or not record.get('evidence_ids')):
            raise ValueError('goal_completion_without_result')
        status = {'postpone':'postponed','resume':'active','abandon':'abandoned','complete':'completed'}.get(op,record['lifecycle_status'])
        record['lifecycle_status'] = status
        if status in ('active','postponed'):
            hours=u.get('review_in_hours',CONTRACT['review_hours']['default'])
            if type(hours) is not int or not CONTRACT['review_hours']['min']<=hours<=CONTRACT['review_hours']['max']:raise ValueError('goal_review_time_invalid')
        current[gid]=replace(current[gid],status=GoalStatus(CONTRACT['entity_status'][status]),last_evaluated_step=step,progress_summary=reason)
        updates.append(u)
    if sum(g['lifecycle_status'] in ('active','postponed') for g in records.values())>CONTRACT['max_live']:raise ValueError('goal_capacity_review_required')
    live = [g for g in current.values() if g.status in (GoalStatus.ACTIVE,GoalStatus.INTERRUPTED)]
    closed = [g for g in current.values() if g.status not in (GoalStatus.ACTIVE,GoalStatus.INTERRUPTED)]
    return live+closed[-CONTRACT['history_limit']:], updates
