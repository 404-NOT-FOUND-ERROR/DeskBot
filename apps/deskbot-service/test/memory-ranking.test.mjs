import test from 'node:test';
import assert from 'node:assert/strict';
import { rankMemoryEpisodes, MEMORY_RECALL_POLICY } from '../src/memory-ranking.mjs';
import { explainLivedMemoryRecall, retrieveLivedMemory, retrieveModelMemory } from '../src/lived-memory.mjs';

const AT = '2026-10-11T04:00:00Z', HOUR = 3600000, actorId = 'shaping-001';
const when = hours => new Date(Date.parse(AT) - hours * HOUR).toISOString();
function episode(id, text, more = {}) {
  return { id: `memory:${id}`, origin_id: `origin:${id}`, actor_ids: [actorId], at: when(1),
    kind: 'world_fact', topic: 'care', outcome: 'completed', location_id: 'garden',
    text, model_safe: true, independent_evidence: true, source: { kind: 'canonical_task' }, ...more };
}
const rank = (episodes, options = {}) => rankMemoryEpisodes(episodes, { actorId, at: AT, ...options });
const world = episodes => ({ protagonist: { character_id: actorId }, updated_at: AT, memory: { episodes } });

test('R/I/R retains explainable factors and retrieves a relevant old memory over unrelated recent routine', () => {
  const episodes = [episode('old', '我修好了苗床边的水泵，水终于流出来了。', { at: when(24 * 5), topic: 'repair' }),
    episode('new', '我在集市喝了茶。', { at: when(0), topic: 'connection' })];
  const result = rank(episodes, { query: '水泵修好', limit: 1 });
  assert.equal(result.selected[0].id, 'memory:old');
  assert.equal(result.policy.weights, MEMORY_RECALL_POLICY.weights);
  const diagnostic = result.diagnostics.find(row => row.memory_id === 'memory:old');
  assert.ok(diagnostic.raw.relevance > 0);
  assert.equal(diagnostic.normalized.relevance, 1);
  assert.ok(diagnostic.score > .7);
  assert.equal(diagnostic.dropped, null);
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /修好了|喝了茶/);
});

test('recent and intrinsically important memories each contribute independently', () => {
  const result = rank([episode('routine', '日常整理', { at: when(400), importance: .1 }),
    episode('important', '共同约定的结果', { at: when(400), importance: .95 }),
    episode('recent', '刚刚的事情', { at: when(0), importance: .1 })]);
  const byId = Object.fromEntries(result.diagnostics.map(row => [row.memory_id, row]));
  assert.ok(byId['memory:important'].score > byId['memory:routine'].score);
  assert.ok(byId['memory:recent'].score > byId['memory:routine'].score);
  assert.equal(byId['memory:important'].raw.decay, 1);
  assert.ok(byId['memory:recent'].raw.recency > byId['memory:routine'].raw.recency);
});

test('MMR suppresses repetitive same-stream descriptions without collapsing contrary outcomes or subjective recollection', () => {
  const episodes = [episode('a', '我照料苗床，叶片舒展开了。'), episode('b', '我照料苗床，叶片舒展开了。'),
    episode('failure', '我照料苗床，叶片舒展开了。', { outcome: 'failed' }),
    episode('feeling', '我照料苗床，叶片舒展开了。', { kind: 'personal_interpretation', independent_evidence: false, evidence_ids: ['memory:a'] }),
    episode('other', '我去溪边捡了一块蓝石头。', { topic: 'explore', location_id: 'creek' })];
  const before = structuredClone(episodes), result = rank(episodes);
  assert.equal(result.selected.filter(row => ['memory:a', 'memory:b'].includes(row.id)).length, 1);
  assert.ok(result.selected.some(row => row.id === 'memory:failure'));
  assert.ok(result.selected.some(row => row.id === 'memory:feeling' && row.memory_stream === 'experiential'));
  assert.equal(result.diagnostics.filter(row => row.dropped === 'mmr_duplicate').length, 1);
  assert.deepEqual(episodes, before);
  assert.equal(episodes.length, 5);
});

test('task and project views bind to one actual outcome; memory and interpretation links remain distinct', () => {
  const result = rank([episode('task', '一盆汤煮好了。', { source: { kind: 'canonical_task', task_id: 'actual-soup' } }),
    episode('project', '招牌菜的第一次试做完成。', { source: { kind: 'resident_project', task_id: 'actual-soup', project_id: 'soup' } }),
    episode('feeling', '我想下次再试一点蘑菇。', { kind: 'personal_interpretation', evidence_ids: ['memory:task', 'invented'], source: { kind: 'model_choice' } })]);
  assert.equal(result.selected.filter(row => row.memory_stream === 'factual').length, 1);
  assert.equal(result.selected.find(row => row.memory_stream === 'factual').event_anchor, 'task:actual-soup:completed');
  assert.deepEqual(result.selected.find(row => row.memory_stream === 'experiential').linked_memory_ids, ['memory:task']);
  assert.equal(result.selected.find(row => row.memory_stream === 'experiential').event_anchor, 'task:actual-soup:completed');
  assert.equal(result.selected.find(row => row.memory_stream === 'experiential').factual_sources[0].id, 'memory:task');
  assert.equal(result.diagnostics.find(row => row.memory_id === 'memory:task').duplicate_of, 'memory:project');
});

