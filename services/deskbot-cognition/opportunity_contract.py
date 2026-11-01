"""Shared opportunity references; no world/material rules are implemented here."""
import json
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / 'contracts/cognitive-opportunities.v1.json').read_text(encoding='utf-8'))


def opportunity_errors(value, context):
    view = context.get('continuation', {})
    if view.get('opportunity_contract') != CONTRACT['view_schema']:
        return []
    rows = view.get('next_options', [])
    find = lambda ref: next((r for r in rows if isinstance(ref, dict) and r['kind'] == ref.get('kind') and r['id'] == ref.get('id')), None)
    issues = [f for f in [view.get('current'), *view.get('deferred', [])] if f]
    selected = view.get('current') if value.get('followup_id') is None else next((f for f in issues if f.get('followup_id') == value['followup_id']), None)
    active = value.get('status', value.get('followup_decision')) in ('continue', 'postpone')
    errors = ['followup_issue_unknown'] if value.get('followup_id') is not None and selected is None else []
    for field in ('next_step', 'wait_for'):
        ref = value.get(field)
        if ref is None:
            continue
        row = find(ref)
        if not isinstance(ref, dict) or set(ref) != {'kind', 'id'} or row is None:
            errors.append('followup_condition_unknown' if field == 'wait_for' else 'followup_opportunity_unavailable')
            continue
        if row.get('requires_issue') and (not active or (selected or {}).get('followup_id') != row['requires_issue']):
            errors.append('followup_opportunity_issue_mismatch')
        if field == 'wait_for' and row.get('available'):
            errors.append('followup_condition_already_ready')
        current = selected or {}
        if field == 'wait_for' and current.get('condition') == 'review_required' and current.get('wait_for') == ref:
            errors.append('followup_wait_needs_reconsideration')
    wait, step = find(value.get('wait_for')), find(value.get('next_step'))
    if wait and step:
        if wait.get('opportunity_id') and wait['opportunity_id'] != step.get('opportunity_id'):
            errors.append('followup_wait_step_mismatch')
        if wait['kind'] in ('reply', 'commitment') and step.get('opportunity_id'):
            errors.append('followup_wait_step_mismatch')
        if wait['kind'] == 'commitment' and (step['kind'], step['id']) != ('commitment', wait['id']):
            errors.append('followup_wait_step_mismatch')
        if wait['kind'] == 'reply' and not (step['kind'] == 'reply' and step['id'] == wait['id'] or step['kind'] == 'commitment' and step['id'] == wait.get('commitment_id')):
            errors.append('followup_wait_step_mismatch')
    return errors


OPPORTUNITY_PROMPT = (
    '当前动作、短期目标和后续只从同一opportunities/next_options选择。每个opportunity已绑定真实用途、对象和收件人。'
    'ready可考虑行动，blocked可以等待它实际列出的条件；没有选项不等于冷却，应复查或换事。'
    'next_step优先填{kind:opportunity,id:给定ID}，不是活动名或自由生成ID；它只是意向，不是预约。'
    '备用已足、同条件已测、同用途未回复时不能再把原活动写回下一步。'
    '可保留没有可行办法的设想，next_step:null；个人想晚些做不代表系统禁止。'
)
