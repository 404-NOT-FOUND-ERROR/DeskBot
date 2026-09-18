import { InputError } from './input-store.mjs';

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

function clone(value) { return structuredClone(value); }
function atDay(start, index) { return new Date(start.getTime() + index * DAY).toISOString(); }

export function listStoryPackages() { return Object.values(PACKAGES).map(clone); }

export function getStoryPackage(id) {
  const pack = PACKAGES[id];
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
    steps: pack.days.map((day, index) => ({ index, at: atDay(new Date(now), index), day: day.key, title: day.title, action: index === 0 ? 'world_event' : index === 1 ? 'npc_action' : 'world_consequence' })),
  };
}

export function installStoryPackage(id, { now = new Date(), plans = [], schedule, world } = {}) {
  const preview = previewStoryPackage(id, { now, plans, world });
  if (!preview.installable) throw new InputError(409, 'story_package_exists', preview.reason);
  const pack = preview.package;
  const steps = [
    { at: atDay(new Date(now), 0), payload: { action: 'apply_world_line_event', event: { event_id: `${id}:arrival`, title: pack.days[0].title, summary: pack.days[0].summary, daily_consequence: pack.days[0].consequence, opportunity: pack.days[0].opportunity, arc_id: id, status: 'active', outcome: 'route_arrived', source: 'authored-story-package' } } },
    { at: atDay(new Date(now), 0), payload: { action: 'upsert_npc', npc: pack.npc } },
    { at: atDay(new Date(now), 1), payload: { action: 'npc_action', npc_id: pack.npc.npc_id, action_name: 'open_route', status: 'attentive', location_id: pack.npc.location_id, summary: pack.days[1].summary, arc_id: id } },
    { at: atDay(new Date(now), 1), payload: { action: 'apply_world_line_event', event: { event_id: `${id}:opening`, title: pack.days[1].title, summary: pack.days[1].summary, daily_consequence: pack.days[1].consequence, opportunity: pack.days[1].opportunity, arc_id: id, status: 'active', outcome: 'route_opened', source: 'authored-story-package' } } },
    { at: atDay(new Date(now), 2), payload: { action: 'apply_world_line_event', event: { event_id: `${id}:afterglow`, title: pack.days[2].title, summary: pack.days[2].summary, daily_consequence: pack.days[2].consequence, opportunity: pack.days[2].opportunity, arc_id: id, status: 'resolved', outcome: 'route_recorded', source: 'authored-story-package' } } },
  ];
  const plan = schedule({ id, steps });
  return { schema: 'deskbot.story-package-installed.v0.1', package_id: id, plan, causal_chain: steps.map((step, index) => ({ step_index: index, evidence_id: `life:${id}:${index}`, source_layer: 'world_line', depends_on: index ? [`life:${id}:${index - 1}`] : [] })) };
}
