"""Lossless field selection per cognition stage; never rewrite canonical facts.

Identity remains in Asamana's personality layer. Execution uses the full frozen
context, irrespective of this prompt-only projection.
"""
from copy import deepcopy
from followup_phases import FEEDBACK_PROMPT
from followup_intent import CONTRACT as INTENT_CONTRACT

BODY_BOUNDARY = ('现实身体无摄像头、不能走动，仅屏幕、声音、触摸、单轴转头。虚拟化身可以按实际任务行走。'
                 '只知道给定现场和自己的记录；留言是听闻，想法不是事实。库存、承诺、身份改变均由执行器核验。'
                 'UTC与上海时间是同一时刻的不同表示，不混用。')


def goal_lifecycle_view(context):
    """The prompt needs current criteria and proof, not duplicated attempt logs."""
    raw=context.get('goal_lifecycle', {})
    fields=('goal_id','text','completion_criteria','lifecycle_status','evidence_ids','next_review_at','review_due','method_status','completion_status')
    if raw.get('prompt_version'):
        fields += ('followup_id',)
    view={k:deepcopy(v) for k,v in raw.items() if k!='goals'}
    view['goals']=[{k:deepcopy(g[k]) for k in fields if k in g} for g in raw.get('goals', [])]
    if context.get('evidence_refs') and context.get('phase')=='feedback':
        # Feedback cannot create a goal or choose a new method. Keep each
        # existing goal's immutable criterion/proof, omit unbound catalogues.
        view.pop('criteria',None)
    return view

def continuation_view(context):
    """Keep identity/history intact but label an old appraisal as dated, not current truth."""
    view = deepcopy(context.get('continuation') or {})
    if context.get('phase') == 'feedback':
        view['rule'] = FEEDBACK_PROMPT
        # Unbound targets are plan choices. Keep the current target, completed
        # history and actual resolution evidence available for honest feedback.
        view.pop('completion_targets', None)
        view.pop('decision_contract', None)
        view.pop('step_contract', None)
    if view.get('opportunity_contract'):
        for key in ('next_options', 'wait_options'):
            # IDs/conditions suffice for a future reference. Actual execution
            # retains the complete frozen binding outside the prompt.
            view[key] = [{k:v for k,v in o.items() if k not in ('binding','legacy_alias')}
                         for o in view.get(key, []) if not o.get('legacy_alias')]
    for issue in [view.get('current'), *view.get('deferred', [])]:
        if not issue or 'current_conditions' not in issue:
            continue
        for key in ('next_binding','wait_binding'):
            if issue.get(key):
                issue[key] = {k:v for k,v in issue[key].items() if k != 'binding'}
        for key in ('next_step','wait_for'):
            row = issue['current_conditions'].get(key)
            if row:
                issue['current_conditions'][key] = {k:v for k,v in row.items() if k != 'binding'}
        issue['original_question'] = issue.get('original_question') or issue.get('question', '')
        issue['previous_review'] = {k: issue.pop(k) for k in ('question', 'reason', 'next_step', 'wait_for') if k in issue}
        issue['previous_review']['at'] = issue.get('last_reviewed_at') or issue.get('wait_started_at') or issue.get('created_at')
        issue['previous_review']['rule'] = '这是当时的想法。当前要等什么，以current_conditions和wait_options重新核对，不复制过时理由。'
    return view

def stage_context(context, stage):
    common = ('time', 'inventory', 'continuation', 'grounding', 'use_context', 'goal_opportunities', 'goal_lifecycle', 'event_evidence', 'evidence_refs')
    research = ('inquiry', 'resonant_inquiry', 'windleaf_inquiry', 'waylight', 'development')
    if stage in ('perception', 'interrupt'):
        fields = common + ('social',)
    elif stage in ('feedback', 'followup', 'followup_repair'):
        # The exact actual_result and factual_memory are supplied by the result path.
        fields = common + ('development', 'social')
    elif stage in ('memory', 'reflection', 'long_term_goals', 'relation_evolution'):
        fields = ('time', 'continuation', 'development', 'social', 'grounding')
    else:
        # Motivation and decision both retain alternative activities and real limits.
        fields = common + research + ('capabilities', 'social')
    result = {k: deepcopy(context[k]) for k in fields if k in context}
    if 'goal_lifecycle' in result:
        result['goal_lifecycle']=goal_lifecycle_view(context)
        result.pop('goal_opportunities',None)  # Legacy view is the same records, not additional evidence.
        if context.get('evidence_refs') and stage in ('perception','interrupt','feedback','followup','followup_repair'):
            result['goal_lifecycle'].pop('criteria',None)
    if 'continuation' in result:
        result['continuation'] = continuation_view(context)
    if stage not in ('decision', 'motivation', 'plan', ''):
        continuation = result.get('continuation', {})
        continuation.pop('completion_targets', None)
        continuation.pop('next_options', None)
        # Existing bound criteria/evidence, pending conditions and deferred issues stay.
    return result


