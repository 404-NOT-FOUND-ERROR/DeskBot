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
            return ['production_use.kind=self_use时reference_id须选本次uses中的消耗活动ID，target_stock等于其count；这不表示其他地点不存在用途。若原意只是今后备用，可自主选择reserve；若要实际验证原问题，可自主选择experiment并遵守相应合同，不强迫改变原意']
    elif choice['kind'] == 'experiment':
        if view.get('experiment_rule') in ('authored-method-v1','method-conditions-v2') and not production.get('experiment'):
            return ['该方法没有已定义的可验证实验效果；不能因为同处水岸或产物相同就冒充归途灯实验']
        registered = view.get('experiment_rule') == 'method-conditions-v2'
        experiment = production.get('experiment') or {}
        if registered and (not experiment.get('available') or choice['target_stock'] != production['already_held'] + production['output_count']):
            return ['本次方法和条件已经留有实际证据，或产量不是已登记的一批；改问题名称、时钟变化不能重新制造实验用途']
        cont = context.get('continuation', {})
        issue = next((f for f in [cont.get('current'), *cont.get('deferred', [])] if f and f.get('followup_id') == value.get('followup_id')), None)
        if not issue or value.get('followup_decision') not in ('continue', 'postpone'):
            return ['experiment需要当前本人问题；issue_choice.followup_id须是current/deferred的问题ID，并选择continue或postpone']
        if choice.get('reference_id') != issue['followup_id']:
            return [f"production_use.reference_id填本人问题ID {issue['followup_id']}，必须等于issue_choice.followup_id；不要填活动ID或completion_target_id。当前填的是 {choice.get('reference_id')}。这是引用字段错误，不表示活动不能做"]
        expected = experiment['completion_target_id'] if registered else 'activity:' + production['activity_id']
        if value.get('completion_target_id') != expected:
            return [f'用于验证所选活动时，issue_choice.completion_target_id须事前选择 {expected}；未完成的旧目标仍不能偷换']
        if (any(s['target']['id'] == expected for s in issue.get('completed_steps', []))
            or issue.get('completion_target', {}).get('id') == expected and issue.get('resolution_evidence_ids')):
            return ['该实验步骤已有完成证据；不能再次生产并将同一步说成尚未完成，可复查成果、选择别的用途或暂缓']
    elif choice.get('reference_id') is not None or choice['target_stock'] > production.get('reserve_limit', view['capacity']):
        return ['无具体用途的备用最多reserve_limit（一批产量）；reference_id填null。更大量需真实自用、已接受交付或尚未完成的实践，不得不断抬高备用目标']
    if choice['kind'] != 'experiment' and production['already_held'] >= choice['target_stock']:
        return ['现存物品已经满足本人声明的用途数量；请在决策阶段重新选择用现有物品、观察、休息等，不让编译器换动作']
    return []


PRODUCTION_CONTRACT = (
    '若选择有output的生产活动，另填production_use:{activity_id,kind:self_use|accepted_delivery|reserve|experiment,target_stock:希望持有的总量整数,reference_id:依据ID或null,reason:具体用途}。'
    'self_use的reference_id=uses中的消耗活动ID，target_stock=count；accepted_delivery的reference_id=已接受约定commitment_id，target_stock=count。'
    'reserve可为自己声明备用总量，最多给定reserve_limit（一批产量），reference_id=null；已有足量不应再产。更大量需真实用途或实践，不得不断上调备用数。'
    'experiment的reference_id必须逐字等于issue_choice.followup_id（本人问题ID，不是activity ID）；issue_choice.completion_target_id=activity:所选活动ID，不重复已完成步骤。说明待比较什么，而非借研究名义囤货。'
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
    if frame.get('affect_contract') == 'bounded-affect-v1':
        if (not isinstance(value, dict) or set(value) != {'focus_id', 'feeling', 'wish'}
            or value.get('focus_id') not in ids or value.get('feeling') not in AFFECT_FEELINGS
            or value.get('wish') not in AFFECT_WISHES):
            return ''
        # The selected focus stays identifiable, while no ungrounded sentence
        # can invent an action, other person's response, quantity or cause.
        anchor = '\n'.join(f['text'] for f in facts)
        return (f"【已核验经历 · {frame['at']}】\n{anchor}\n【我的感受，不作事实依据】"
                f"想到上面第{ids.index(value['focus_id'])+1}项，我{AFFECT_FEELINGS[value['feeling']]}。{AFFECT_WISHES[value['wish']]}")
    if (not isinstance(value, dict) or value.get('fact_ids') != ids
        or value.get('focus_id') not in ids or not isinstance(value.get('feeling'), str)
        or not 0 < len(value['feeling'].strip()) <= 160):
        return ''
    anchor = '\n'.join(f['text'] for f in facts)
    return f"【已核验经历 · {frame['at']}】\n{anchor}\n【我的感受，不作事实依据】{value['feeling'].strip()}"


AFFECT_FEELINGS = {'curious':'有些好奇', 'uncertain':'还拿不准', 'pleased':'有些开心',
                  'relieved':'松了口气', 'uneasy':'有点不安', 'disappointed':'有些失落', 'calm':'心情平静'}
AFFECT_WISHES = {'understand':'我想慢慢弄明白。', 'try':'我想再找机会动手试试。',
                'rest':'我想先歇一歇。', 'share':'我想找人聊聊。', 'wait':'我愿意先等等看。',
                'leave':'我想把注意力放到别处。', 'none':'我暂时没有新的打算。'}
