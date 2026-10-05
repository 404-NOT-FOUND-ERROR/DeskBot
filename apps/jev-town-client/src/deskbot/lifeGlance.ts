import {sceneEnvironmentAt} from '../three/sceneEnvironment.ts';
import {sceneTimePhaseAt} from '../three/sceneLife.ts';
import type {DeskBotWorldMap, DeskBotWorldTask} from './types.ts';

export function dayPhaseLabel(minute: number): string {
  return sceneTimePhaseAt(minute).label;
}

/** Presentation only. The server's clock, task and weather remain authoritative. */
export function worldGlance(map: DeskBotWorldMap | null, now = Date.now()) {
  if (!map) return {clock: '等待连接', date: '', phase: '正在连接', weather: '读取天气中', weatherState: 'unavailable', temperature: null};
  const environment = map.environment;
  const view = environment ? sceneEnvironmentAt(environment, now) : null;
  const minute = Math.floor(view?.minute ?? map.logical_time.minute_of_day);
  const clock = `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
  const weatherState = view?.weatherStatus ?? 'unavailable';
  const weather = weatherState === 'stale' ? '等待新天气' : weatherState === 'unavailable' ? '天气暂未接入' : environment?.weather.condition ?? '天气观测';
  return {clock, date: map.logical_time.date ?? `第 ${map.logical_time.day} 天`, phase: dayPhaseLabel(minute), weather, weatherState,
    temperature: weatherState === 'fresh' && Number.isFinite(environment?.weather.temperature_c) ? Math.round(environment!.weather.temperature_c!) : null};
}

export function activeActorTask(map: DeskBotWorldMap | null, actorId: string | undefined): DeskBotWorldTask | undefined {
  return map?.tasks?.find(task => task.actor_id === actorId && (task.status === 'running' || task.status === 'paused'));
}

export function taskTimeLabel(task: DeskBotWorldTask): string {
  if (task.status === 'paused') return `暂时停下 · 还需约 ${Math.max(1, Math.ceil(task.remaining_ms / 60000))} 分钟`;
  const due = new Date(task.due_at);
  return Number.isFinite(due.getTime()) ? `预计 ${due.toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})} 完成` : '正在进行';
}

export function taskDisplayTitle(map: DeskBotWorldMap | null, task: DeskBotWorldTask): string {
  if (task.kind !== 'travel') return task.title;
  const destination = task.destination_location_id ?? task.to_location_id;
  const name = map?.locations.find(place => place.location_id === destination)?.name;
  return name ? `前往${name}` : task.title;
}
