"""Validate issue references without inferring a person's intention from keywords."""


def issue_id(issue):
    return (issue or {}).get('followup_id') or (issue or {}).get('origin_root_outcome_id') or (issue or {}).get('from_root_outcome_id')


def continuation_errors(value, context):
    view = context.get('continuation') or {}
    if view.get('schema') not in ('deskbot.cognitive-continuation.v2', 'deskbot.cognitive-continuation.v3'):
        return []  # Replay of an earlier context keeps its earlier contract.
    errors = []
    if any(k in value for k in ('completion_target', 'target_bound_at', 'resolution_evidence_ids', 'completion_proofs', 'object_scope_ids', 'related_object_ids', 'current_conditions', 'completed_steps')):
        errors.append('completion_target/target_bound_at/resolution_evidence_ids/completion_proofs是执行器只读字段；只可选择completion_target_id')
    current = view.get('current')
    issues = [f for f in [current, *view.get('deferred', [])] if f]
    reference = value.get('followup_id')
    selected = next((f for f in issues if issue_id(f) == reference), None) if reference else current
    if reference and not selected:
        errors.append('followup_id必须是current或deferred给定的本人问题ID')
    if context.get('phase') == 'feedback' and reference and reference != issue_id(current):
        errors.append('结果反馈不能另换问题ID；先完成本次已绑定问题的反馈，下一计划才能恢复别的问题')
    decision = value.get('followup_decision')
    review = value.get('step_review')
    if review is not None:
        if (not isinstance(review, dict) or view.get('step_contract') != 'completed-steps-v1'
            or not selected or not selected.get('completion_target') or context.get('phase') == 'feedback'
            or decision not in ('continue', 'postpone') or value.get('followup_closure')
            or review.get('target_id') != selected['completion_target']['id']
            or not isinstance(review.get('reason'), str) or not 0 < len(review['reason'].strip()) <= 240
            or not isinstance(review.get('evidence_ids'), list) or not review['evidence_ids']
            or any(r not in selected.get('resolution_evidence_ids', []) for r in review['evidence_ids'])):
            errors.append('step_review只能在计划复查已完成的小目标：原target_id、真实resolution_evidence_ids和reason；保留原研究，不与结案并用')
        elif value.get('completion_target_id') == review['target_id']:
            errors.append('已复查完成的步骤不重复绑定；下一目标选另一步或null，原成果自动保存在completed_steps')
    target = value.get('completion_target_id')
    if target is not None:
        if not any(t['id'] == target for t in view.get('completion_targets', [])):
            errors.append('completion_target_id只能选给定客观小目标；开放探索可填null')
        if decision not in ('new', 'none') and selected and selected.get('completion_target') and selected['completion_target']['id'] != target and not review:
            errors.append('已有问题的完成条件不能改成另一个容易目标；新目标需明确另开问题')
        if value.get('followup_closure') or context.get('phase') == 'feedback':
            errors.append('完成条件需先在计划绑定；反馈/结案时不能临时改标准')
    capacity = view.get('deferred_capacity', {})
    if current and decision in ('new', 'none') and not value.get('followup_closure') and capacity.get('used', 0) >= capacity.get('limit', 8):
        errors.append('暂存队列已满，先继续或恢复一个问题，或明确个人收束/放下；不能静默丢弃旧问题')
    if decision in ('continue', 'postpone', 'drop') and selected and reference != issue_id(selected):
        errors.append('继续、暂缓或放下已有问题时，必须填写该问题精确的followup_id')
    closure = value.get('followup_closure')
    if closure is not None:
        if (not isinstance(closure, dict) or not selected or closure.get('followup_id') != issue_id(selected)
            or closure.get('kind') not in ('resolved', 'abandoned', 'satisfied')
            or not isinstance(closure.get('reason'), str) or not 0 < len(closure['reason'].strip()) <= 240
            or not isinstance(closure.get('evidence_ids'), list)):
            errors.append('followup_closure需本人问题ID、resolved/satisfied/abandoned、明确reason和evidence_ids数组')
        elif closure['kind'] == 'resolved' and (not closure['evidence_ids'] or
                any(r not in (selected.get('resolution_evidence_ids', []) if view.get('schema') == 'deskbot.cognitive-continuation.v3' else view.get('completion_evidence_ids', [])) for r in closure['evidence_ids'])):
            errors.append('resolved只能引用该问题resolution_evidence_ids，证明事先绑定的具体小目标。留言/无关任务不证明完成；个人了解够了用satisfied，不把主观判断说成客观目标达成')
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
    wait = value.get('wait_for') or {}
    if view.get('wait_contract') == 'current-method-v1' and any(o['kind'] == wait.get('kind') and o['id'] == wait.get('id') and o.get('available') for o in view.get('wait_options', [])):
        errors.append('wait_for所等条件已经就绪，必须清空；仍可把该动作作为next_step。想晚些再做是个人安排，不是这个方法受阻；不能借其他方法的冷却或把已经入夜说成等夜晚')
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
                errors.append('wait_for与next_step不一致；等待activity或commitment时，next_step必须同kind/id或null。邀请已送出就等已有约定，不再选social重新提议；想交接不能等取水')
            if wait.get('kind') == 'reply' and step['kind'] == 'commitment':
                option = next((o for o in view.get('wait_options', []) if o['kind'] == 'reply' and o['id'] == wait['id']), {})
                if option.get('commitment_id') != step['id']:
                    errors.append('等回复必须属于这个实际约定')
            if wait.get('kind') == 'reply' and step['kind'] != 'commitment' and step != wait:
                errors.append('等回复的next_step只可用同一reply、关联commitment或null；不是重新提议')
    return errors


