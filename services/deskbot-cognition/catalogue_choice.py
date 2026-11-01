"""Select executor-owned opportunities without asking an LLM to copy a command.

The catalogue is constructed from the real world at claim time and independently
checked by Node before execution. Reasons and expectations never create effects.
"""
from copy import deepcopy
from decision_fields import MOTIVATION_PROMPT, validate_motivation
from event_evidence import CONTRACT as EVIDENCE_CONTRACT, validate_obligation

CONTRACT = '''只返回一个完整JSON对象。你根据自己的需要、经历、兴趣和关系选择，不必为了故事进度行动。
有行动时：{act:true,choice_id:choices中的一个id,inner_monologue:20至100字的本人理由,expected_outcome:期望而非事实,issue:{decision:continue|postpone|new|none|resolved|satisfied|abandoned,id:current或给定问题ID或null},motivation:按下方字段合同选择,source_ids:实际影响我的外来输入ID数组}。
不要另外填写动作编号、收件人、正文、物品数量。它们已在所选choice中明确绑定。正文由所选具体沟通目的生成，不从inner_monologue摘抄。
issue.decision=continue/postpone明确保留该问题；已由真实证据完成的小步骤随此选择归档，下一实际活动作为新的待验证步骤。未完成的旧目标保留，不偷偷改标准。completed_steps不是待做清单，不重复拿来实验。
requires_issue的选项只能continue/postpone该问题。current指当前问题；没有问题填none/null。new/none另做一事，原问题暂存；不能把暂缓写成放弃。
resolved只结束已证明的原小目标；satisfied是我觉得了解够了；abandoned是我决定放下。三个结束选择都需原问题id和个人理由，不凭感觉宣布客观成功。
motivation按真实原因选，放在JSON顶层；source_ids也是顶层数组。实际影响选择的输入或本人已核验结果可在source_ids引用其给定ID，程序按已知类型分别绑定外来来源与本人旧事，未知ID拒绝。讨论来信选项必须引用该来信id。消息是听闻，未回复不代表需要或同意。
可以act=false，只返回act和inner_monologue，表示暂不行动，旧事不会自动关闭。格式错误没有发生在世界里，不把修复当作一次遭遇。
已有development证据下仍可选填interest_choice:{topic,decision:continue|pause|drop|revisit,reason,root_ids:给定证据}或wish_choice:{direction_id,decision:consider|propose|defer,reason}。propose须eligible=true。没有明确意愿就省略，不为实验进度强行改变兴趣或角色。
''' + MOTIVATION_PROMPT + EVIDENCE_CONTRACT['obligation_rule']


