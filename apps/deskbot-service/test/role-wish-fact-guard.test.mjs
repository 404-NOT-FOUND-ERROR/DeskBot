import assert from 'node:assert/strict';
import test from 'node:test';
import { guardRoleWishFacts } from '../src/role-wish-fact-guard.mjs';
import { roleWishReadModel } from '../src/role-wishes.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { OWNER, WISH_AT, readyWishWorld } from './support/role-wish-fixture.mjs';

function fixture(directionId = 'wetland_frog', choice = null) {
  const world = readyWishWorld({ chef: true });
  const direction = roleWishReadModel(world).directions.find(item => item.direction_id === directionId);
  const store = createRoleProposalStore({ now: () => new Date(WISH_AT) });
  const proposal = store.propose(null, { characterId: OWNER, proposalId: `saved-${directionId}`, livedWish: direction });
  if (choice) store.choose(proposal.proposal_id, choice);
  return { world, store, proposal: store.get(proposal.proposal_id), roleWishes: store.list() };
}
function render(f, userText, text = 'RAW 我看着低湿的土，蹬腿跳进水里，已经完成青蛙试用。', extra = {}) {
  return guardRoleWishFacts({ userText, text, worldSnapshot: f.world, actorId: OWNER, roleWishes: f.roleWishes, ...extra });
}

test('explicit saved-wish reason and form status use frozen actual basis rather than model scenery', () => {
  const f = fixture(), before = structuredClone({ world: f.world, wishes: f.roleWishes });
  const result = render(f, '你为什么想试试青蛙？既然想好了，那你现在已经变成青蛙了吗？');
  assert.equal(result.applied, true); assert.equal(result.direction, 'wetland_frog'); assert.equal(result.reason, 'canonical_saved_wish_reason');
  assert.match(result.text, /自己持续关注苗圃/); assert.match(result.text, /不同日子完成过/); assert.match(result.text, /给苗床浇水|整理和照料苗木/);
  assert.match(result.text, /还没开始实际试做/); assert.doesNotMatch(result.text, /RAW|低湿|土|蹬腿|跳|踩|手感|水凉|水岸/);
  assert.deepEqual({ world: f.world, wishes: f.roleWishes }, before);
});

test('prepared is agreement to prepare, without inventing a trial, appearance or bodily ability', () => {
  const f = fixture('wetland_frog', 'try');
  const result = render(f, '我同意了，你现在是不是已经完成试用、可以变成青蛙了？');
  assert.equal(result.applied, true); assert.equal(result.reason, 'canonical_saved_wish_status');
  assert.match(result.text, /同意的是一起准备/); assert.match(result.text, /还没有完成/); assert.match(result.text, /没有因此改变形象/);
  assert.doesNotMatch(result.text, /蹲|蹦|腿|脚|看着|试用通过|已经变成|镜头|摄像头/);
  assert.equal(f.store.get(f.proposal.proposal_id).status, 'prepared'); assert.equal(f.store.get(f.proposal.proposal_id).trial, undefined);
});

test('owner later and reject produce finite respectful responses without made-up next tasks', () => {
  for (const choice of ['later', 'reject']) {
    const f = fixture('chef', choice);
    const result = render(f, '先不考虑厨师吧。你接下来会怎么安排，还会一直催我答应吗？', '我现在要去暖锅院把配方记稳，然后去苗圃。');
    assert.equal(result.applied, true); assert.equal(result.direction, 'chef'); assert.equal(result.reason, 'canonical_saved_wish_response');
    assert.match(result.text, /不催|不会反复劝/); assert.match(result.text, /新的实际经历/); assert.doesNotMatch(result.text, /我现在要去|配方记稳|然后去|苗圃/);
    assert.equal(f.store.get(f.proposal.proposal_id).user_choice, choice);
  }
});

test('condition deferral and withdrawal describe their saved state without assigning an owner rejection', () => {
  const f = fixture();
  for (const status of ['deferred', 'withdrawn']) {
    const result = render(f, '你这份青蛙愿望现在到了什么阶段？', 'RAW 已经变身', { roleWishes: [{ ...f.proposal, status }] });
    assert.equal(result.applied, true); assert.match(result.text, status === 'deferred' ? /眼前的条件/ : /已经收回/);
    assert.doesNotMatch(result.text, /你拒绝|你不愿意|RAW/);
  }
});

