"""Communication intent chosen by the actor before compilation; no world writes."""
from copy import deepcopy


def contact_readiness(context):
    social=context.get('social',{})
    result=[]
    for old in social.get('unanswered_issues',[]):
        basis=next((b for b in social.get('issue_bases',[]) if b['followup_id']==old['followup_id']),social.get('contact_basis',{}))
        evidence=sorted(set(basis.get('evidence_ids',[])).difference(old.get('evidence_ids',[])))
        sources=sorted(set(basis.get('related_source_ids',[])).difference(old.get('input_ids',[])))
        result.append({'followup_id':old['followup_id'],'receiver_ids':old['receiver_ids'],
            'unanswered_message_id':old['message_id'] if 'message_id' in old else None,
            'plain_message_available':bool(evidence or sources),'new_evidence_ids':evidence,'new_source_ids_requiring_citation':sources})
    return result


CONTACT_CONTRACT = '''选择 SEND_MESSAGE 时，必须额外返回 contact_intent 对象；其他动作填 null。
基本字段 {kind:message|reply|invite|respond, followup_id:current/deferred 中本次关联的问题ID或无事项时null, source_ids:实际影响此选择的外来输入ID数组}。
message 是普通留言；没有关联新依据的同一事项不能改称当面/缩减收件人重问，时间流逝、我着急了不算新依据。
reply 还需 reply_to:已收到消息ID。invite 还需 option_id:social.options的精确ID；respond 还需 commitment_id、response:accept|decline|delay|withdraw，delay另需delay_minutes（15至240）。
invite/respond 必须由我自己选恰好一人，在 person_indices 指定。库存充足只表示可以商量，不表示对方需要、接受或已交付。
我的选择会原样约束编译器：它不能把普通问话改成邀请，不能替我挑选接收者或改约定。
有当前事项时请明确关联 current/deferred 的一个ID；想离开这个问题可以先自己行动、暂缓、休息或探索。不要为了通过校验改写旧问题的身份。
source_ids 不放自己的 task/sent/observation 记录；没有实际外来输入填[]。能看到的人不一定是当前可联系的人，以 capabilities.share.receivers 为准。
'''


def contact_intent_errors(choice, receiver_ids, context):
    if not isinstance(choice,dict):return ['SEND_MESSAGE缺少contact_intent对象']
    kind=choice.get('kind')
    if kind not in ('message','reply','invite','respond'):return ['contact_intent.kind无效']
    if not receiver_ids or len(set(receiver_ids))!=len(receiver_ids):return ['联系对象必须明确且不重复']
    receivers=context.get('capabilities',{}).get('share',{}).get('receivers',[])
    allowed=[r['actor_id'] for r in receivers]
    if any(r not in allowed for r in receiver_ids):return ['对象不在当前可联系名单中；看见不等于可联系']
    continuation=context.get('continuation',{})
    issues=[f for f in [continuation.get('current'),*continuation.get('deferred',[])] if f]
    issue=choice.get('followup_id')
    if 'followup_id' not in choice or (issues and issue not in [f['followup_id'] for f in issues]) or (not issues and issue is not None):
        return ['contact_intent.followup_id须绑定给定事项；没有事项才为null']
    sources=choice.get('source_ids')
    if not isinstance(sources,list) or any(not isinstance(s,str) or s not in {i['id'] for i in context.get('inputs',[])} for s in sources):
        return ['contact_intent.source_ids只含外来输入ID，无则[]']
    social=context.get('social',{})
    if kind=='message':
        return social_contact_errors({'operation':'share','followup_id':issue,'source_ids':sources,
            'receiver_indices':[allowed.index(r)+1 for r in receiver_ids]},context)
    if kind=='reply':
        reply=next((r for r in social.get('replies',[]) if r['message_id']==choice.get('reply_to')),None)
        if not reply or receiver_ids!=[reply['sender_id']]:return ['reply须回复给定消息的实际发送者']
        if any(m.get('reply_to')==reply['message_id'] for m in context.get('saved',{}).get('outbox',[])):return ['此条消息已实际回复过']
    else:
        if len(receiver_ids)!=1:return ['invite/respond只接受一个收件人；自己选择，不自动拆分物品或改成群发']
        if kind=='invite':
            if not any(o['option_id']==choice.get('option_id') for o in social.get('options',[])):return ['invite的option_id不在可选约定中']
            if any(v['option_id']==choice['option_id'] and v['receiver_id']==receiver_ids[0] and not v['available'] for v in social.get('invitation_availability',[])):
                return ['当前约定占用或冷却尚未结束，不能另发这份邀请；先回应已有约定或做别的事']
        else:
            c=next((c for c in social.get('commitments',[]) if c['id']==choice.get('commitment_id')),None)
            if not c or receiver_ids[0] not in c['actors'] or choice.get('response') not in c.get('available_responses',[]):return ['respond须指向本人的约定、对方和可用回应']
            if choice['response']=='delay' and (type(choice.get('delay_minutes')) is not int or not 15<=choice['delay_minutes']<=240):return ['延期必须15至240整数分钟']
    return []


