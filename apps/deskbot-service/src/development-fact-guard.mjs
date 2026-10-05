import { modelDevelopmentContext } from './lived-memory.mjs';

const TOPICS = Object.freeze({
  care: { label: '照料', mentions: /苗圃|苗床|苔芽|照料|浇水|播种|育苗/u, actions: '照料|浇水|播种|育苗|整理苗床|照看苗床|照看苗圃' },
  cook: { label: '做饭', mentions: /做饭|烹饪|厨艺|煮汤|炖汤|厨师|暖锅院|温锅院/u, actions: '做饭|烹饪|煮汤|炖汤|做菜' },
  craft: { label: '制作', mentions: /手工|木工|制作|托盘|工坊/u, actions: '制作|做托盘|做手工|做木工' },
  repair: { label: '修缮', mentions: /修缮|维修|修理|修补|水泵|零件屋/u, actions: '修缮|维修|修理|修补|修水泵' },
});
const VIRTUAL_CONTEXT = /聚形域|小镇|虚拟(?:世界|生活|经历)|伴生世界|苗圃|苗床|苔芽|暖锅院|温锅院|零件屋/u;
const SELF_QUESTION = /(?:你|喵呜).{0,45}(?:喜欢|兴趣|会不会|做不做得来|做得来|能不能|已经|做过|做了|完成|亲历|经历|擅长|会.{0,12}[吗么了？?])|(?:是不是|是否|说明).{0,20}你/u;
const REAL_HELP = /现实|我(?:家|的)(?:盆栽|植物|厨房)|教我|帮我(?:做|写|查|想|设计)|菜谱|食谱|怎么做|如何做/u;
const NONFACTUAL = /如果|假如|假设|要是|也许|可能|或许|大概|不一定|似乎|打算|准备|希望|计划|愿意|以后|将来|明天|下次|下一次|会去|会把|想(?:去|做|试|成为)|试试看|试一试|可以试/u;
const NEGATIVE = /(?:不|没|未|无|别).{0,10}(?:做|完成|浇|照料|播种|育苗|制作|修|煮|炖|会|能)|没有|并非|不是/u;
const NONPRACTICE_OBJECT = /(?:做了|做过|做完|完成了|完成过|把).{0,8}(?:决定|选择|计划|打算|梦|回答|承诺)/u;

function questionTopic(userText) {
  if (!VIRTUAL_CONTEXT.test(userText) || !SELF_QUESTION.test(userText) || REAL_HELP.test(userText)) return null;
  const matches = Object.entries(TOPICS).filter(([, entry]) => entry.mentions.test(userText));
  // An ambiguous multi-topic question cannot authorize a blanket correction.
  return matches.length === 1 ? matches[0][0] : null;
}

function contradictoryClaim(text, topic) {
  const actions = TOPICS[topic].actions;
  const adverbs = '(?:(?:已经|确实|真的|亲手|也|早就|曾经|刚刚|以前|之前|都|独自|认真|现在|肯定|当然|完全|早已)\\s*){0,4}';
  const firstPerson = `我${adverbs}`;
  const completed = new RegExp(`${firstPerson}(?:做了|做过|做完(?:了|过)?|完成(?:了|过)|把.{1,24}(?:做|完成)(?:完|好|成)(?:了)?)`, 'u');
  const actualAction = new RegExp(`${firstPerson}(?:(?:${actions})(?:了|过)|按.{1,18}(?:去)?(?:${actions}))`, 'u');
  const skill = new RegExp(`${firstPerson}(?:会|能|能够|擅长)(?:${actions})|${firstPerson}(?:做得来|做得到|做得好)|(?:${actions}).{0,4}我(?:做得来|做得到|做得好)`, 'u');
  // Quoted claims and another person's speech are not the character's testimony.
  const unquoted = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, '');
  for (const sentence of unquoted.split(/[。！？!?；;\n]+/u)) {
    // The conditional can precede a comma: "如果有苗木，我就会照料".
    if (/如果|假如|假设|要是/u.test(sentence)) continue;
    for (const clause of sentence.split(/[，,]+|但是|不过|然而|但/u)) {
      if (NEGATIVE.test(clause) || NONFACTUAL.test(clause) || NONPRACTICE_OBJECT.test(clause)) continue;
      if (/(?:他|她|它|主人|你|小岚|别人).{0,8}(?:说|认为|觉得|告诉).{0,8}我/u.test(clause)) continue;
      if (completed.test(clause) || actualAction.test(clause)) return 'affirmative_completed_practice_without_success';
      if (skill.test(clause)) return 'definite_ability_without_success';
    }
  }
  return null;
}

/**
 * Narrow output consistency check for explicit virtual-life self assessment.
 * This pure read never turns a reply, a correction, or a user's suggestion into
 * an executed outcome. Unknown topics and missing evidence are left unchanged.
 */
export function guardDevelopmentFacts({ userText, text, worldSnapshot, actorId = worldSnapshot?.protagonist?.character_id } = {}) {
  const unchanged = reason => ({ text, applied: false, reason, topic: null });
  if (typeof userText !== 'string' || typeof text !== 'string') return unchanged('invalid_text');
  const topic = questionTopic(userText);
  if (!topic) return unchanged('outside_explicit_virtual_self_assessment');
  if (!worldSnapshot?.memory?.development || !actorId) return unchanged('development_evidence_unavailable');
  const context = modelDevelopmentContext(worldSnapshot, actorId);
  const facet = context.enabled ? context.topics.find(entry => entry.topic === topic) : null;
  if (!facet || !Number.isFinite(facet.capability?.successful_practice)) return unchanged('topic_evidence_unavailable');
  if (facet.capability.successful_practice !== 0) return { text, applied: false, reason: 'actual_success_available', topic };
  const reason = contradictoryClaim(text, topic);
  if (!reason) return { text, applied: false, reason: 'no_definite_contradiction', topic };
  const contact = facet.contact_count > 0 ? '我听到这个建议了。' : '';
  return {
    text: `${contact}目前能确认的经历里，还没有真正完成${TOPICS[topic].label}的记录；愿不愿意继续、做不做得来，得动手后再看。`,
    applied: true,
    reason,
    topic,
  };
}
