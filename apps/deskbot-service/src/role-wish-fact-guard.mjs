import { ROLE_WISH_DIRECTIONS } from './role-wishes.mjs';
import { ACTIVITIES } from './living-resources.mjs';

const AUTHOR = new Map(ROLE_WISH_DIRECTIONS.map(direction => [direction.direction_id, direction]));
const RECIPE_TITLES = new Map(ACTIVITIES.map(recipe => [recipe.activity_id, recipe.title]));
const MENTIONS = Object.freeze({
  wetland_frog: /荷叶青蛙|青蛙/u,
  workshop_maker: /工坊学徒|制作学徒|修缮学徒/u,
  starry_observer: /星空观察者|观星者/u,
  dream_cloud: /云朵梦境生物|梦境生物/u,
  chef: /厨师|主厨/u,
});
const STATUSES = new Set(['proposed', 'prepared', 'deferred', 'rejected', 'withdrawn']);
const HELP_OR_IMAGINATION = /帮我|替我|教我|菜谱|食谱|怎么做|如何做|画(?:个|一)|写(?:个|一)|编(?:个|一)|故事|童话|角色扮演|假如|如果|假设|想象|脑补|扮演/u;
const REPORTED = /(?:他|她|他们|朋友|别人|有人|老板|主人).{0,10}(?:说|问|觉得|认为|告诉)|(?:他|她|别人|朋友)的(?:愿望|角色|形态)/u;
const OTHER_SUBJECT = /^(?:那|这)?(?:他|她|它|他们|别人|朋友|老板|小岚|阿砾).{0,30}(?:想|成为|变|愿望|角色|形态)|你.{0,10}(?:觉得|认为|说).{0,12}(?:他|她|它|别人|朋友).{0,14}(?:想|变|成为)/u;
const REASON_QUERY = /为什么|为何|理由|什么原因|(?:是|是不是)因为|怎么(?:会|就).{0,12}想|愿望.{0,8}(?:哪来|怎么来)/u;
const STATUS_QUERY = /已经.{0,18}(?:变|成为|试|完成)|(?:是不是|是否|算不算|现在|目前).{0,20}(?:变|成为|厨师|青蛙|角色|形态|试用|试做|准备)|(?:完成|做完|试过|变身|变形|变成|成为).{0,12}(?:了|吗|没|么|？|\?)|(?:愿望|角色|形态|准备|试做|试用).{0,16}(?:什么阶段|到哪|怎样|怎么样|好了|开始|完成)|(?:准备好了|准备好).{0,16}(?:变|成为|吗|没)/u;
const RESPONSE_QUERY = /(?:先不|暂时不|暂缓|稍后|以后再).{0,16}(?:考虑|说|讨论|厨师|青蛙|愿望)|(?:会不会|还会|会一直|一直).{0,14}(?:催|劝|要求|答应)|接下来.{0,12}(?:怎么安排|怎么办|怎么做)/u;
const SELF = /你|喵呜/u;
const WISH_WORDS = /想|愿望|成为|变身|变形|变成|角色|形态|准备|试用|试做|催|答应/u;
const QUESTION = /[?？]|吗|么|是否|是不是|算不算|为什么|为何|哪|怎么|什么|会不会|还会|会一直/u;

function unquotedQuery(value) {
  // Quoted character names remain useful anchors. Reported speech and long
  // quoted claims cannot turn someone else's question into a self inquiry.
  return value.replace(/“([^”]*)”|「([^」]*)」|『([^』]*)』|"([^"\n]*)"|'([^'\n]*)'/gu, (whole, ...captures) => {
    const quoted = captures.slice(0, 5).find(part => part !== undefined) ?? '';
    return quoted.length <= 12 && Object.values(MENTIONS).some(pattern => pattern.test(quoted)) && !WISH_WORDS.test(quoted)
      ? quoted : '';
  });
}
function savedWishes(roleWishes, actorId) {
  const latest = new Map();
  for (const wish of Array.isArray(roleWishes) ? roleWishes : []) {
    const authored = AUTHOR.get(wish?.direction_id);
    if (wish?.origin !== 'lived_wish' || wish.character_id !== actorId || !authored || wish.axis !== authored.axis || !STATUSES.has(wish.status)) continue;
    const prior = latest.get(wish.direction_id);
    const at = Date.parse(wish.proposed_at ?? '') || 0, priorAt = Date.parse(prior?.proposed_at ?? '') || 0;
    if (!prior || at >= priorAt) latest.set(wish.direction_id, wish);
  }
  return [...latest.values()];
}
function frozenPracticeTitles(wish, world) {
  const success = new Set(wish.wish_basis?.practice_success_roots ?? []);
  const seen = new Set();
  for (const record of world.memory?.development?.records ?? []) {
    if (!success.has(record.root_outcome_id) || record.outcome !== 'completed' || !record.actor_ids?.includes(wish.character_id)) continue;
    const title = RECIPE_TITLES.get(record.activity_id);
    if (title) seen.add(title);
  }
  return [...seen].slice(0, 2);
}
function placeOfFrogBasis(wish, world) {
  const roots = new Set(wish.wish_basis?.root_outcome_ids ?? []), places = new Set();
  for (const record of world.memory?.development?.records ?? []) {
    if (!roots.has(record.root_outcome_id) || !record.actor_ids?.includes(wish.character_id)) continue;
    if (record.location_id === 'moss-sprout-garden') places.add('苗圃');
    if (record.location_id === 'echo-waterside') places.add('水岸');
  }
  return [...places].join('和') || '照料这件事';
}
function reasonFor(wish, world) {
  const authored = AUTHOR.get(wish.direction_id), basis = wish.wish_basis;
  const stable = basis.active_days?.length >= 3 && basis.active_contexts?.length >= 2;
  const crossDayPractice = basis.practice_days?.length >= 2 && Number.isFinite(basis.counts?.practice_successes) && basis.counts.practice_successes >= authored.minimum_practice;
  if (!stable || !crossDayPractice) return null;
  const titles = frozenPracticeTitles(wish, world);
  const theme = wish.direction_id === 'wetland_frog' ? placeOfFrogBasis(wish, world)
    : wish.direction_id === 'chef' ? '灶边做饭' : '制作这件事';
  const practice = titles.length ? `也在不同日子完成过${titles.map(title => `“${title}”`).join('、')}` : '也有跨日的对应实践记录';
  return `这段时间，我自己持续关注${theme}，${practice}，所以想${authored.wish_text}。`;
}
function stateFor(wish) {
  const label = AUTHOR.get(wish.direction_id).label;
  if (wish.status === 'prepared') return '你同意的是一起准备尝试。我还没有完成这份愿望的实际试做，也没有因此改变形象；接下来要等真实活动的安排和结果。';
  if (wish.status === 'proposed') return '现在只是提出了这个愿望，还没开始实际试做，也没有因为这份愿望改变形象。想尝试和已经成为，要分开。';
  if (wish.status === 'deferred') return wish.user_choice === 'later'
    ? `${label}这件事先放一放，我会继续原来的生活，不催你答应。以后也要有新的实际经历，再看要不要重新考虑。`
    : `${label}的愿望目前暂缓。已有经历还在，先处理眼前的条件，等能继续时再看；这还不是试做完成或形象变化。`;
  if (wish.status === 'rejected') return `${label}这一次就不继续了，我尊重你的回应，不会反复劝你答应。以后也得有新的实际经历，再重新考虑。`;
  return `${label}那一份愿望已经收回。原来的经历会保留，但不能把它说成仍在准备、已经试做或已经改变形象。`;
}