def issue_choice_errors(choice, context):
    contract = context.get('continuation', {}).get('decision_contract')
    if contract not in ('issue-choice-v1', 'issue-choice-v2') and choice is None:
        return []
    expected = {'followup_decision', 'followup_id', 'completion_target_id', 'followup_closure'} | ({'step_review'} if contract == 'issue-choice-v2' else set())
    if not isinstance(choice, dict) or set(choice) != expected:
        return ['issue_choice需字段' + '、'.join(sorted(expected)) + '；没有的填null']
    if choice['followup_decision'] not in ('continue', 'postpone', 'new', 'none', 'drop'):
        return ['issue_choice.followup_decision取continue/postpone/new/none/drop']
    return continuation_errors(choice, context)


def compiled_issue_errors(value, choice):
    if choice is None:
        return []  # Prior callers and deliberate no-action keep their existing path.
    if any(value.get(k) != choice.get(k) for k in ('followup_decision', 'followup_id', 'completion_target_id', 'followup_closure', 'step_review')):
        return ['编译必须保留本人issue_choice的全部字段，包括step_review，不能替本人放下、换问题或选择完成标准']
    return []


ISSUE_CHOICE_CONTRACT = (
    'act=true时另填issue_choice:{followup_decision:continue|postpone|new|none|drop,followup_id:本人问题ID或null,completion_target_id:目标ID或null,followup_closure:null或结案对象,step_review:null或已完成步骤复查对象}。'
    '本人先选择怎样对待原问题，编译器不替你选择。继续原研究不强制继续同一方法。'
    '想验证一个明确的小步骤，可在行动前选completion_targets中的目标；开放研究可不绑定。'
    '已有小目标不能偷偷换成另一个；current_conditions.target_status=achieved时可用resolution_evidence_ids收束这一步。'
    '研究还想继续时可step_review:{target_id:原小目标ID,reason:实际完成与剩余疑问,evidence_ids:resolution_evidence_ids}；followup_decision保持continue/postpone，同一问题下旧步骤归档，再选下一completion_target_id或null。不得重复绑定刚归档的目标；completed_steps不是待做清单。'
    '主动结束需followup_decision=drop、followup_closure:{followup_id,kind:resolved|satisfied|abandoned,reason,evidence_ids:[]}。'
    'resolved只证明事先绑定的一步；自己觉得了解够了用satisfied，不想继续用abandoned，不等同客观成果。'
    '可以继续、暂缓或恢复，不为达到实验进度而强行结案。SEND_MESSAGE的contact_intent.followup_id与issue_choice保持一致。'
    'act=false仅表示眼下不行动，不自动关闭或改写原问题。'
)


CONTINUATION_CONTRACT = (
    'followup_id绑定当前或deferred中的本人问题；没有关联问题填null。'
    'followup_decision=continue/postpone保持同一问题，不能因为换了方法就new。'
    'new/none表示做另一件事，原问题会暂存，可后来按ID恢复，不是关闭。'
    'drop或收束需followup_closure:{followup_id,kind:abandoned|satisfied|resolved,reason,evidence_ids:[]}。'
    '若有客观小目标，先在计划填completion_target_id，从completion_targets选择；开放探索可不绑定。'
    'resolved仅引用此问题resolution_evidence_ids证明此前绑定的一步，不能把交谈说成安装、把取水说成交水，也不宣称整个研究完成。'
    '觉得暂时了解够了用satisfied（个人收束），选择放下用abandoned；二者不声称物质任务完成。'
    '未完成条件不可换成较容易的目标；已完成步骤可在下一计划通过step_review引用真实证据归档，保留同一研究再选下一步。暂存最多8项，满时先处理旧事；允许恢复后换方法。'
    '暂缓不等于放弃兴趣。next_step选择next_options的{kind,id}或null；'
    'wait_for选择activity或commitment时，next_step必须同kind/id或null；等待reply时可选该reply、其关联commitment或null。'
    'social只表示尚未发出的新提议；一旦发出邀请，等待已有约定用commitment及其真实ID，不能再次选social提议。'
    '例如已发出邀请c：next_step和wait_for均为{kind:commitment,id:c}，而非social/give-water；明确没有下一步可填next_step:null。'
    '送水先提议，再等给定reply/commitment，对方可拒绝，尚未交接的水仍在自己背包。'
    '旧question/reason只说明上次为何惦记，current_conditions和wait_options说明现在；逐次重估，已到时的冷却不可再作为阻碍。'
    'wait_for只能选available=false的条件；ready的清空。每个blocker和ready_at只属于该id，不能把改罩六小时限制套给用灯/观察。无wait_for时delay_hours只是本人下次复查安排，不得说成系统禁止。'
    '反馈时可根据绑定目标的resolution_evidence_ids填写status:drop及followup_closure；不能事后补绑目标。'
)
