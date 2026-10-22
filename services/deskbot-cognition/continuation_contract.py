"""Validate issue references without inferring a person's intention from keywords."""


def issue_id(issue):
    return (issue or {}).get('followup_id') or (issue or {}).get('origin_root_outcome_id') or (issue or {}).get('from_root_outcome_id')


def continuation_errors(value, context):
    view = context.get('continuation') or {}
    if view.get('schema') != 'deskbot.cognitive-continuation.v2':
        return []  # Replay of an earlier context keeps its earlier contract.
    errors = []
    current = view.get('current')
    issues = [f for f in [current, *view.get('deferred', [])] if f]
    reference = value.get('followup_id')
    selected = next((f for f in issues if issue_id(f) == reference), None) if reference else current
    if reference and not selected:
        errors.append('followup_id必须是current或deferred给定的本人问题ID')
    if context.get('phase') == 'feedback' and reference and reference != issue_id(current):
        errors.append('结果反馈不能另换问题ID；先完成本次已绑定问题的反馈，下一计划才能恢复别的问题')
    decision = value.get('followup_decision')
    if decision in ('continue', 'postpone', 'drop') and selected and reference != issue_id(selected):
        errors.append('继续、暂缓或放下已有问题时，必须填写该问题精确的followup_id')
    closure = value.get('followup_closure')
    if closure is not None:
        if (not isinstance(closure, dict) or not selected or closure.get('followup_id') != issue_id(selected)
            or closure.get('kind') not in ('resolved', 'abandoned')
            or not isinstance(closure.get('reason'), str) or not 0 < len(closure['reason'].strip()) <= 240
            or not isinstance(closure.get('evidence_ids'), list)):
            errors.append('followup_closure需本人问题ID、resolved或abandoned、明确reason和evidence_ids数组')
        elif closure['kind'] == 'resolved' and (not closure['evidence_ids'] or
                any(r not in view.get('completion_evidence_ids', []) for r in closure['evidence_ids'])):
            errors.append('resolved需要给定completion_evidence_ids中的实际完成证据；留言送达不证明所说的活动完成')
        if decision in ('continue', 'postpone') or value.get('status') in ('continue', 'postpone'):
            errors.append('已结案不能同时continue/postpone；暂时不做请保留问题而非结案')
    if selected and decision == 'drop' and not closure:
        errors.append('drop需明确followup_closure；临时绕路用new，原问题会暂存')
    if selected and value.get('motivation') == 'self_continuation' and value.get('prior_root_id') in (
            selected.get('from_root_outcome_id'), selected.get('origin_root_outcome_id')) and value.get('prior_root_id'):
        if decision in ('new', 'none', 'drop') and not closure:
            errors.append('已引用此问题的实际旧结果继续行动，不能同时new/none/drop；继续用continue并保留问题ID')
    if current and value.get('status') in ('none', 'drop') and not closure:
        errors.append('已有问题不能因为本次动作结束而自动结案；仍未解决用postpone，明确放下或解决才填followup_closure')
    step = value.get('next_step')
    if value.get('status') in ('continue', 'postpone') and 'next_step' not in value:
        errors.append('next_step必填：选next_options的kind/id，尚无具体办法可明确填null')
    if step is not None:
        if not isinstance(step, dict) or set(step) != {'kind', 'id'} or not any(
                o['kind'] == step['kind'] and o['id'] == step['id'] for o in view.get('next_options', [])):
            errors.append('next_step必须使用给定next_options；无可绑定办法请填null')
        else:
            wait = value.get('wait_for') or {}
            if wait.get('kind') in ('activity', 'commitment') and step != wait:
                errors.append('wait_for与next_step不一致；想交接物品不能绑定等待取水，须等实际消息/交接约定或换办法')
            if wait.get('kind') == 'reply' and step['kind'] == 'commitment':
                option = next((o for o in view.get('wait_options', []) if o['kind'] == 'reply' and o['id'] == wait['id']), {})
                if option.get('commitment_id') != step['id']:
                    errors.append('等回复必须属于这个实际约定')
    return errors


CONTINUATION_CONTRACT = (
    'followup_id绑定当前或deferred中的本人问题；没有关联问题填null。'
    'followup_decision=continue/postpone保持同一问题，不能因为换了方法就new。'
    'new/none表示做另一件事，原问题会暂存，可后来按ID恢复，不是关闭。'
    'drop或认为问题解决时必须明确followup_closure:{followup_id,kind:abandoned|resolved,reason,evidence_ids:[]}；'
    'resolved须引用completion_evidence_ids实际证据且确实解决问题，送出提议不代表履约。'
    '暂缓不等于放弃兴趣。next_step选择next_options的{kind,id}或null；'
    'wait_for若等待activity必须与next_step完全一致，不能想送水却等取水。'
    '送水先选social的give-water提议，再等给定reply/commitment，对方可拒绝，尚未交接的水仍在自己背包。'
)
