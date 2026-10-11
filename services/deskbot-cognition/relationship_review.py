"""Owner-only Asamana relation review in a temporary store, producing impressions.

Shared bonds and objective trust are never modified; vendored upstream is unchanged.
"""
from types import SimpleNamespace
import json
from agent.relation_evolution import RelationEvolution
from agent.relation import RelationSystem
from core.interfaces.agent_store import AgentRelation
from providers.agent_store.in_memory import InMemoryAgentStore


class EvidenceMemory:
    def __init__(self, evidence, step):
        self.evidence = evidence
        self.step = step

    def collect_recent_related_agents(self, **kwargs):
        return [e['actor_id'] for e in self.evidence]

    def list_recent_memories_mentioning(self, target_id, **kwargs):
        entry = next(e for e in self.evidence if e['actor_id'] == target_id)
        return [SimpleNamespace(id=s['id'], step=self.step, stored_content=s['text'], raw_content=s['text']) for s in entry['sources']]


class PersonalRelationEvolution(RelationEvolution):
    def _build_prompt(self, contexts):
        system = ('你只整理此角色对别人的私人印象。事实是实际发送/收到的话或共同事务结果；话里说的内容未必属实。'
                  '不推断对方私密记忆，不宣称双方确立关系，不修改信任数值。多数印象可保持原样。'
                  '返回JSON {updates:[{target_index:1起编号,labels:最多3个,summary:最多180字,rationale:简短依据}]}。'
                  'labels只能选择想合作、想多了解、暂时保留、熟悉、不确定。不得输出配偶、师徒、亲属或其他身份标签。')
        user = {'name': self._personality.soul.name, 'targets': [
            {'target_index': i, 'name': c.target_name, 'prior_labels': c.relation.labels,
             'prior_summary': c.relation.history_summary,
             'actual_own_sources': [m.stored_content for m in c.recent_memories]}
            for i, c in enumerate(contexts, 1)]}
        return system, json.dumps(user, ensure_ascii=False)


async def review_relationships(context, router, personality, step):
    evidence = context.get('social', {}).get('relation_evidence', [])
    prior = {v['actor_id']: v for v in context.get('social', {}).get('personal_views', [])}
    evidence = [e for e in evidence if set(s['id'] for s in e['sources']) - set(prior.get(e['actor_id'], {}).get('source_ids', []))]
    if not evidence:
        return []
    store = InMemoryAgentStore()
    for e in evidence:
        old = prior.get(e['actor_id'], {})
        await store.save_relation(AgentRelation(world_id=context['world_id'], from_id=context['actor']['actor_id'],
            to_id=e['actor_id'], to_name=e['name'], trust_objective=0.5, affection_objective=0.0,
            updated_step=step, interaction_count=len(e['sources']), labels=old.get('labels', []), history_summary=old.get('summary', '')))
    system = RelationSystem(store, world_id=context['world_id'], agent_id=context['actor']['actor_id'])
    engine = PersonalRelationEvolution(router, EvidenceMemory(evidence, step), system, personality, agent_id=context['actor']['actor_id'])
    updates = await engine.evaluate(step)
    return [{'actor_id': target, 'labels': labels, 'summary': summary,
             'source_ids': [s['id'] for e in evidence if e['actor_id'] == target for s in e['sources']]}
            for target, labels, summary in updates]
