"""One actor choice, deterministic binding, no second model acting as a compiler.

Shorthands below refer to explicit selections (current issue, chosen method,
verified completed step). They never infer a method or purpose from prose.
Legacy recorded contexts retain the old adapter in life_worker.
"""
from copy import deepcopy
from decision_fields import MOTIVATION_PROMPT, validate_motivation


CONTRACT = '''只返回一个完整 JSON 对象。只作一次完整选择，程序会直接绑定并执行，不再有第二个模型替你编译。
act=true返回{act:true,selected_index,inner_monologue,action_description,expected_outcome,issue_choice,motivation,source_ids,prior_root_id}。
inner_monologue是20至100字的生活理由，action_description最多40字；期望不等于结果。motivation按下方字段合同选择。
source_ids只填实际影响选择的received_inputs编号；自己的任务结果只放prior_root_id，无则null。不能把每次选择都标成自主。
issue_choice:{followup_decision:continue|postpone|new|none|drop,followup_id:"current"或deferred中的问题ID或null,completion_target_id:"selected_activity"或给定目标ID或null,step_review:null或{reason:为什么已完成这一步但研究继续},followup_closure:null或{kind:resolved|satisfied|abandoned,reason:为何收束}}。
current精确绑定当前问题。selected_activity明确选择验证这次选定活动；不等于自动成功。开放研究可不设完成目标。
已有未完成目标不能偷换；有resolution_evidence_ids时可明确step_review，程序保存原目标与原证据，再选下一步。已完成不必一直研究，也不必马上结案。
resolved只说明事前小目标已由原证据完成；satisfied表示个人已了解够了；abandoned表示放下。结案用drop，程序只引用所选问题已有证据，不让你重复抄编号。
WORK必须另填activity_id（给定活动ID），PHYSICAL只观察时填physical_entity_index（现场object_index），若实际做活动则填activity_id。不从文字猜方法。
有output的活动另填production_purpose:{kind:reserve|self_use|accepted_delivery|experiment,reason:实际用途}。
reserve可加target_stock（总备用量，最多一批），不加表示明确选择给定reserve_limit；self_use另填reference_id=uses消耗活动；accepted_delivery另填reference_id=已接受约定。数量由相应条目精确绑定。
experiment只用于当前明确选择的问题和selected_activity步骤；程序绑定问题ID与一批产量，不再抄两套活动/事项编号。已完成的实验不可借名再生产。非生产不填production_purpose。没有本地用途不代表世界无处可用。
SEND_MESSAGE另填person_indices（可联系人的编号）、contact:{kind:message|reply|invite|respond}、message_parts。联系自动沿用这一次issue_choice和source_ids。reply另填reply_to；invite另填option_id；respond另填commitment_id、response，delay另填delay_minutes(15至240)。正式邀请/回应必须恰好一人。
message_parts推荐放在JSON顶层，与contact并列；也接受仅放在contact内的同一份正文。两处同时填写必须完全一致，程序不会合并不同意思或替你改写正文。
message_parts最多3段：事实用{kind:evidence,evidence_id:给定speech_evidence编号}，程序传递完整原文；其余{kind:question|hypothesis|intention|greeting,text:最多160字}。自由文字不声称已完成/证实/答应。问候直接用你好/谢谢你/回头见/早上好/晚上好；正式约定附言不另写时间，条款时间由程序表达。
MOVE另填destination_index，REST不填对象；estimated_steps由实际执行器确定。不能强制带人、凭话语交接、假装已抵达。无需selected_index以外的基础动作类型字段。
可选interest_choice:{topic,decision:continue|pause|drop|revisit,reason,root_ids:给定证据}与wish_choice:{direction_id,decision:consider|propose|defer,reason}；没有自己的明确意愿就null，propose仅eligible为true可用，不强行换角色。
act=false只表示此刻不行动，返回inner_monologue和act即可，不自动关闭旧事。格式错误未在世界发生，不写成他人阻拦或一次生活经历。
''' + MOTIVATION_PROMPT


