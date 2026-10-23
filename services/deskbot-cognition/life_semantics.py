"""Finite production purposes and factual anchors, outside the vendored cognition."""

def production_errors(value, context):
    view = context.get('use_context') or {}
    if view.get('contract') != 'finite-use-v1':
        return []
    production = next((p for p in view['production'] if value.get('operation') == 'activity' and p['activity_id'] == value.get('activity_id')), None)
    choice = value.get('production_use')
    if not production:
        return ['非生产动作不填写production_use'] if choice is not None else []
    if (not isinstance(choice, dict) or choice.get('activity_id') != production['activity_id']
        or choice.get('kind') not in ('self_use', 'accepted_delivery', 'reserve', 'experiment')
        or not isinstance(choice.get('reason'), str) or not 0 < len(choice['reason'].strip()) <= 240
        or type(choice.get('target_stock')) is not int or not 0 < choice['target_stock'] <= view['capacity']):
        return ['生产需production_use:{activity_id,kind:self_use|accepted_delivery|reserve|experiment,target_stock:有限目标库存整数,reference_id:依据ID或null,reason:具体用途}；不能把做点别的当作产物用途']
    if choice['kind'] == 'accepted_delivery':
        offer = next((o for o in production['accepted_outgoing'] if o['commitment_id'] == choice.get('reference_id')), None)
        if not offer or choice['target_stock'] != offer['count']:
            return ['交付用途只能引用已接受的accepted_outgoing及其数量，未回复不等于需要']
    elif choice['kind'] == 'self_use':
        consumer = next((u for u in production['uses'] if u['activity_id'] == choice.get('reference_id')), None)
        if not consumer or choice['target_stock'] != consumer['count']:
            return ['自用需引用给定uses活动及实际消耗量；已有足量就应使用现存物品，不再生产']
    elif choice['kind'] == 'experiment':
        cont = context.get('continuation', {})
        issue = next((f for f in [cont.get('current'), *cont.get('deferred', [])] if f and f.get('followup_id') == choice.get('reference_id')), None)
        if (not issue or value.get('followup_decision') not in ('continue', 'postpone') or value.get('followup_id') != issue['followup_id']
            or value.get('completion_target_id') != 'activity:' + production['activity_id']
            or any(s['target']['id'] == value.get('completion_target_id') for s in issue.get('completed_steps', []))
            or issue.get('completion_target', {}).get('id') == value.get('completion_target_id') and issue.get('resolution_evidence_ids')):
            return ['实践用途需本人原问题和事前绑定的当前活动小目标，不得重复已归档完成的同一步来为囤积找借口']
    elif choice.get('reference_id') is not None or choice['target_stock'] > production.get('reserve_limit', view['capacity']):
        return ['无具体用途的备用最多reserve_limit（一批产量）；reference_id填null。更大量需真实自用、已接受交付或尚未完成的实践，不得不断抬高备用目标']
    if choice['kind'] != 'experiment' and production['already_held'] >= choice['target_stock']:
        return ['现存物品已经满足本人声明的用途数量；请在决策阶段重新选择用现有物品、观察、休息等，不让编译器换动作']
    return []


PRODUCTION_CONTRACT = (
    '若选择有output的生产活动，另填production_use:{activity_id,kind:self_use|accepted_delivery|reserve|experiment,target_stock:希望持有的总量整数,reference_id:依据ID或null,reason:具体用途}。'
    'self_use引用该产物uses中真实消耗活动，数量用count；accepted_delivery引用已接受约定及count。'
    'reserve可为自己声明备用总量，最多给定reserve_limit（一批产量），reference_id=null；已有足量不应再产。更大量需真实用途或实践，不得不断上调备用数。'
    'experiment须绑定原问题和这一活动的completion_target_id，不重复已完成步骤。需要实验产物时说明待比较什么，而非借研究名义囤货。'
    '非生产动作production_use:null。不必为了消耗物品而强制送礼，可留存备用、实际使用、观察、休息或暂缓。'
)


def compiled_method_errors(value, context, method, production):
    if context.get('use_context', {}).get('contract') != 'finite-use-v1':
        return []
    if (method is not None and (value.get('operation') != 'activity' or value.get('activity_id') != method)
        or method is None and value.get('operation') == 'activity'):
        return ['编译必须保留本人decision_method，不可改选活动；非活动不得补造activity']
    if value.get('production_use') != production:
        return ['production_use须逐字复制本人decision_production，不能代选用途或数量']
    return production_errors(value, context)


def render_anchored_memory(frame, value):
    """All factual clauses come from the executor; the model selects attention/feeling."""
    facts = frame.get('facts', [])
    ids = [f['id'] for f in facts]
    if (not isinstance(value, dict) or value.get('fact_ids') != ids
        or value.get('focus_id') not in ids or not isinstance(value.get('feeling'), str)
        or not 0 < len(value['feeling'].strip()) <= 160):
        return ''
    anchor = '\n'.join(f['text'] for f in facts)
    return f"【已核验经历 · {frame['at']}】\n{anchor}\n【我的感受，不作事实依据】{value['feeling'].strip()}"
