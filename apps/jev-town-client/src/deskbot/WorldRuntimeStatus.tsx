import type { ObserverState, RuntimeActor } from './worldObserver.ts';
import {WorldOperationHistory} from './WorldOperationHistory.tsx';
import {RuntimeDiagnostics} from './RuntimeDiagnostics.tsx';

export function actorMode(actor: RuntimeActor) {
  if (actor.status === 'worker_unavailable') return '认知已登记，工作进程未启动';
  if (actor.status === 'paused') return '自行安排已暂停';
  return ({continuous_cognition:'连续认知', committed_plan:'执行已约定的计划', legacy_routine:'原有作息', manual:'等待安排',
    autonomous_life: actor.decision_mode === 'bounded_model_choice' ? '规则生活 · 模型辅助选择' : '规则生活'})[actor.scheduler];
}

export function WorldRuntimeStatus({state, renderedId, renderUnavailable, renderTimedOut, onRetry,baseUrl}: {
  state: ObserverState; renderedId: string | null; renderUnavailable: boolean; renderTimedOut: boolean; onRetry: () => void; baseUrl?:string;
}) {
  const s = state.snapshot;
  const time = s ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(s.captured_at)) : '';
  const ready = s && renderedId === s.snapshot_id;
  return <details className="world-runtime" aria-label="生活运行与同步状态">
    <summary><span className={`world-runtime__dot ${state.status === 'connected' && ready && !renderUnavailable ? 'is-ready' : ''}`} aria-hidden="true"/>
      <strong>{state.status === 'stale' ? '连接中断 · 保留上次近况' : !s ? '正在读取生活' : renderUnavailable ? '文字近况已同步 · 3D 暂不可用' : ready ? '生活与画面已同步' : renderTimedOut ? '近况已收到 · 画面尚未确认' : '正在更新画面'}</strong>
      {s && <span>{time} · 上海</span>}</summary>
    <p>{s ? `当前 ${s.runtime.actors.length} 位居民，其中 ${s.runtime.continuous_cognition_count} 位已登记连续认知。` : '连接恢复后会自动重读。'}{s?.runtime.continuous_cognition_count === 0 ? '现在的日常由规则安排；配置模型时可辅助选择合法行动。' : ''}</p>
    {s?.runtime.scope==='lab'&&<p role="status">当前连接的是隔离实验存档，不能作为正式跨日生活的观察结果。</p>}
    {state.error && <p role="status">{state.error}</p>}
    {renderTimedOut && !ready && <p>画面尚未确认这一份近况。切回页面或刷新后会再次检查。</p>}
    <button type="button" onClick={onRetry}>重新同步</button>
    {s?.runtime.meal_supply&&<p>长桌现有 {s.runtime.meal_supply.available_portions} 份可领取饭食。{s.runtime.meal_supply.commitments.map(c=>`${s.runtime.actors.find(a=>a.actor_id===c.actor_id)?.display_name??c.actor_id}${c.stage==='cooking'?'正在做饭':c.stage==='carrying_food'?'正在送饭':c.ingredient_units?'正在备料送菜':'正在准备这一餐'}`).join('；')}{s.runtime.meal_supply.commitments.length?'。准备中的份数尚未入库。':''}</p>}
    {s && <><ul className="world-runtime__actors">{s.runtime.actors.map(actor => <li key={actor.actor_id}>
      <strong>{actor.display_name}</strong><span>{actorMode(actor)}</span>
      <small>{actor.conflicts.length ? '发现多个未结束任务，需要核查' : actor.awaiting_meal ? actor.wait_reason??'正在等这一餐，仍需复核食材与空位' : actor.status === 'task_paused' ? '手头活动已暂停' : actor.task_ids.length ? '手头有未完成的活动' : '眼下没有进行中的活动'}</small>
    </li>)}</ul>
    {!!s.runtime.facilities.length && <p>正在使用：{s.runtime.facilities.map(f => `${f.name}（${f.tasks.map(t => s.runtime.actors.find(a => a.actor_id === t.actor_id)?.display_name ?? t.actor_id).join('、')}）`).join('；')}。</p>}
    <small>读取版本 {s.world_revision} · 记录序号 {s.sequence}。地图、生活和角色阶段共用这次读取；身体连接与聊天记录分别更新。服务离线期间不算自主生活。</small></>}
    {baseUrl&&s&&<WorldOperationHistory baseUrl={baseUrl} actors={s.runtime.actors}/>}
    {baseUrl&&s&&<RuntimeDiagnostics baseUrl={baseUrl}/>}
  </details>;
}