def bind_contact_intent(choice, receiver_ids):
    keys=('kind','followup_id','source_ids')+({'reply':('reply_to',),'invite':('option_id',),
        'respond':('commitment_id','response','delay_minutes')}.get(choice['kind'],()))
    return {**{k:deepcopy(choice[k]) for k in keys if k in choice},'receiver_ids':list(receiver_ids)}


def compiled_contact_errors(value, context, choice):
    if choice is None:return ['此轮没有选择联系；编译器不能新增share'] if value.get('operation')=='share' else []
    if value.get('operation')!='share':return ['编译器不能替换本人已经选定的联系动作']
    receivers=context.get('capabilities',{}).get('share',{}).get('receivers',[])
    indices=value.get('receiver_indices',[])
    if not isinstance(indices,list):return ['receiver_indices必须为数组，保留已选对象']
    ids=[receivers[n-1]['actor_id'] for n in indices if type(n) is int and 0<n<=len(receivers)]
    if len(ids)!=len(indices) or sorted(ids)!=sorted(choice['receiver_ids']):return ['receiver_indices必须对应decision_contact.receiver_ids，不可增减对象']
    sources=value.get('source_ids')
    if not isinstance(sources,list) or any(not isinstance(s,str) for s in sources):return ['source_ids必须为原外来输入ID数组']
    if value.get('followup_id')!=choice.get('followup_id') or sorted(sources)!=sorted(choice.get('source_ids',[])):
        return ['followup_id/source_ids须保持decision_contact的原选择']
    social=value.get('social') or {}
    if not isinstance(social,dict):return ['social必须是约定对象或null']
    if choice['kind']=='invite':
        if social.get('operation')!='invite' or social.get('option_id')!=choice.get('option_id'):return ['保留本人选定的invite与option_id']
    elif choice['kind']=='respond':
        if social.get('operation')!='respond' or any(social.get(k)!=choice.get(k) for k in ('commitment_id','response')) or (choice['response']=='delay' and social.get('delay_minutes')!=choice.get('delay_minutes')):
            return ['保留本人选定的respond条款']
    elif social:return ['普通留言/回复不能被编译成正式约定']
    if (value.get('reply_to') or None)!=(choice.get('reply_to') if choice['kind']=='reply' else None):return ['reply_to必须保持原回复选择']
    return []


def social_contact_errors(value,context):
    if value.get('operation')!='share' or value.get('reply_to') or value.get('social'): return []
    social=context.get('social',{})
    current=context.get('continuation',{}).get('current') or {}
    issue=value.get('followup_id') or current.get('followup_id')
    if not issue: return []
    receivers=context.get('capabilities',{}).get('share',{}).get('receivers',[])
    peers={receivers[n-1]['actor_id'] for n in value.get('receiver_indices',[]) if type(n) is int and 0<n<=len(receivers)}
    basis=next((b for b in social.get('issue_bases',[]) if b['followup_id']==issue),social.get('contact_basis',{}))
    for old in social.get('unanswered_issues',[]):
        if basis.get('schema')=='deskbot.issue-contact.v1':
            novel=bool(set(basis.get('evidence_ids',[])).difference(old.get('evidence_ids',[])) or
                set(value.get('source_ids',[])).intersection(basis.get('related_source_ids',[])).difference(old.get('input_ids',[])))
        else:
            novel=old.get('substantive_root')!=basis.get('substantive_root') or bool(set(value.get('source_ids',[])).difference(old.get('input_ids',[])))
        if old.get('followup_id')==issue and peers.intersection(old.get('receiver_ids',[])) and not novel:
            return ['同一问题尚无关联回复或相关新依据。无关走动/消息不算新进展；不要换措辞、缩减收件人重问。可实际行动或暂缓；若本人确实愿意提出有条款的正式约定，必须自己选一个收件人，receiver_indices只能有一个编号，不能向两人发同一份物品。']
    return []

