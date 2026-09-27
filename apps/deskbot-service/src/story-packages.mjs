import { InputError } from './input-store.mjs';
import { loadMorrowmereContent } from './content-packages.mjs';

const DAY = 24 * 60 * 60 * 1000;

// Authored, finite slices are the first bridge between lore and a persistent world.
const PACKAGES = Object.freeze({
  'tide-path-three-days-v1': Object.freeze({
    id: 'tide-path-three-days-v1',
    schema: 'deskbot.story-package.v0.1',
    title: '潮后寻路：三日共同经历',
    premise: '交叠潮退去后，市集留下了一条只在桌边显形的湿地旧路。喵呜可以旁观，也可以决定是否靠近。',
    npc: { npc_id: 'pathfinder-001', display_name: '潮痕巡路员', role: 'route_keeper', location_id: 'shaping-field-desk', status: 'waiting' },
    days: [
      { key: 'arrival', title: '潮痕在桌边出现', summary: '市集的旧路标被潮水推到桌边，影子偶尔朝错误方向移动。', consequence: '桌边出现一条尚未确认去向的湿地旧路。', opportunity: '可以观察路标，但还没有必要立刻出发。' },
      { key: 'opening', title: '巡路员开放旧路', summary: '潮痕巡路员整理出一张缺角地图，确认旧路暂时可以通行。', consequence: '湿地旧路从传闻变成可被访问的地点。', opportunity: '可以陪巡路员走一小段，也可以继续留在桌边。' },
      { key: 'afterglow', title: '路标留下回声', summary: '市集收摊后，巡路员留下路线记录；缺角地图上多了一道像猫耳的折痕。', consequence: '旧路暂时关闭，但路线记录成为以后共同回顾的线索。', opportunity: '喵呜可以提出想试试寻路、亲水或记录者的生活方向，尚未作出身份决定。' },
    ],
  }),
});

function compileMorrowmerePackages() {
  const content = loadMorrowmereContent();
  const npcById = new Map(content.npcs.map(npc => [npc.npc_id, npc]));
  return content.stories.story_packages.reduce((packages, authored) => {
    const npc = npcById.get(authored.npc_id);
    packages[authored.id] = {
      id: authored.id,
      schema: 'deskbot.story-package.v0.1',
      title: authored.title,
      premise: authored.premise,
      source: content.source,
      settlement_id: content.settlement.settlement_id,
      npc_location_id: authored.npc_location_id,
      step_offsets_hours: authored.step_offsets_hours,
      npc: {
        npc_id: npc.npc_id,
        display_name: npc.identity,
        role: npc.role,
        location_id: npc.location_id,
        status: npc.status,
      },
      days: authored.days,
    };
    return packages;
  }, {});
}

function packageCatalog() {
  return { ...PACKAGES, ...compileMorrowmerePackages() };
}

function clone(value) { return structuredClone(value); }
function atDay(start, index) { return new Date(start.getTime() + index * DAY).toISOString(); }
function atStoryStep(pack, start, index) {
  const hours = pack.step_offsets_hours?.[index];
  return typeof hours === 'number'
    ? new Date(start.getTime() + hours * 60 * 60 * 1000).toISOString()
    : atDay(start, index);
}

export function listStoryPackages() { return Object.values(packageCatalog()).map(clone); }

export function getStoryPackage(id) {
  const pack = packageCatalog()[id];
  if (!pack) throw new InputError(404, 'story_package_not_found', 'Story package not found');
  return clone(pack);
}

export function previewStoryPackage(id, { now = new Date(), plans = [], world = null } = {}) {
  const pack = getStoryPackage(id);
  const existing = plans.find(plan => plan.id === pack.id);
  return {
    schema: 'deskbot.story-package-preview.v0.1',
    package: pack,
    installable: !existing,
    reason: existing ? (existing.cancelled_at ? '同一故事包已取消，需使用新版本 ID 重装。' : '同一故事包已经安装，不能重复注入。') : '预览不会写入世界；确认安装后才会登记步骤。',
    current_world_revision: world?.world_revision ?? null,
    steps: pack.days.map((day, index) => ({ index, at: atStoryStep(pack, new Date(now), index), day: day.key, title: day.title, action: day.action ?? (index === 0 ? 'world_event' : index === 1 ? 'npc_action' : 'world_consequence') })),
  };
}

export function installStoryPackage(id, { now = new Date(), plans = [], schedule, world } = {}) {
  const preview = previewStoryPackage(id, { now, plans, world });
  if (!preview.installable) throw new InputError(409, 'story_package_exists', preview.reason);
  const pack = preview.package;
  if (pack.days.length < 3) throw new InputError(400, 'story_package_not_replayable', 'Story package needs at least three authored days for the first-day replay');
  const authoredEvent = (day, index, fallbackStatus, fallbackOutcome) => ({
    event_id: `${id}:${day.key}`,
    title: day.title,
    summary: day.summary,
    daily_consequence: day.consequence,
    opportunity: day.opportunity,
    arc_id: id,
    status: day.event?.status ?? fallbackStatus,
    outcome: day.event?.outcome ?? fallbackOutcome,
    source: 'authored-story-package',
    authored_day_index: index,
  });
  const action = pack.days[1].npc_action ?? { action_name: 'open_route', status: 'attentive' };
  const startedAt = new Date(now);
  const arrivalLocationId = pack.npc_location_id ?? pack.npc.location_id;
  const arrivalNpc = { ...pack.npc, location_id: arrivalLocationId };
  const steps = [
    { at: atStoryStep(pack, startedAt, 0), payload: { action: 'apply_world_line_event', event: authoredEvent(pack.days[0], 0, 'active', 'story_started') } },
    { at: atStoryStep(pack, startedAt, 0), payload: { action: 'upsert_npc', npc: arrivalNpc } },
    { at: atStoryStep(pack, startedAt, 1), payload: { action: 'npc_action', npc_id: pack.npc.npc_id, action_name: action.action_name, status: action.status ?? 'attentive', location_id: arrivalLocationId, summary: pack.days[1].summary, arc_id: id } },
    { at: atStoryStep(pack, startedAt, 1), payload: { action: 'apply_world_line_event', event: authoredEvent(pack.days[1], 1, 'active', 'story_progressed') } },
    { at: atStoryStep(pack, startedAt, 2), payload: { action: 'apply_world_line_event', event: authoredEvent(pack.days[2], 2, 'resolved', 'story_recorded') } },
  ];
  const plan = schedule({ id, steps });
  return {
    schema: 'deskbot.story-package-installed.v0.1',
    package_id: id,
    source: pack.source ?? 'service-authored-compatibility',
    settlement_id: pack.settlement_id ?? null,
    plan,
    causal_chain: steps.map((step, index) => ({ step_index: index, evidence_id: `life:${id}:${index}`, source_layer: 'world_line', depends_on: index ? [`life:${id}:${index - 1}`] : [] })),
  };
}