test('ordinary cooking help, imagination, commands and unrelated self questions pass through', () => {
  const f = fixture('chef');
  for (const query of ['你帮我做一道厨师拿手菜吧？', '厨师做汤的菜谱怎么写？', '如果你变成厨师，你会做什么？',
    '我们想象你成为青蛙后在荷叶上玩好吗？', '你现在就变成厨师。', '你今天吃饭了吗？', '你接下来打算吃什么？']) {
    const result = render(f, query, 'ORIGINAL'); assert.equal(result.applied, false, query); assert.equal(result.text, 'ORIGINAL');
  }
});

test('other people and quoted claims do not become the character’s status inquiry', () => {
  const f = fixture();
  for (const query of ['朋友问“你已经变成青蛙了吗？”怎么回答？', '他为什么想成为青蛙？', '别人说你现在已经变成青蛙了，是吗？',
    '“你为什么想变成青蛙？”这句话什么意思？', '他的青蛙愿望现在到什么阶段了？', '你为什么觉得他想当青蛙？']) {
    const result = render(f, query, 'ORIGINAL'); assert.equal(result.applied, false, query); assert.equal(result.text, 'ORIGINAL');
  }
  assert.equal(render(f, '你为什么想成为“青蛙”？').applied, true, 'a quoted name may still identify the saved wish');
});

test('unknown, absent, another actor and multiple directions retain the original reply', () => {
  const frog = fixture(), chef = fixture('chef');
  for (const [query, extra] of [
    ['你为什么想当海豚？', {}], ['你为什么想变成海豚这种形态？', {}], ['你为什么想当厨师？', {}], ['你现在已经变成青蛙了吗？', { roleWishes: [] }],
    ['你现在已经变成青蛙了吗？', { actorId: 'another-actor' }],
    ['你为什么想成为青蛙和厨师？', { roleWishes: [...frog.roleWishes, ...chef.roleWishes] }],
    ['你现在已经变身了吗？', { roleWishes: [...frog.roleWishes, ...chef.roleWishes] }],
  ]) { const result = render(frog, query, 'ORIGINAL', extra); assert.equal(result.applied, false, query); assert.equal(result.text, 'ORIGINAL'); }
  assert.equal(render(frog, '你现在已经变身了吗？').applied, true, 'generic status is unambiguous with one saved authored direction');
});

test('frozen counts and matching records supply the reason; new suggestions and raw user prose never do', () => {
  const f = fixture('chef');
  f.world.refraction = { records: [{ text: 'PRIVATE CLAIM: master cook immediately' }] };
  f.roleWishes[0].authored_reason = 'PRIVATE stored user prose'; f.roleWishes[0].decision_reason = 'PRIVATE decision';
  const result = render(f, '你为什么想试当厨师？');
  assert.equal(result.applied, true); assert.match(result.text, /灶边做饭/); assert.match(result.text, /试做苔芽餐/);
  assert.doesNotMatch(result.text, /PRIVATE|蹬腿|跳进|拥有资格|已经是厨师/);
  const unavailable = render(f, '你为什么想当厨师？', 'ORIGINAL', { roleWishes: [{ ...f.proposal, wish_basis: { root_outcome_ids: [], counts: {} } }] });
  assert.equal(unavailable.applied, false); assert.equal(unavailable.reason, 'saved_wish_reason_basis_unavailable');
});

test('latest saved revision wins and future actual trials fall outside this stage-four renderer', () => {
  const f = fixture();
  const old = { ...f.proposal, status: 'rejected', proposed_at: '2026-10-07T04:00:00Z' };
  const current = { ...f.proposal, status: 'prepared' };
  const result = render(f, '你现在已经变成青蛙了吗？', 'ORIGINAL', { roleWishes: [current, old] });
  assert.equal(result.applied, true); assert.match(result.text, /同意的是一起准备/);
  const future = render(f, '你现在已经变成青蛙了吗？', 'ORIGINAL', { roleWishes: [{ ...current, practical_trial_connected: true }] });
  assert.equal(future.applied, false); assert.equal(future.reason, 'actual_wish_trial_outside_stage4');
});

test('missing world facts and malformed inputs never invent a canonical response', () => {
  const f = fixture();
  const unavailable = render(f, '你现在已经变成青蛙了吗？', 'ORIGINAL', { worldSnapshot: null });
  assert.equal(unavailable.applied, false); assert.equal(unavailable.reason, 'wish_world_facts_unavailable');
  assert.equal(guardRoleWishFacts({ userText: null, text: 'ORIGINAL' }).applied, false);
});
