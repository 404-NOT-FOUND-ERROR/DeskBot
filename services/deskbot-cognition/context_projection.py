"""Lossless field selection per cognition stage; never rewrite canonical facts.

Identity remains in Asamana's personality layer. Execution uses the full frozen
context, irrespective of this prompt-only projection.
"""
from copy import deepcopy
from followup_phases import FEEDBACK_PROMPT

BODY_BOUNDARY = ('现实身体无摄像头、不能走动，仅屏幕、声音、触摸、单轴转头。虚拟化身可以按实际任务行走。'
                 '只知道给定现场和自己的记录；留言是听闻，想法不是事实。库存、承诺、身份改变均由执行器核验。'
                 'UTC与上海时间是同一时刻的不同表示，不混用。')


def goal_lifecycle_view(context):
    """The prompt needs current criteria and proof, not duplicated attempt logs."""
    raw=context.get('goal_lifecycle', {})
    fields=('goal_id','text','completion_criteria','lifecycle_status','evidence_ids','next_review_at','review_due','method_status','completion_status')
    view={k:deepcopy(v) for k,v in raw.items() if k!='goals'}
    view['goals']=[{k:deepcopy(g[k]) for k in fields if k in g} for g in raw.get('goals', [])]
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
    common = ('time', 'inventory', 'continuation', 'grounding', 'use_context', 'goal_opportunities', 'goal_lifecycle', 'event_evidence')
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
    if 'continuation' in result:
        result['continuation'] = continuation_view(context)
    if stage not in ('decision', 'motivation', 'plan', ''):
        continuation = result.get('continuation', {})
        continuation.pop('completion_targets', None)
        continuation.pop('next_options', None)
        # Existing bound criteria/evidence, pending conditions and deferred issues stay.
    return result