/**
 * Canonical rendering only for explicit questions about a saved stage-4 wish.
 * This does not evaluate ordinary conversation or promise general grounding.
 * It never changes wishes, memories, tasks, identity, appearance or hardware.
 */
export function guardRoleWishFacts({ userText, text, worldSnapshot, roleWishes, actorId = worldSnapshot?.protagonist?.character_id } = {}) {
  const unchanged = (reason, direction = null) => ({ text, applied: false, reason, direction });
  if (typeof userText !== 'string' || typeof text !== 'string') return unchanged('invalid_text');
  const query = unquotedQuery(userText);
  if (!query.trim() || HELP_OR_IMAGINATION.test(query) || REPORTED.test(query) || OTHER_SUBJECT.test(query)) return unchanged('outside_explicit_saved_wish_inquiry');
  if (!QUESTION.test(query)) return unchanged('outside_explicit_saved_wish_inquiry');
  const reasonQuestion = REASON_QUERY.test(query) && WISH_WORDS.test(query);
  const statusQuestion = STATUS_QUERY.test(query), responseQuestion = RESPONSE_QUERY.test(query);
  if (!reasonQuestion && !statusQuestion && !responseQuestion) return unchanged('outside_explicit_saved_wish_inquiry');
  if (!SELF.test(query) && !(reasonQuestion && /(?:想|愿望|角色|形态)/u.test(query))) return unchanged('not_a_self_wish_inquiry');
  if (!actorId || !worldSnapshot?.memory?.development) return unchanged('wish_world_facts_unavailable');
  const named = Object.entries(MENTIONS).filter(([, pattern]) => pattern.test(query)).map(([id]) => id);
  if (named.length > 1) return unchanged('ambiguous_wish_directions');
  if (!named.length && /变成|成为|想当|当一个|想试试|想试着当/u.test(query)) return unchanged('unknown_or_unnamed_wish_direction');
  if (!named.length && !(statusQuestion && /愿望|角色|形态|试用|试做|变身|变形/u.test(query))
    && !(responseQuestion && /愿望|催|答应/u.test(query))
    && !(reasonQuestion && /这(?:个|份)愿望/u.test(query))) return unchanged('unknown_or_unnamed_wish_direction');
  const saved = savedWishes(roleWishes, actorId);
  const wish = named.length ? saved.find(item => item.direction_id === named[0]) : saved.length === 1 ? saved[0] : null;
  if (!wish) return unchanged(named.length ? 'saved_wish_unavailable' : 'ambiguous_or_missing_saved_wish');
  const direction = wish.direction_id;
  if (!wish.wish_basis || !Array.isArray(wish.wish_basis.root_outcome_ids)) return unchanged('saved_wish_basis_unavailable', direction);
  if (wish.practical_trial_connected === true || wish.trial?.started_at) return unchanged('actual_wish_trial_outside_stage4', direction);
  const explanation = reasonQuestion ? reasonFor(wish, worldSnapshot) : null;
  if (reasonQuestion && !explanation) return unchanged('saved_wish_reason_basis_unavailable', direction);
  return { text: `${explanation ?? ''}${stateFor(wish)}`, applied: true,
    reason: reasonQuestion ? 'canonical_saved_wish_reason' : responseQuestion ? 'canonical_saved_wish_response' : 'canonical_saved_wish_status', direction };
}