def _fields(record, keys):
    return {key: deepcopy(record[key]) for key in keys if key in (record or {})}


def _option_fields(option):
    return _fields(option, ('kind', 'id', 'title', 'status', 'available', 'blocker', 'requires_issue',
                            'ready_at', 'asset_id', 'sent_at', 'text', 'receiver_ids', 'commitment_id',
                            'not_before_at', 'deadline_at', 'reply_ids'))


def _intent_options(view, issue):
    # List each reference once. Its current permissions come from the same options
    # used by the validator; a ready or expired condition cannot authorize waiting.
    choices = {}
    for field, rows in [('next_step', view['next_options']), ('wait_for', view['wait_options'])]:
        for option in rows:
            if option.get('legacy_alias'):
                continue
            if option.get('requires_issue') and option['requires_issue'] != issue.get('followup_id'):
                continue
            ref = {'kind': option['kind'], 'id': option['id']}
            if field == 'wait_for' and (option.get('available') or
                    issue.get('condition') == 'review_required' and issue.get('wait_for') == ref):
                continue
            key = (ref['kind'], ref['id'])
            row = choices.setdefault(key, {'allowed_for': []})
            row.update(_option_fields(option))
            row['allowed_for'].append(field)
    return list(choices.values())


def _intent_issue(issue):
    if not issue:
        return None
    current = _fields(issue, ('status', 'condition', 'created_at', 'last_reviewed_at', 'next_review_at',
                              'wait_started_at', 'wait_deadline_at', 'elapsed_minutes', 'target_bound_at',
                              'origin_root_outcome_id', 'from_root_outcome_id', 'resolution_evidence_ids'))
    current['id'] = issue.get('followup_id')
    current['original_question'] = issue.get('original_question') or issue.get('question')
    # A bound completion predicate is executor-authored. Keep the entire predicate,
    # including asset, recipient, quantity and method-specific conditions.
    current['bound_target'] = deepcopy(issue.get('completion_target'))
    current['completed_steps'] = [
        {**_fields(step, ('bound_at', 'reviewed_at', 'evidence_ids')), 'target': deepcopy(step.get('target'))}
        for step in issue.get('completed_steps', [])]
    conditions = issue.get('current_conditions') or {}
    current['conditions'] = _fields(conditions, ('assessed_at', 'target_status', 'next_status'))
    for field in ('wait_for', 'next_step'):
        row = conditions.get(field)
        current['conditions'][field] = _option_fields(row) if row else None
    return current


def followup_intent_view(context, identity):
    """The command prompt contains actor-visible observations, not a copy of a stored command."""
    view = context['followup_intent']
    issue = context['continuation'].get('current') or {}
    stored = (issue.get('intent_evidence') or {}).get('unverified_idea')
    historical = stored.get('text') if isinstance(stored, dict) and stored.get('epistemic') == 'unverified' else None
    result = context.get('result') or {}
    facts = (result.get('memory_frame') or {}).get('facts', [])
    return {
        'prompt_version': INTENT_CONTRACT['prompt_version'],
        'self': identity, 'now': context.get('time', context.get('at')),
        'verified_bases': [_fields(basis, ('id', 'kind', 'summary')) for basis in view['bases']],
        'actual_result': {'root': result.get('root_outcome_id'), 'success': result.get('success'),
                          'facts': [_fields(fact, ('id', 'text')) for fact in facts]},
        'current_issue': _intent_issue(issue),
        'previous_unverified_thought': historical,
        'options': _intent_options(view, issue),
        'command_schema': deepcopy(INTENT_CONTRACT['command']),
    }