def bind_catalogue_choice(payload, context, candidates, people):
    p = deepcopy(payload)
    # Lossless structural normalization, never a guessed decision. Some provider
    # responses nest causality under issue. Equal duplicates are equivalent;
    # disagreement remains an error. Preserve the raw response in choice_binding.
    if isinstance(p.get('issue'), dict):
        for key in ('motivation', 'source_ids'):
            if key in p['issue']:
                nested=p['issue'].pop(key)
                if key in p and p[key]!=nested:
                    raise ValueError('issue中的'+key+'与顶层选择冲突')
                p[key]=nested
    allowed = {'act', 'choice_id', 'inner_monologue', 'expected_outcome', 'issue', 'motivation', 'source_ids'}
    if not allowed.issubset(p) or set(p)-allowed-{'interest_choice','wish_choice','obligation_ref'} or p.get('act') is not True:
        raise ValueError('行动JSON只需act/choice_id/inner_monologue/expected_outcome/issue/motivation/source_ids七项')
    validate_motivation(p['motivation'])
    for key in ('inner_monologue', 'expected_outcome'):
        if not isinstance(p[key], str) or not 0 < len(p[key].strip()) <= 160:
            raise ValueError(key + '需1至160字')
    row = next((r for r in context['choice_catalogue']['choices'] if r['id'] == p['choice_id']), None)
    if row is None:
        raise ValueError('choice_id必须逐字选择本轮choices中的id')
    validate_obligation(p,context)
    b = deepcopy(row['binding'])
    citations=p['source_ids']
    if not isinstance(citations,list) or any(not isinstance(s,str) for s in citations):
        raise ValueError('source_ids须为明确的证据ID数组')
    own=set()
    last=context.get('saved',{}).get('last_result') or {}
    if last.get('root_outcome_id'):own.add(last['root_outcome_id'])
    for f in [context['continuation'].get('current'),*context['continuation'].get('deferred',[])]:
        if not f:continue
        own.update(r for r in [f.get('origin_root_outcome_id'),f.get('from_root_outcome_id')] if r)
        own.update(f.get('resolution_evidence_ids',[]))
        for step in f.get('completed_steps',[]):own.update(step.get('evidence_ids',[]))
    external={i['id'] for i in context.get('inputs',[])}
    if any(s not in own|external for s in citations):
        raise ValueError('source_ids包含未知证据，不能根据前缀编造本人的成果')
    own_citations=list(dict.fromkeys(s for s in citations if s in own))
    p['source_ids']=list(dict.fromkeys(s for s in citations if s in external))
    choice = p['issue']
    if not isinstance(choice, dict) or set(choice) != {'decision', 'id'}:
        raise ValueError('issue只填decision和id')
    decision, reference = choice['decision'], choice['id']
    if decision not in ('continue', 'postpone', 'new', 'none', 'resolved', 'satisfied', 'abandoned'):
        raise ValueError('issue.decision不在合同中')
    cont = context['continuation']
    if reference == 'current':
        reference = (cont.get('current') or {}).get('followup_id')
        if reference is None:
            raise ValueError('没有current问题')
    selected = next((f for f in [cont.get('current'), *cont.get('deferred', [])] if f and f['followup_id'] == reference), None)
    if (decision in ('new', 'none') and reference is not None
            or decision not in ('new', 'none') and selected is None):
        raise ValueError('继续/暂缓/结束需要给定问题id；new/none的id为null')
    if row.get('requires_issue') and (decision not in ('continue', 'postpone') or reference != row['requires_issue']):
        raise ValueError('这个实验明确属于requires_issue，须继续/暂缓同一问题')
    closing = decision in ('resolved', 'satisfied', 'abandoned')
    target = (selected or {}).get('completion_target')
    evidence = (selected or {}).get('resolution_evidence_ids', [])
    review = None
    if not closing and decision in ('continue', 'postpone') and target and evidence:
        review = {'target_id': target['id'], 'evidence_ids': deepcopy(evidence),
                  'reason': '本人选择保留同一问题，归档已由实际记录证明的小步骤；' + p['inner_monologue']}
    next_target = target['id'] if target and not review and not closing else None
    if not closing and b['operation'] == 'activity' and not next_target:
        proposed = row.get('step_target_id') or 'activity:' + b['activity_id']
        done = [s['target']['id'] for s in (selected or {}).get('completed_steps', [])]
        if review:
            done.append(review['target_id'])
        if proposed not in done:
            next_target = proposed
    issue = {'followup_decision': 'drop' if closing else decision, 'followup_id': reference,
             'completion_target_id': next_target, 'step_review': review,
             'followup_closure': {'followup_id': reference, 'kind': decision, 'reason': p['inner_monologue'],
                                 'evidence_ids': deepcopy(evidence) if decision == 'resolved' else []} if closing else None}
    operation = b['operation']
    kind = {'activity': 'work', 'observe': 'physical', 'travel': 'move', 'share': 'send_message', 'rest': 'rest'}[operation]
    n = next(i for i, c in enumerate(candidates) if c.action_type.value == kind)
    prior = own_citations[-1] if own_citations else ((context.get('saved', {}).get('last_result') or {}).get('root_outcome_id')
             or (selected or {}).get('from_root_outcome_id') or (selected or {}).get('origin_root_outcome_id')) if p['motivation'] == 'self_continuation' else None
    production = {**b['production_use'], 'reason': p['inner_monologue']} if b.get('production_use') else None
    upstream = {**p, 'selected_index': n, 'action_description': row['title'][:40], 'estimated_steps': 1,
                'issue_choice': issue, 'activity_id': b.get('activity_id'), 'production_use': production}
    compiled = {**issue, 'operation': operation, 'activity_id': b.get('activity_id'), 'title': row['title'][:40],
                'reason': p['inner_monologue'], 'message': '', 'motivation': p['motivation'], 'source_ids': p['source_ids'],
                'prior_root_id': prior, 'own_evidence_ids':own_citations, 'production_use': production, 'interest_choice': deepcopy(p.get('interest_choice')), 'wish_choice': deepcopy(p.get('wish_choice'))}
    if p.get('obligation_ref'):
        compiled['obligation_ref']=deepcopy(p['obligation_ref'])
        compiled['commitment_id']=p['obligation_ref']['commitment_id']
    if operation == 'observe':
        upstream['physical_entity_index'] = compiled['object_index'] = b['object_index']
    elif operation == 'travel':
        upstream['destination_index'] = compiled['destination_index'] = b['destination_index']
    elif operation == 'share':
        receivers = context['capabilities']['share']['receivers']
        ids = [receivers[i-1]['actor_id'] for i in b['receiver_indices']]
        upstream['person_indices'] = [people.index(i)+1 for i in ids]
        upstream['message_content'] = row['title']
        upstream['contact_intent'] = {**b['contact'], 'followup_id': reference, 'source_ids': deepcopy(p['source_ids'])}
        compiled['receiver_indices'] = b['receiver_indices']
        compiled['message_parts'] = [{'kind': 'catalogue', 'choice_id': row['id']}]
        compiled['reply_to'] = b['contact'].get('reply_to')
        compiled['social'] = {'operation': b['contact']['kind'], **{k: v for k, v in b['contact'].items() if k != 'kind'}} if b['contact']['kind'] in ('invite', 'respond') else None
        inputs = {i['id'] for i in context['inputs']}
        if any(s in inputs and s not in p['source_ids'] for s in b['speech_sources']):
            raise ValueError('讨论该来信需在source_ids明确保留其id')
    return upstream, compiled