test('future, invalid and another actor memories are excluded; old reports decay but remain historical', () => {
  const result = rank([episode('future', '明天已发生', { at: when(-24) }), episode('invalid', '坏时间', { at: 'invalid' }),
    episode('other', '旁人的事', { actor_ids: ['npc'] }),
    episode('old-news', '从报纸上听说下雨了', { kind: 'hearsay', at: when(24 * 30), expires_at: when(24 * 29) }),
    episode('now', '刚回到家', { topic: null })]);
  assert.deepEqual(result.selected.map(row => row.id), ['memory:now', 'memory:old-news']);
  assert.equal(result.selected[1].expired, true);
  assert.equal(result.selected[1].memory_stream, 'reported');
  assert.equal(result.diagnostics.find(row => row.memory_id === 'memory:future').dropped, 'future');
  assert.equal(result.diagnostics.find(row => row.memory_id === 'memory:invalid').dropped, 'invalid_time');
  assert.ok(result.diagnostics.find(row => row.memory_id === 'memory:old-news').score < .01);
  assert.equal(rank([], { at: 'invalid' }).selected.length, 0);
});

test('model recall ranks its sanitized representation and never sends private roots or hidden memory links', () => {
  const episodes = [episode('private', '私人日记：北京电话', { model_safe: false }),
    episode('safe-a', '私人北京电话', { model_text: '镇内照料：完成。', source: { kind: 'canonical_task', task_id: 'private-task-id' } }),
    episode('safe-b', '无关的原文', { model_text: '镇内修缮：完成。', topic: 'repair' }),
    episode('feeling', '还想做点事', { kind: 'personal_interpretation', evidence_ids: ['memory:private', 'memory:safe-a'] })];
  const w = world(episodes), before = structuredClone(w);
  const result = retrieveModelMemory(w, { query: '私人北京电话', limit: 8 });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /私人|北京|电话|private-task-id/);
  assert.equal(result.some(row => row.text.includes('私人')), false);
  const feeling=result.find(row=>row.kind==='personal_interpretation');
  const factual=result.find(row=>row.text==='镇内照料：完成。');
  assert.deepEqual(feeling.linked_memory_ids, [factual.id]);
  assert.deepEqual(feeling.evidence_ids, [factual.id]);
  assert.equal(feeling.factual_sources[0].id,factual.id);
  const local = explainLivedMemoryRecall(w, { query: '私人北京电话' });
  assert.ok(local.diagnostics.some(row => row.raw.relevance > 0));
  assert.equal(retrieveModelMemory(w, { query: '私人北京电话', limit: 1 })[0].id,
    retrieveModelMemory(w, { query: '不可匹配的内容', limit: 1 })[0].id);
  assert.deepEqual(w, before);
});

test('small recall limits retain grounded subjective sources and reserve a factual anchor against report saturation', () => {
  const fact=episode('root','水泵修好了。',{at:when(100),topic:'repair'});
  const feeling=episode('feeling','我还想亲手试一次修缮。',{kind:'personal_interpretation',topic:'repair',at:when(0),evidence_ids:[fact.id]});
  const pair=rank([fact,feeling],{query:'亲手试一次修缮',limit:1});
  assert.equal(pair.selected.length,1);
  assert.equal(pair.selected[0].kind,'personal_interpretation');
  assert.equal(pair.selected[0].factual_sources.length,1);
  assert.equal(pair.selected[0].factual_sources[0].id,fact.id);
  assert.equal(pair.selected[0].event_anchor,pair.selected[0].factual_sources[0].event_anchor);
  const reports=Array.from({length:4},(_,i)=>episode(`report-${i}`,`新闻报道第${i}件生活动静`,{
    kind:'hearsay',at:when(i),topic:null,outcome:'received',source:{kind:'external'}}));
  const result=rank([fact,...reports],{query:'新闻报道生活动静',limit:2});
  assert.equal(result.selected.length,2);
  assert.ok(result.selected.some(row=>row.kind==='world_fact'));
  assert.ok(result.diagnostics.some(row=>row.dropped==='factual_anchor_reserved'));
});

test('model projection makes custom source ids opaque and cannot leak hidden source or reference metadata', () => {
  const root=episode('secret-id@example.org','安全的模型表述',{source:{kind:'private-source-label',task_id:'secret-task'},topic:'private-topic',
    evidence_ids:['secret-reference'],model_text:'镇内修缮：完成。'});
  const result=retrieveModelMemory(world([root]),{limit:1});
  assert.match(result[0].id,/^memory:[a-f0-9]{24}$/);
  assert.equal(result[0].source_kind,'other');
  assert.equal(result[0].topic,null);
  assert.deepEqual(result[0].evidence_ids,[]);
  assert.doesNotMatch(JSON.stringify(result),/secret|private|example/);
});

test('recall is stable across restart, read retries and limit variations without strengthening evidence', () => {
  const w = world([episode('a', '苔芽开始发亮'), episode('b', '我和邻居一起煮汤', { topic: 'cook' })]);
  const before = structuredClone(w), first = retrieveLivedMemory(w, { query: '苔芽' });
  for (let i = 0; i < 20; i++) assert.deepEqual(retrieveLivedMemory(w, { query: '苔芽' }), first);
  assert.deepEqual(retrieveLivedMemory(JSON.parse(JSON.stringify(w)), { query: '苔芽' }), first);
  assert.deepEqual(w, before);
  assert.deepEqual(retrieveLivedMemory(w, { limit: 0 }), []);
  assert.equal(retrieveLivedMemory(w, { limit: NaN }).length, 2);
});
