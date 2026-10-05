import type { SceneLifeActivity } from '../deskbot/activityProjection.ts';

const unit = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (start: number, end: number, value: number) => {
  const t = unit((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};
const localMinute = (minute: number) => ((minute % 1440) + 1440) % 1440;

/** Lighting convention only: these labels never create a shop or resident world event. */
export function sceneTimePhaseAt(rawMinute: number) {
  const minute = localMinute(rawMinute);
  if (minute < 300) return { id: 'midnight', label: '午夜', detail: '窗灯渐息，路灯留着' };
  if (minute < 420) return { id: 'dawn', label: '晨光', detail: '天色渐亮，镇子醒来' };
  if (minute < 1020) return { id: 'day', label: '白昼', detail: '各自忙着今天的事' };
  if (minute < 1140) return { id: 'dusk', label: '傍晚', detail: '灯火渐亮，白昼慢慢收尾' };
  if (minute < 1320) return { id: 'evening', label: '入夜', detail: '窗下还有日常的声音' };
  return { id: 'late-night', label: '深夜', detail: '店灯收起，晚归者仍有路灯' };
}

export type SceneLightChannel = 'public' | 'window' | 'sign' | 'work';
export interface SceneOperationView {
  public: number;
  window: number;
  sign: number;
  work: number;
  active: boolean;
  sleeping: boolean;
}

/** Local task projections determine occupancy. Paused tasks and transit are not work. */
export function sceneOperationAt(model: string, rawMinute: number, night: number, activities: readonly SceneLifeActivity[] = [], variation = 0): SceneOperationView {
  const minute = localMinute(rawMinute);
  const running = activities.filter(task => task.status === 'running' && task.kind !== 'travel');
  const sleeping = running.some(task => task.lifeAction === 'rest');
  const active = running.some(task => task.lifeAction !== 'rest');
  const darkness = unit(night);
  const roomOffset = ((variation % 4) - 1.5) * 13;
  const household = minute < 720
    ? smooth(330 + roomOffset, 390 + roomOffset, minute) * (1 - smooth(405, 465, minute))
    : smooth(1035, 1110, minute) * (1 - smooth(1310 + roomOffset, 1400 + roomOffset, minute));
  const closing = model === 'market' ? [1110, 1220] : model === 'nursery' ? [1100, 1190] : [1230, 1330];
  const storefront = minute > 720 ? 1 - smooth(closing[0]!, closing[1]!, minute) : smooth(390, 480, minute);
  const domestic = model === 'home' || model === 'homes' || model === 'courtyard';
  const roomPower = domestic ? (sleeping && !active ? 0 : Math.max(household, active ? .92 : 0)) : Math.max(storefront, active ? .92 : 0);
  return {
    // Public safety lamps remain on after shops and homes dim. No all-night window glow.
    public: darkness,
    window: roomPower * darkness,
    sign: storefront * darkness,
    work: active ? .28 + darkness * .72 : 0,
    active,
    sleeping,
  };
}

export type SceneTaskEffect = 'steam' | 'irrigation' | 'sparks' | 'stitch';
export function hasSceneTaskEffect(effect: SceneTaskEffect, activities: readonly SceneLifeActivity[]) {
  const recipes: Record<SceneTaskEffect, readonly string[]> = {
    steam: ['cook-moss'],
    irrigation: ['water-bed'],
    sparks: ['repair-bench', 'repair-frame', 'repair-rack', 'repair-stove', 'craft-tray', 'craft-frame-kit'],
    stitch: ['stitch-canopy'],
  };
  return activities.some(task => task.status === 'running' && task.kind !== 'travel' && recipes[effect].includes(task.activityId ?? ''));
}
