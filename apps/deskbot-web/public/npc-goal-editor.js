const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { active: '等待条件', paused: '已暂停', completed: '已完成', cancelled: '已取消', failed: '执行失败' };

export function goalPayload(npcId, purpose, options, id) {
  if (!npcId || !purpose.trim() || !options.length || options.length > 5) throw new Error('请选择角色并填写目标和行动');
  return { id, npc_id: npcId, purpose: purpose.trim(), options: options.map(o => {
    if (![o.value, o.action_name, o.status].every(v => typeof v === 'string' && v.trim() && v.length <= 500)) throw new Error('每个备选行动都需要完整填写');
    if (!['event_present', 'npc_status'].includes(o.kind)) throw new Error('无效的触发条件');
    return { when: { kind: o.kind, value: o.value.trim() }, action_name: o.action_name.trim(), status: o.status.trim() };
  }) };
}

export function mountNpcGoalEditor({ getJson, postJson }) {
  const form = document.querySelector('#npc-goal-form');
  const selector = document.querySelector('#npc-goal-npc');
  const options = document.querySelector('#npc-goal-options');
  const list = document.querySelector('#npc-goal-list');
  const status = document.querySelector('#npc-goal-status');
  let busy = false;
  function addOption() {
    if (options.children.length >= 5) return;
    const row = document.createElement('fieldset');
    row.innerHTML = '<legend>备选行动（从上到下优先）</legend><label>触发条件<select name="kind"><option value="event_present">世界事件 ID 已出现</option><option value="npc_status">角色当前状态等于</option></select></label><label>条件值<input name="value" required maxlength="500"></label><label>行动<input name="action_name" required maxlength="500"></label><label>行动后的状态<input name="status" required maxlength="500"></label><button type="button" data-remove-option>移除</button>';
    options.append(row);
  }
  async function refresh() {
    const [worldData, goalData] = await Promise.all([getJson('/api/world'), getJson('/api/life/npc-goals')]);
    const selected = selector.value;
    selector.innerHTML = (worldData.world.npcs ?? []).map(n => `<option value="${escapeHtml(n.npc_id)}">${escapeHtml(n.display_name)} · ${escapeHtml(n.status ?? '')}</option>`).join('') || '<option value="">暂无 NPC</option>';
    if ([...selector.options].some(o => o.value === selected)) selector.value = selected;
    list.innerHTML = goalData.goals.map(g => {
      const commands = g.state === 'active' ? ['pause', 'cancel'] : g.state === 'paused' ? ['resume', 'cancel'] : g.state === 'failed' ? ['cancel'] : [];
      return `<div><strong>${escapeHtml(g.purpose)}</strong><p>${escapeHtml(g.npc_id)} · ${escapeHtml(labels[g.state] ?? g.state)}</p><ol>${g.options.map(o => `<li>${escapeHtml(o.when.kind === 'event_present' ? '世界事件' : '自身状态')}：${escapeHtml(o.when.value)} → ${escapeHtml(o.payload.action_name)} · ${escapeHtml(o.payload.status)}</li>`).join('')}</ol>${g.decision ? `<p>选择第 ${g.decision.option_index + 1} 项 · 世界版本 ${escapeHtml(g.decision.world_revision)} · ${escapeHtml(g.decision.event.occurred_at)}</p>` : ''}${g.error ? `<p>错误：${escapeHtml(g.error)}</p>` : ''}${commands.map(op => `<button type="button" data-goal="${escapeHtml(g.id)}" data-operation="${op}">${({pause:'暂停',resume:'恢复',cancel:'取消'})[op]}</button>`).join('')}</div>`;
    }).join('') || '尚未登记目标。';
    if (!selector.value) status.textContent = '当前世界没有 NPC。';
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll('#npc-goal-editor button, #npc-goal-editor input, #npc-goal-editor select')];
    controls.forEach(c => { c.disabled = true; });
    try { await action(); await refresh(); if (selector.value) status.textContent = '已更新'; }
    catch (error) { status.textContent = error.message; }
    finally { controls.forEach(c => { c.disabled = false; }); busy = false; }
  }
  document.querySelector('#npc-goal-add').addEventListener('click', addOption);
  options.addEventListener('click', e => { if (e.target.hasAttribute('data-remove-option') && options.children.length > 1) e.target.closest('fieldset').remove(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    run(async () => {
      const rows = [...options.children].map(row => Object.fromEntries([...row.querySelectorAll('[name]')].map(input => [input.name, input.value])));
      await postJson('/api/life/npc-goals', goalPayload(selector.value, document.querySelector('#npc-goal-purpose').value, rows, crypto.randomUUID()));
      form.reset(); options.replaceChildren(); addOption();
    });
  });
  list.addEventListener('click', e => { if (e.target.dataset.operation) run(() => postJson('/api/life/npc-goals', { id: e.target.dataset.goal, operation: e.target.dataset.operation })); });
  document.querySelector('#life-refresh').addEventListener('click', () => run(async () => {}));
  document.querySelector('#npc-goal-editor').addEventListener('toggle', e => { if (e.target.open) run(async () => {}); });
  addOption();
}