def bind_choice(payload, context, candidates, people):
    """Return canonical execution fields; reject ambiguity instead of guessing."""
    p = deepcopy(payload)
    def reject(message):
        raise ValueError(message)
    allowed = {'act','selected_index','inner_monologue','action_description','expected_outcome','issue_choice',
        'motivation','source_ids','prior_root_id','activity_id','production_purpose','physical_entity_index',
        'destination_index','person_indices','contact','message_parts','urgency','interest_choice','wish_choice','estimated_steps'}
    if set(p) - allowed:
        reject('只返回本次选择字段，不重复编译或添设动作：' + ','.join(sorted(set(p) - allowed)))
    def index(value, rows, name):
        if type(value) is not int or not 1 <= value <= len(rows):
            reject(name + '必须使用本轮给定编号')
        return rows[value - 1]
    n = p.get('selected_index')
    if type(n) is not int or not 0 <= n < len(candidates):
        reject('selected_index必须是action_menu编号')
    kind = candidates[n].action_type.value
    method = p.get('activity_id')
    if kind == 'work' and not method:
        reject('WORK缺少activity_id；不能从描述或目标猜活动')
    if method is not None and (kind not in ('work', 'physical') or not any(a['activity_id'] == method for a in context['capabilities']['activities'])):
        reject('activity_id必须是给定的WORK/PHYSICAL方法')
    forbidden = ('operation', 'production_use', 'contact_intent', 'followup_id', 'followup_decision',
                 'receiver_indices', 'activity_index', 'social', 'reply_to', 'message_content',
                 'physical_person_index', 'physical_npc_index', 'physical_recipient_index', 'move_carry_indices', 'message_announce')
    if any(k in p and p[k] is not None for k in forbidden):
        reject('不要重复输出编译字段或未开放动作：' + ','.join(k for k in forbidden if k in p and p[k] is not None))
    issue = p.get('issue_choice')
    if not isinstance(issue, dict):
        reject('缺少issue_choice；自主选择继续/暂缓/另做一事或放下')
    cont = context.get('continuation') or {}
    if issue.get('followup_id') == 'current':
        if not cont.get('current'):
            reject('当前没有问题，不能引用current')
        issue['followup_id'] = cont['current']['followup_id']
    selected = next((f for f in [cont.get('current'), *cont.get('deferred', [])] if f and f['followup_id'] == issue.get('followup_id')), None)
    if issue.get('completion_target_id') == 'selected_activity':
        if not method:
            reject('selected_activity必须有明确的activity_id')
        issue['completion_target_id'] = 'activity:' + method
        if (context.get('use_context', {}).get('experiment_rule') == 'method-conditions-v2'
            and (p.get('production_purpose') or {}).get('kind') == 'experiment'):
            producer = next((a for a in context['use_context']['production'] if a['activity_id'] == method), {})
            issue['completion_target_id'] = (producer.get('experiment') or {}).get('completion_target_id')
    review = issue.get('step_review')
    if review is not None:
        if not isinstance(review, dict) or set(review) != {'reason'} or not selected or not selected.get('completion_target') or not selected.get('resolution_evidence_ids'):
            reject('step_review仅填reason；所选问题必须已有实际小目标完成证据')
        issue['step_review'] = {**review, 'target_id': selected['completion_target']['id'], 'evidence_ids': deepcopy(selected['resolution_evidence_ids'])}
    closure = issue.get('followup_closure')
    if closure is not None:
        if not isinstance(closure, dict) or set(closure) != {'kind', 'reason'} or not selected:
            reject('followup_closure仅填kind/reason，须明确选择本人问题')
        issue['followup_closure'] = {**closure, 'followup_id': selected['followup_id'],
            'evidence_ids': deepcopy(selected.get('resolution_evidence_ids', [])) if closure['kind'] == 'resolved' else []}
    for field in ('inner_monologue', 'action_description', 'expected_outcome'):
        if not isinstance(p.get(field), str) or not p[field].strip():
            reject(field + '必须明确填写')
    if len(p['inner_monologue']) > 160 or len(p['action_description']) > 40:
        reject('选择理由最多160字，action_description最多40字')
    if any(k not in p for k in ('motivation', 'source_ids', 'prior_root_id')):
        reject('缺少motivation/source_ids/prior_root_id；没有引用也要明确[]/null')
    validate_motivation(p['motivation'])
    compiled = {**deepcopy(issue), 'operation': 'activity' if method else {'physical': 'observe', 'move': 'travel', 'send_message': 'share', 'rest': 'rest'}[kind],
        'activity_id': method, 'title': p['action_description'], 'reason': p['inner_monologue'], 'message': '',
        **{k: deepcopy(p[k]) for k in ('motivation', 'source_ids', 'prior_root_id')},
        'interest_choice': deepcopy(p.get('interest_choice')), 'wish_choice': deepcopy(p.get('wish_choice'))}
    if compiled['operation'] == 'observe':
        index(p.get('physical_entity_index'), context.get('objects', []), 'physical_entity_index')
        compiled['object_index'] = p['physical_entity_index']
    if compiled['operation'] == 'travel':
        index(p.get('destination_index'), context['capabilities']['travel']['destinations'], 'destination_index')
        compiled['destination_index'] = p['destination_index']
    producer = next((a for a in context.get('use_context', {}).get('production', []) if a['activity_id'] == method), None)
    purpose = p.get('production_purpose')
    if not producer and purpose is not None:
        reject('非生产动作不填production_purpose')
    if producer:
        if not isinstance(purpose, dict) or set(purpose) - {'kind', 'reason', 'reference_id', 'target_stock'}:
            reject('生产需production_purpose:{kind,reason}，自用/交付另填reference_id，备用可填target_stock')
        purpose_kind = purpose.get('kind')
        ref, count = purpose.get('reference_id'), purpose.get('target_stock')
        if purpose_kind == 'experiment':
            if ref is not None or count is not None:
                reject('experiment的事项和一批产量由本次选择绑定，不重复填reference_id/target_stock')
            ref, count = issue.get('followup_id'), producer['already_held'] + producer['output_count']
        elif purpose_kind == 'reserve':
            if count is None:
                count = producer['reserve_limit']
        elif purpose_kind in ('self_use', 'accepted_delivery'):
            key = 'activity_id' if purpose_kind == 'self_use' else 'commitment_id'
            rows = producer['uses'] if purpose_kind == 'self_use' else producer['accepted_outgoing']
            match = next((r for r in rows if r[key] == ref), None)
            if not match:
                reject('用途reference_id不在当前给定消耗/已接受约定中；本地无用途不等于世界无用途')
            if count is not None and count != match['count']:
                reject('用途数量不能与给定实际需要冲突')
            count = match['count']
        p['production_use'] = {'activity_id': method, 'kind': purpose_kind, 'reason': purpose.get('reason'), 'reference_id': ref, 'target_stock': count}
    else:
        p['production_use'] = None
    compiled['production_use'] = deepcopy(p['production_use'])
    contact = p.get('contact')
    if kind == 'send_message':
        indices = p.get('person_indices')
        if not isinstance(indices, list) or not indices or len(set(indices)) != len(indices):
            reject('person_indices须明确选择不重复的收件人')
        receiver_ids = [index(i, people, 'person_indices') for i in indices]
        allowed = [r['actor_id'] for r in context['capabilities']['share']['receivers']]
        if any(r not in allowed for r in receiver_ids):
            reject('只能联系本轮contactable=true的人，不丢弃非法编号后继续发送')
        if not isinstance(contact, dict):
            reject('contact必须是联系方式对象')
        # A body at either documented path means the same explicit choice. Move
        # it without paraphrase; conflicting duplicates must never be resolved
        # by silently preferring one text. All speech/recipient checks follow.
        if 'message_parts' in contact:
            nested = contact.pop('message_parts')
            if 'message_parts' in p and p['message_parts'] != nested:
                reject('contact.message_parts与顶层message_parts冲突；只保留本人选定的一份完整正文')
            p['message_parts'] = nested
        extra = set(contact) - {'kind', 'reply_to', 'option_id', 'commitment_id', 'response', 'delay_minutes'}
        if extra:
            reject('contact含未支持字段：' + ','.join(sorted(extra)) + '；不重复填写事项/来源')
        p['contact_intent'] = {**contact, 'followup_id': issue.get('followup_id'), 'source_ids': deepcopy(p['source_ids'])}
        compiled['receiver_indices'] = [allowed.index(r) + 1 for r in receiver_ids]
        compiled['message_parts'] = deepcopy(p.get('message_parts'))
        compiled['reply_to'] = contact.get('reply_to') if contact['kind'] == 'reply' else None
        compiled['social'] = ({'operation': contact['kind'], **{k: deepcopy(v) for k, v in contact.items() if k != 'kind'}}
            if contact['kind'] in ('invite', 'respond') else None)
        # Upstream's intent text is not a delivery. Actual speech is assembled by
        # the authoritative executor from compiled.message_parts and evidence.
        p['message_content'] = p['action_description']
    elif contact is not None or p.get('message_parts') or p.get('person_indices'):
        reject('非递话动作不填写contact/message_parts/person_indices')
    p['estimated_steps'] = 1
    return p, compiled
