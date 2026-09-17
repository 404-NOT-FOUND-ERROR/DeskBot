import { mountNpcGoalEditor } from './npc-goal-editor.js';
const CHARACTER_ID = 'shaping-001';
// Shared-life records are deliberately separate from chat and world authoring.
let lifeMemories = [];
async function refreshLife() {
  const [memoryData, planData] = await Promise.all([getJson('/api/life/memories'), getJson('/api/life/plans')]);
  lifeMemories = memoryData.memories;
  $('#life-memories').innerHTML = lifeMemories.map(item => `<div><p>${escapeHtml(item.text)}</p><small>${escapeHtml(new Date(item.updated_at).toLocaleString('zh-CN'))} · 修订 ${item.revision}</small><button type="button" data-edit-memory="${escapeHtml(item.id)}">更正</button><button type="button" data-forget-memory="${escapeHtml(item.id)}">删除</button></div>`).join('') || '还没有确认保存的记忆。';
  const compactMemory = $('#game-memory-list');
  if (compactMemory) compactMemory.innerHTML = lifeMemories.slice(0, 6).map(item => `<article><p>${escapeHtml(item.text)}</p><small>${escapeHtml(new Date(item.updated_at).toLocaleDateString('zh-CN'))}</small></article>`).join('') || '<p>还没有确认保存的记忆。</p>';
  $('#life-plans').innerHTML = planData.plans.map(plan => `<div><strong>${escapeHtml(plan.id)}</strong><span>${plan.cancelled_at ? '已取消后续步骤' : '计划已登记'}</span><ol>${plan.steps.map(step => `<li>${escapeHtml(new Date(step.at).toLocaleString('zh-CN'))} · ${escapeHtml(step.payload.event?.title || step.payload.action)} · ${escapeHtml(({pending:'待发生',applied:'已发生',failed:'失败，后续阻断'})[step.status] || step.status)}</li>`).join('')}</ol>${!plan.cancelled_at && plan.steps.some(s => s.status === 'pending') ? `<button type="button" data-cancel-plan="${escapeHtml(plan.id)}">取消后续步骤</button>` : ''}</div>`).join('') || '没有世界计划。';
}
async function lifeAction(action) {
  if ($('#shared-life-panel').dataset.busy === 'true') return;
  $('#shared-life-panel').dataset.busy = 'true';
  $('#shared-life-panel').querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await action(); await refreshLife(); setText('#life-status', '记录已更新。'); }
  catch (error) { setText('#life-status', error.status === 404 ? '当前后端尚未加载共同生活功能，需要更新服务。' : error.message); }
  finally {
    $('#shared-life-panel').dataset.busy = 'false';
    $('#shared-life-panel').querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
function initializeLife() {
  mountNpcGoalEditor({ getJson, postJson });
  $('#life-refresh').addEventListener('click', () => lifeAction(async () => {}));
  $('#life-memory-reset').addEventListener('click', () => $('#life-memory-form').reset());
  $('#life-memory-form').addEventListener('submit', event => {
    event.preventDefault();
    const id = $('#life-memory-id').value || crypto.randomUUID();
    lifeAction(async () => {
      await postJson('/api/life/memories', { id, character_id: CHARACTER_ID, text: $('#life-memory-text').value, evidence_ref: `web-confirmation:${crypto.randomUUID()}`, confirmed: true });
      $('#life-memory-form').reset();
    });
  });
  $('#life-memories').addEventListener('click', event => {
    const edit = event.target.dataset.editMemory;
    const forget = event.target.dataset.forgetMemory;
    if (edit) { $('#life-memory-id').value = edit; $('#life-memory-text').value = lifeMemories.find(m => m.id === edit).text; }
    if (forget) lifeAction(() => postJson('/api/life/memories', { operation: 'forget', id: forget }));
  });
  $('#life-plans').addEventListener('click', event => {
    const id = event.target.dataset.cancelPlan;
    if (id) lifeAction(() => postJson('/api/life/plans', { operation: 'cancel', id }));
  });
  $('#life-preview').addEventListener('click', () => lifeAction(async () => {
    const result = await postJson('/api/life/story-packages', { operation: 'preview', package_id: 'tide-path-three-days-v1' });
    $('#life-story-preview').innerHTML = `<strong>${escapeHtml(result.package.title)}</strong> · ${escapeHtml(result.reason)}<ol>${result.steps.map(step => `<li>${escapeHtml(step.title)} · ${escapeHtml(new Date(step.at).toLocaleString('zh-CN'))}</li>`).join('')}</ol>`;
    $('#life-install').disabled = !result.installable;
  }));
  $('#life-install').addEventListener('click', () => lifeAction(async () => {
    const result = await postJson('/api/life/story-packages', { operation: 'install', package_id: 'tide-path-three-days-v1' });
    $('#life-story-preview').textContent = `已安装：${result.package_id}，${result.plan.steps.length} 个步骤等待世界时间推进。`;
    $('#life-install').disabled = true;
  }));
  lifeAction(async () => {});
}
window.addEventListener('DOMContentLoaded', initializeLife);
const state = { world: null, worldMap: null, mapSelectedLocationId: null, mapArrivalLocationId: null, runtimeContext: null, weatherForecast: null, shortState: null, voice: null, worldSchema: null, scenarioCatalog: null, probeCatalog: null, rolePulls: [], roleProposals: [], worldLineSelected: null, multisourceMutations: [], contextPanelBusy: {}, busy: false, mapTravelBusy: false, mutationBusy: false, worldLineBusy: false, scenarioBusy: false, probeBusy: false, roleBusy: false };
const $ = (selector) => document.querySelector(selector);
const messageList = $('#message-list');
const emptyState = $('#empty-state');
const input = $('#message-input');
const sendButton = $('#send-button');

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function formatTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function setText(selector, value) { const element = $(selector); if (element) element.textContent = value == null || value === '' ? '—' : String(value); }
async function getJson(path) { const response = await fetch(path, { headers: { accept: 'application/json' } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(body.message || body.error || `HTTP ${response.status}`), { status: response.status, body }); return body; }
async function postJson(path, payload) { const response = await fetch(path, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) }); const body = await response.json().catch(() => ({})); if (!response.ok && response.status !== 202) throw Object.assign(new Error(body.message || body.error || `HTTP ${response.status}`), { status: response.status, body }); return body; }
function setServicePill(status, label) { const pill = $('#service-pill'); pill.className = `status-pill ${status}`; pill.querySelector('span').textContent = label; }

const MUTATION_EXAMPLES = {
  world_line: {
    apply_world_line_event: { event: { event_id: 'world-line-example', title: '光域出现新的回响', summary: '一次用于研究台的世界线观察', arc_id: 'small-world-opening', status: 'active' } },
    upsert_npc: { npc: { npc_id: 'npc-example', display_name: '访客', role: 'observer', location_id: 'shaping-field-desk', status: 'present' } },
    npc_action: { npc_id: 'npc-example', action_name: 'observe', location_id: 'shaping-field-desk', status: 'attentive' },
    activate_event: { event: { event_id: 'active-example', title: '桌边的微光正在聚拢', summary: '一个有唯一占用约束的进行中事件' } },
    resolve_active_event: { event_id: 'active-example', outcome: 'observed' },
    enqueue_pending_item: { item: { item_id: 'pending-example', kind: 'observation', summary: '等待下一次互动确认' } },
    dequeue_pending_item: {},
    move_protagonist: { location_id: 'shaping-field-desk' },
  },
  external_context: { record_external_context: { item: { item_id: 'news-example', title: '外界发生了一件值得留意的事', summary: '只有核实来源后才作为上下文使用', category: 'news', url: 'https://example.com/source', published_at: '2026-09-04T08:00:00.000Z' } } },
  weather: { update_weather: { snapshot: { location: '上海', condition: '多云', temperature_c: 25, humidity: 0.68, wind_mps: 2.4, observed_at: '2026-09-04T08:00:00.000Z', provider: 'manual-observation' } } },
  calendar: { advance_calendar: { date: '2026-09-04T00:00:00.000Z', timezone: 'Asia/Shanghai', season: '秋', solar_term: null, holiday: null, observed_at: '2026-09-04T08:00:00.000Z' }, advance_time: { minutes: 30 } },
  user_profile: { observe_user_preference: { preference_key: 'conversation.pace', value: 'short' } },
  device_context: { record_device_context: { device_id: 'deskbot-device-001', status: 'online', metrics: { battery: 0.8 }, state: { posture: 'idle' }, observed_at: '2026-09-04T08:00:00.000Z' } },
  interaction: {},
};

const CONTEXT_PANEL_CONFIG = {
  external_context: { action: 'record_external_context', sourceKind: 'external_provider', provider: 'context-workbench' },
  weather: { action: 'update_weather', sourceKind: 'external_provider', provider: 'context-workbench' },
  calendar: { action: 'advance_calendar', sourceKind: 'service', provider: 'context-workbench' },
  user_profile: { action: 'observe_user_preference', sourceKind: 'user', provider: 'context-workbench' },
  device_context: { action: 'record_device_context', sourceKind: 'device', provider: 'context-workbench' },
};

function suggestedSourceKind(layer) {
  return ({ world_line: 'world_engine', external_context: 'external_provider', weather: 'external_provider', calendar: 'service', user_profile: 'user', device_context: 'device', interaction: 'user' })[layer] || 'service';
}

function setMutationResult(kind, title, details) {
  const target = $('#mutation-result');
  target.className = `mutation-result ${kind}`;
  target.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(details)}</span>`;
}

function renderMutationLedger(mutations = []) {
  const target = $('#mutation-ledger');
  const recent = [...mutations].reverse();
  target.innerHTML = recent.length ? recent.map((item) => {
    const accepted = item.observation?.accepted !== false;
    const status = accepted ? (item.applied ? 'accepted' : 'recorded') : 'rejected';
    const reason = item.observation?.reason ? ` · ${item.observation.reason}` : '';
    const source = [item.source_kind, item.provider].filter(Boolean).join(' / ') || 'unknown source';
    return `<div class="ledger-item ${status}"><b>#${escapeHtml(item.sequence)} ${escapeHtml(item.action)}</b><span>${escapeHtml(status)}${escapeHtml(reason)} · ${escapeHtml(source)} · rev ${escapeHtml(item.before_revision)}→${escapeHtml(item.after_revision)}</span></div>`;
  }).join('') : '<span>还没有世界 mutation 记录。</span>';
}

function configureMutationActions() {
  const layer = $('#mutation-layer').value;
  const actionSelect = $('#mutation-action');
  const actions = (state.worldSchema?.supported_mutations || []).filter((item) => item.layer === layer);
  actionSelect.innerHTML = actions.map((item) => `<option value="${escapeHtml(item.action)}">${escapeHtml(item.action)}</option>`).join('');
  $('#mutation-source-kind').value = suggestedSourceKind(layer);
  configureMutationPayload();
}

function configureMutationPayload() {
  const layer = $('#mutation-layer').value;
  const action = $('#mutation-action').value;
  const definition = (state.worldSchema?.supported_mutations || []).find((item) => item.action === action);
  const example = MUTATION_EXAMPLES[layer]?.[action] || {};
  $('#mutation-payload').value = JSON.stringify({ action, ...example }, null, 2);
  setText('#mutation-hint', definition ? `${definition.description} · 必填：${definition.required.length ? definition.required.join(', ') : '无'}` : '这一层由对话入口自动形成，不从世界 mutation 表单注入。');
}

function updateWorldSchema(schema) {
  state.worldSchema = schema;
  const layerSelect = $('#mutation-layer');
  const actionableLayers = (schema.input_layers || []).filter((item) => (schema.supported_mutations || []).some((mutation) => mutation.layer === item.layer));
  layerSelect.innerHTML = actionableLayers.map((item) => `<option value="${escapeHtml(item.layer)}">${escapeHtml(item.layer)} · ${escapeHtml(item.purpose)}</option>`).join('');
  $('#schema-pill').className = 'mini-pill ok';
  $('#schema-pill').textContent = `${schema.input_layers?.length || 0} 类输入`;
  configureMutationActions();
}

function renderScenarioCatalog(catalog) {
  state.scenarioCatalog = catalog;
  const scenarios = catalog?.scenarios || [];
  const target = $('#scenario-grid');
  target.innerHTML = scenarios.length ? scenarios.map((scenario) => `
    <article class="scenario-item">
      <div><span class="scenario-layer">${escapeHtml(scenario.dominant_layer)}</span><strong>${escapeHtml(scenario.title)}</strong></div>
      <p>${escapeHtml(scenario.description)}</p>
      <button class="quiet-button scenario-run" type="button" data-scenario-id="${escapeHtml(scenario.scenario_id)}">运行场景</button>
    </article>
  `).join('') : '<span class="console-hint">没有可用场景。</span>';
  $('#scenario-pill').className = scenarios.length ? 'mini-pill ok' : 'mini-pill muted';
  $('#scenario-pill').textContent = scenarios.length ? `${scenarios.length} 个固定场景` : '场景不可用';
}

function renderScenarioReport(report) {
  const target = $('#scenario-result');
  const passed = report.validation?.passed === true;
  const steps = report.steps || [];
  const stepMarkup = steps.map((step) => {
    const paths = step.changed_field_paths?.join(', ') || '无字段变化';
    return `<div class="scenario-step"><b>${escapeHtml(step.event_id)}</b><span>${escapeHtml(step.input_layer)} · rev ${escapeHtml(step.before_revision)}→${escapeHtml(step.after_revision)}</span><code>${escapeHtml(paths)}</code></div>`;
  }).join('');
  const probe = report.l1b_probe || {};
  target.className = `scenario-report ${passed ? 'ok' : 'bad'}`;
  target.innerHTML = `
    <div class="scenario-report-head"><div><span class="scenario-layer">${escapeHtml(report.scenario?.domain || 'scenario')}</span><strong>${escapeHtml(report.scenario?.title || report.run_id)}</strong></div><b>${passed ? 'PASS' : 'FAIL'}</b></div>
    <p>隔离运行 · 不改当前世界 · rev ${escapeHtml(report.revisions?.before)} → ${escapeHtml(report.revisions?.after)}</p>
    <div class="scenario-steps">${stepMarkup}</div>
    <div class="probe-status"><span>L1b 记录</span><strong>${escapeHtml(probe.status || 'unknown')}</strong><p>字段路径已可归因；真实剖面向量、距离和贡献比例仍为空，等待固定探针。</p></div>
  `;
}

function renderProbeCatalog(catalog) {
  state.probeCatalog = catalog;
  const probes = catalog?.probes || [];
  $('#probe-id').innerHTML = probes.map((probe) => `<option value="${escapeHtml(probe.probe_id)}">${escapeHtml(probe.probe_id)} · ${escapeHtml(probe.measurement_focus || '')}</option>`).join('');
  $('#probe-grid').innerHTML = probes.length ? probes.map((probe) => `
    <article class="probe-item ${catalog.required_probe_ids?.includes(probe.probe_id) ? 'required' : ''}">
      <div><span class="scenario-layer">${escapeHtml(probe.probe_id)}</span><strong>${escapeHtml(probe.prompt)}</strong></div>
      <p>${escapeHtml(probe.measurement_focus || '行为反应')}</p>
      ${catalog.required_probe_ids?.includes(probe.probe_id) ? '<span class="probe-required">必留</span>' : ''}
    </article>
  `).join('') : '<span class="console-hint">没有可用固定探针。</span>';
  $('#probe-pill').className = probes.length ? 'mini-pill ok' : 'mini-pill muted';
  $('#probe-pill').textContent = probes.length ? `${probes.length} 个固定探针` : '探针不可用';
  configureProbePrompt();
}

function configureProbePrompt() {
  const probe = state.probeCatalog?.probes?.find((item) => item.probe_id === $('#probe-id')?.value);
  setText('#probe-hint', probe ? `${probe.prompt} · ${probe.measurement_focus}` : '选择探针查看固定问题。');
}

function renderProbeObservations(observations = []) {
  const target = $('#probe-observations');
  target.innerHTML = observations.length ? observations.map((item) => `<div><b>${escapeHtml(item.probe_id)} · ${escapeHtml(item.time_sample)}</b> · ${escapeHtml(item.observation_id)} · ${escapeHtml(item.response?.raw_text || '')} · ${escapeHtml(item.measurement?.status || 'unknown')}</div>`).join('') : '<span>还没有 L1b 观测记录。</span>';
}

function setProbeResult(kind, title, details) {
  const target = $('#probe-result');
  target.className = `mutation-result ${kind}`;
  target.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(details)}</span>`;
}

async function refreshProbeObservations() {
  try {
    const result = await getJson('/api/research/probe-observations?limit=50');
    renderProbeObservations(result.observations || []);
  } catch (error) {
    $('#probe-observations').innerHTML = `<span>读取失败：${escapeHtml(error.message)}</span>`;
  }
}

async function submitProbeObservation() {
  if (state.probeBusy) return;
  state.probeBusy = true;
  const button = $('#probe-form button[type="submit"]');
  button.disabled = true;
  try {
    const probeId = $('#probe-id').value;
    const timeSample = $('#probe-time').value;
    const rawText = $('#probe-response').value.trim();
    if (!rawText) throw new Error('原始回答不能为空');
    const result = await postJson('/api/research/probe-observations', {
      observation_id: $('#probe-observation-id').value.trim() || `web-${probeId}-${timeSample}-${Date.now()}`,
      probe_id: probeId,
      character_id: CHARACTER_ID,
      time_sample: timeSample,
      raw_text: rawText,
      source: 'deskbot-web-research',
      ...(($('#probe-shell-epoch').value.trim() !== '') ? { shell_epoch: Number($('#probe-shell-epoch').value) } : {}),
      ...(($('#probe-world-revision').value.trim() !== '') ? { world_revision: Number($('#probe-world-revision').value) } : {}),
    });
    setProbeResult('ok', result.duplicate ? '重复观测，未再次写入' : '探针回答已记录', `${probeId} · ${timeSample} · ${result.observation?.measurement?.status || 'awaiting measurement'}`);
    $('#probe-observation-id').value = '';
    $('#probe-response').value = '';
    await refreshProbeObservations();
  } catch (error) {
    setProbeResult('bad', '探针未记录', error.message);
  } finally {
    state.probeBusy = false;
    button.disabled = false;
  }
}

async function runScenario(scenarioId) {
  if (!scenarioId || state.scenarioBusy) return;
  state.scenarioBusy = true;
  document.querySelectorAll('.scenario-run').forEach((button) => { button.disabled = true; });
  const target = $('#scenario-result');
  target.className = 'scenario-report';
  target.innerHTML = '<span>正在从相同初态运行固定事件…</span>';
  try {
    renderScenarioReport(await postJson('/api/research/scenarios/run', { scenario_id: scenarioId }));
  } catch (error) {
    target.className = 'scenario-report bad';
    target.innerHTML = `<strong>场景运行失败</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    state.scenarioBusy = false;
    document.querySelectorAll('.scenario-run').forEach((button) => { button.disabled = false; });
  }
}

function updateWorld(world) {
  if (!world) return;
  state.world = world;
  const protagonist = world.protagonist || {};
  const location = (world.locations || []).find((item) => item.location_id === protagonist.location_id) || world.locations?.[0];
  setText('#world-revision', `rev ${world.world_revision ?? '—'}`); setText('#world-location-name', location?.name || protagonist.location_id || '未命名位置'); setText('#world-location-description', location?.description || '这个位置还没有描述。');
  const appearance = protagonist.appearance || {};
  setText('#appearance-silhouette', appearance.silhouette || '基础形态尚未记录');
  setText('#appearance-anchor', appearance.recognition_anchor || '等待形象识别锚点');
  const generation = appearance.generation_layer || {};
  setText('#appearance-generation', generation.status === 'awaiting_measurement' ? '生成层等待测量数据' : `生成层 · ${generation.light_field || generation.status || '待定'}`);
  const appearanceState = $('#appearance-state');
  if (appearanceState) {
    appearanceState.className = `mini-pill ${appearance.state === 'baseline' ? 'ok' : 'muted'}`;
    appearanceState.textContent = appearance.state === 'baseline' ? '基础形态' : appearance.state || '未标注';
  }
  const logical = world.logical_time; setText('#world-time', logical ? `第 ${logical.day} 天 · ${String(Math.floor((logical.minute_of_day || 0) / 60)).padStart(2, '0')}:${String((logical.minute_of_day || 0) % 60).padStart(2, '0')}` : '—'); setText('#world-turns', world.interaction?.user_turn_count ?? 0);
  const event = world.active_event || world.world_line?.latest_event; $('#world-event').innerHTML = event ? `<span class="event-spark">◌</span><span><strong>${escapeHtml(event.title || event.event_id || '进行中的事件')}</strong>${event.daily_consequence ? `<small>${escapeHtml(event.daily_consequence)}</small>` : ''}</span>` : '<span class="event-spark">◌</span><span>当前没有进行中的世界事件</span>';
  setText('#scene-location', location?.name || '聚形域');
  setText('#scene-time', logical ? `第 ${logical.day} 天 · ${String(Math.floor((logical.minute_of_day || 0) / 60)).padStart(2, '0')}:${String((logical.minute_of_day || 0) % 60).padStart(2, '0')}` : '叙事时间读取中');
  renderScenePreview(location, event);
  if (emptyState?.isConnected) {
    const title = emptyState.querySelector('h3');
    const copy = emptyState.querySelector('p');
    const possibleBeat = location?.scene?.possible_beats?.[0];
    if (title) title.textContent = location?.name ? `我在${location.name}` : '世界已经醒着';
    if (copy) copy.textContent = event?.daily_consequence || (possibleBeat ? `我还没决定，不过有点想${possibleBeat}。` : '我先看看这里今天会发生什么。');
  }
  renderWorldLine(world.world_line || {});
  const gameWorldEvents = $('#game-world-events');
  if (gameWorldEvents) {
    const events = [...(world.world_line?.recent_events || [])].reverse().slice(0, 5);
    gameWorldEvents.innerHTML = events.map((item) => `<article><strong>${escapeHtml(item.title || item.event_id)}</strong><p>${escapeHtml(item.daily_consequence || item.summary || '这件事仍在世界里留下影响。')}</p><small>${escapeHtml(item.arc_id || item.status || 'world line')}</small></article>`).join('') || '<p>世界还没有留下事件。</p>';
  }
  const weather = world.weather?.snapshot;
  const externalItems = world.external_context?.items || [];
  const contextItems = [
    weather ? `天气 · ${weather.location || '未标注位置'} · ${weather.condition || '未标注'}${Number.isFinite(Number(weather.temperature_c)) ? ` · ${weather.temperature_c}°C` : ''}` : null,
    ...externalItems.slice(0, 3).map((item) => `${item.category || '外部事件'} · ${item.title || item.summary || item.item_id || '未命名记录'}${item.provider ? ` · ${item.provider}` : ''}`),
  ].filter(Boolean);
  $('#context-items').innerHTML = contextItems.length ? contextItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>尚未接入天气或外部事件。</span>';
  $('#world-raw').textContent = JSON.stringify(world, null, 2);
  const isCurrent = protagonist.character_id === CHARACTER_ID && world.name === '聚形域'; $('#world-warning').classList.toggle('hidden', isCurrent); setText('#character-badge', isCurrent ? (protagonist.display_name || '喵呜') : `${protagonist.display_name || '旧角色'} · 待重启`);
}

function renderScenePreview(location, event) {
  const visual = $('#scene-visual');
  if (!visual) return;
  const mapLocation = worldMapLocation(location?.location_id);
  const coordinate = mapLocation
    ? { x: mapLocation.x, y: mapLocation.y }
    : location
      ? { x: location.x, y: location.y }
      : { x: 50, y: 50 };
  const cue = location?.scene?.sensory_cues?.[0] || mapLocation?.scene_preview?.sensory_cues?.[0] || location?.description;
  const possibility = location?.scene?.possible_beats?.[0] || mapLocation?.scene_preview?.possible_beats?.[0];
  const livedConsequence = event?.daily_consequence;
  visual.style.setProperty('--scene-x', `${Math.max(0, Math.min(100, Number(coordinate.x) || 50))}%`);
  visual.style.setProperty('--scene-y', `${Math.max(0, Math.min(100, Number(coordinate.y) || 50))}%`);
  visual.dataset.location = location?.location_id || 'unknown';
  visual.setAttribute('aria-label', `喵呜在${location?.name || '聚形域'}的场景`);
  setText('#scene-visual-kicker', livedConsequence ? '世界正在发生' : '我眼前');
  setText('#scene-visual-title', event?.title || location?.name || '聚形域');
  setText('#scene-visual-copy', livedConsequence || (cue ? `我看见${String(cue).replace(/[。.]$/, '')}。` : possibility ? `我有点想${possibility}。` : '我正在看看这里今天会发生什么。'));
}

function worldMapLocation(locationId) {
  return (state.worldMap?.locations || []).find((location) => location.location_id === locationId) || null;
}

function renderWorldMap(map) {
  if (!map) return;
  state.worldMap = map;
  const currentWorldLocation = (state.world?.locations || []).find((location) => location.location_id === state.world?.protagonist?.location_id);
  const currentEvent = state.world?.active_event || state.world?.world_line?.latest_event;
  if (currentWorldLocation) renderScenePreview(currentWorldLocation, currentEvent);
  const locations = Array.isArray(map.locations) ? map.locations.filter((location) => location.visibility !== 'hidden') : [];
  const locationIds = new Set(locations.map((location) => location.location_id));
  const paths = (Array.isArray(map.paths) ? map.paths : []).filter((path) => locationIds.has(path.from_location_id) && locationIds.has(path.to_location_id));
  if (!state.mapSelectedLocationId || !locationIds.has(state.mapSelectedLocationId)) {
    state.mapSelectedLocationId = map.protagonist?.location_id || locations[0]?.location_id || null;
  }
  const pathMarkup = paths.map((path) => {
    const from = locations.find((location) => location.location_id === path.from_location_id);
    const to = locations.find((location) => location.location_id === path.to_location_id);
    if (!from || !to) return '';
    return `<line x1="${Number(from.x)}" y1="${Number(from.y)}" x2="${Number(to.x)}" y2="${Number(to.y)}" class="map-route ${path.reachable ? 'reachable' : ''}" />`;
  }).join('');
  const nodeMarkup = locations.map((location) => {
    const selected = location.location_id === state.mapSelectedLocationId;
    const stateClass = location.current ? 'current' : location.reachable ? 'reachable' : 'distant';
    return `<button class="map-location ${stateClass} ${selected ? 'selected' : ''}" type="button" data-map-location="${escapeHtml(location.location_id)}" style="--map-x:${Number(location.x)}%;--map-y:${Number(location.y)}%" aria-pressed="${selected}"><i aria-hidden="true"></i><span>${escapeHtml(location.name)}</span>${location.current ? '<small>喵呜在这里</small>' : location.reachable ? `<small>${escapeHtml(location.travel_cost || '—')} 分钟</small>` : '<small>尚不能直达</small>'}</button>`;
  }).join('');
  const arrivalLocation = locations.find((location) => location.location_id === state.mapArrivalLocationId && location.current);
  const mapTarget = $('#world-map');
  mapTarget.classList.toggle('arrival-focus', Boolean(arrivalLocation));
  if (arrivalLocation) {
    mapTarget.style.setProperty('--focus-x', `${Number(arrivalLocation.x)}%`);
    mapTarget.style.setProperty('--focus-y', `${Number(arrivalLocation.y)}%`);
  }
  const arrivalToast = arrivalLocation ? `<div class="map-arrival-toast"><span>已抵达</span><strong>${escapeHtml(arrivalLocation.name)}</strong></div>` : '';
  mapTarget.innerHTML = `<div class="map-stage"><svg class="map-routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${pathMarkup}</svg>${nodeMarkup}</div>${arrivalToast}`;
  const pill = $('#map-status');
  const blocked = map.active_event?.blocks_travel === true;
  pill.className = `mini-pill ${blocked ? 'warn' : 'ok'}`;
  pill.textContent = blocked ? '道路暂时封锁' : `${locations.length} 个地点`;
  renderMapDetail();
}

function syncGameDock() {
  document.querySelectorAll('[data-panel-target]').forEach((button) => {
    const panel = document.querySelector(`[data-game-panel="${CSS.escape(button.dataset.panelTarget || '')}"]`);
    button.classList.toggle('active', Boolean(panel && !panel.hidden));
  });
}

function toggleGamePanel(panelId) {
  const panel = document.querySelector(`[data-game-panel="${CSS.escape(panelId || '')}"]`);
  if (!panel) return;
  const opening = panel.hidden;
  if (panel.classList.contains('floating-panel') && opening) {
    document.querySelectorAll('.floating-panel[data-game-panel]').forEach((other) => { other.hidden = true; });
  }
  panel.hidden = !opening;
  syncGameDock();
}

function renderMapDetail() {
  const location = worldMapLocation(state.mapSelectedLocationId);
  const target = $('#map-detail');
  if (!location) {
    target.innerHTML = '<strong>地图暂无地点</strong><p>等待持续世界加载。</p>';
    return;
  }
  const currentEvent = location.current_event_summary ? `<span class="map-event-note">此刻 · ${escapeHtml(location.current_event_summary)}</span>` : '';
  const npcs = location.npc_summary?.length ? `<span class="map-npc-note">在这里 · ${location.npc_summary.map((npc) => escapeHtml(npc.display_name)).join('、')}</span>` : '';
  const sceneCue = location.scene_preview?.sensory_cues?.[0] ? `<span class="map-scene-note">眼前 · ${escapeHtml(location.scene_preview.sensory_cues[0])}</span>` : '';
  const possibleBeat = location.scene_preview?.possible_beats?.[0] ? `<span class="map-possibility-note">可以试试 · ${escapeHtml(location.scene_preview.possible_beats[0])}</span>` : '';
  let action = '<span class="map-current-label">喵呜现在就在这里</span>';
  if (!location.current && location.reachable) action = `<button class="map-travel-button" type="button" data-travel-location="${escapeHtml(location.location_id)}" ${state.mapTravelBusy ? 'disabled' : ''}>前往这里 <span>${escapeHtml(location.travel_cost || '—')} 分钟</span></button>`;
  if (!location.current && !location.reachable) action = '<span class="map-distant-label">要先经过相邻地点</span>';
  target.innerHTML = `<div><strong>${escapeHtml(location.name)}</strong><p>${escapeHtml(location.description || '这里还没有留下描述。')}</p>${sceneCue}${possibleBeat}${currentEvent}${npcs}</div>${action}`;
}

async function travelTo(locationId) {
  if (!locationId || state.mapTravelBusy) return;
  const destination = worldMapLocation(locationId);
  if (!destination?.reachable) return;
  state.mapTravelBusy = true;
  renderMapDetail();
  const result = $('#map-result');
  result.className = 'map-result pending';
  result.textContent = `正沿着通往${destination.name}的路出发…`;
  try {
    const payload = await postJson('/api/world/travel', {
      event_id: `web-travel-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      character_id: CHARACTER_ID,
      location_id: locationId,
      reason: `从地图选择前往${destination.name}`,
    });
    const arrival = payload.world_mutation?.mutation?.details?.arrival_text || destination.arrival_text || `我到${destination.name}了。`;
    result.className = 'map-result ok';
    result.textContent = arrival;
    appendMessage('assistant', arrival, `聚形域 · 抵达${destination.name}`);
    if (payload.world_mutation?.world) updateWorld(payload.world_mutation.world);
    state.mapArrivalLocationId = locationId;
    renderWorldMap(payload.map);
    await refreshDashboard();
    setTimeout(() => {
      if (state.mapArrivalLocationId !== locationId) return;
      state.mapArrivalLocationId = null;
      $('#world-map')?.classList.remove('arrival-focus');
      $('#world-map')?.querySelector('.map-arrival-toast')?.remove();
    }, 1800);
  } catch (error) {
    result.className = 'map-result bad';
    result.textContent = error.message;
    await refreshDashboard();
  } finally {
    state.mapTravelBusy = false;
    renderMapDetail();
  }
}

function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderWorldLine(worldLine = {}) {
  const currentArc = worldLine.current_arc || '尚未设定';
  setText('#world-current-arc', currentArc);
  setText('#worldline-current-arc', currentArc);
  const latest = worldLine.latest_event || null;
  setText('#worldline-latest-summary', latest ? `${latest.title || latest.event_id}${latest.summary ? ` · ${latest.summary}` : ''}` : '还没有世界线事件。');
  const events = Array.isArray(worldLine.recent_events) ? [...worldLine.recent_events].reverse() : [];
  const target = $('#worldline-timeline');
  if (!target) return;
  target.innerHTML = events.length ? events.map((event) => `
    <article class="worldline-event-item ${event.status === 'active' ? 'active' : ''}">
      <div class="worldline-event-marker" aria-hidden="true"></div>
      <div class="worldline-event-content">
        <div class="worldline-event-top"><span class="scenario-layer">${escapeHtml(event.arc_id || '未分配弧段')}</span><span class="worldline-status">${escapeHtml(event.status || 'active')}</span></div>
        <strong>${escapeHtml(event.title || event.event_id)}</strong>
        <p>${escapeHtml(event.summary || '没有摘要。')}</p>
        ${event.daily_consequence ? `<p><b>今日影响</b> · ${escapeHtml(event.daily_consequence)}</p>` : ''}
        ${event.opportunity ? `<p><b>眼前机会</b> · ${escapeHtml(event.opportunity)}</p>` : ''}
        ${event.unresolved_hook ? `<p><b>未解钩子</b> · ${escapeHtml(event.unresolved_hook)}</p>` : ''}
        <small>${escapeHtml(event.event_id)}${event.occurred_at ? ` · ${escapeHtml(new Date(event.occurred_at).toLocaleString('zh-CN'))}` : ''}</small>
        <button class="quiet-button worldline-edit" type="button" data-worldline-id="${escapeHtml(event.event_id)}">复制并修订</button>
      </div>
    </article>
  `).join('') : '<span class="console-hint">还没有世界线事件。可以从右侧新建第一条长期事件。</span>';
  const count = events.length;
  const pill = $('#worldline-pill');
  if (pill) { pill.className = `mini-pill ${count ? 'ok' : 'muted'}`; pill.textContent = count ? `${count} 条事件` : '尚未建立'; }
}

function formatContextTimestamp(value) {
  if (!value) return '时间未标注';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

function contextFormValue(form, name) {
  const field = form.elements.namedItem(name);
  return field ? field.value.trim() : '';
}

function optionalFormNumber(form, name) {
  const value = contextFormValue(form, name);
  if (value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} 必须是数字`);
  return number;
}

function optionalFormDate(form, name) {
  const value = contextFormValue(form, name);
  return value ? new Date(value).toISOString() : undefined;
}

function renderContextRecent(targetId, mutations, action) {
  const target = $(targetId);
  if (!target) return;
  const recent = (mutations || []).filter((item) => item.action === action).slice(-4).reverse();
  const summary = (mutation) => {
    const details = mutation.details || {};
    if (details.item) return details.item.title || details.item.item_id;
    if (details.snapshot) return `${details.snapshot.location || '天气'} · ${details.snapshot.condition || '已观测'}`;
    if (details.calendar) return `${details.calendar.date || '日历'}${details.calendar.season ? ` · ${details.calendar.season}` : ''}`;
    if (details.preference_key) return `${details.preference_key} = ${String(details.value)}`;
    if (details.device) return `${details.device.device_id} · ${details.device.status || 'observed'}`;
    return mutation.action;
  };
  target.innerHTML = recent.length ? recent.map((mutation) => {
    const accepted = mutation.observation?.accepted !== false;
    return `<div class="context-record ${accepted ? 'accepted' : 'rejected'}"><span>${escapeHtml(summary(mutation))}</span><small>${accepted ? '已接受' : '已拒绝'} · rev ${escapeHtml(mutation.before_revision)}→${escapeHtml(mutation.after_revision)} · ${escapeHtml(formatContextTimestamp(mutation.observed_at))}</small></div>`;
  }).join('') : '<span class="context-empty">还没有该输入层的记录。</span>';
}

function renderContextWorkbench(world = state.world, mutations = state.multisourceMutations) {
  if (!world) return;
  const externalItems = world.external_context?.items || [];
  const latestExternal = [...externalItems].reverse()[0];
  const externalCurrent = $('#external-context-current');
  if (externalCurrent) externalCurrent.innerHTML = latestExternal
    ? `<strong>${escapeHtml(latestExternal.title || latestExternal.item_id)}</strong><span>${escapeHtml(latestExternal.summary || '没有摘要。')}</span><small>${escapeHtml(latestExternal.category || 'news')} · ${escapeHtml(formatContextTimestamp(latestExternal.published_at || latestExternal.observed_at))}</small>`
    : '尚未写入外部事件。';
  setText('#external-context-status', externalItems.length ? `${externalItems.length} 条记录` : '未接入');
  renderContextRecent('#external-context-recent', mutations, 'record_external_context');

  const weather = world.weather?.snapshot;
  const weatherCurrent = $('#weather-context-current');
  if (weatherCurrent) weatherCurrent.innerHTML = weather
    ? `<strong>${escapeHtml(weather.location || '未标注地点')} · ${escapeHtml(weather.condition || '已观测')}</strong><span>${weather.temperature_c == null ? '温度未标注' : `${escapeHtml(weather.temperature_c)}°C`} · ${weather.humidity == null ? '湿度未标注' : `湿度 ${escapeHtml(Math.round(weather.humidity * 100))}%`} · ${weather.wind_mps == null ? '风速未标注' : `风 ${escapeHtml(weather.wind_mps)}m/s`}</span><small>${escapeHtml(formatContextTimestamp(weather.observed_at))} · ${escapeHtml(weather.provider || 'provider 未标注')}</small>`
    : '尚未写入天气。';
  setText('#weather-context-status', weather ? '当前快照' : '未接入');
  renderContextRecent('#weather-context-recent', mutations, 'update_weather');

  const calendar = world.calendar || {};
  const logical = world.logical_time || {};
  const calendarCurrent = $('#calendar-context-current');
  if (calendarCurrent) calendarCurrent.innerHTML = calendar.date
    ? `<strong>${escapeHtml(formatContextTimestamp(calendar.date))}</strong><span>${escapeHtml(calendar.timezone || '时区未标注')} · ${escapeHtml(calendar.season || '季节未标注')}${calendar.solar_term ? ` · ${escapeHtml(calendar.solar_term)}` : ''}</span><small>${calendar.holiday ? `特殊日 · ${escapeHtml(calendar.holiday)}` : '没有特殊日'} · 逻辑世界第 ${escapeHtml(logical.day ?? '—')} 天</small>`
    : `<strong>逻辑世界第 ${escapeHtml(logical.day ?? '—')} 天</strong><span>日历日期尚未设置</span>`;
  setText('#calendar-context-status', calendar.date ? '当前日历' : '待设置');
  renderContextRecent('#calendar-context-recent', mutations, 'advance_calendar');

  const preferences = world.user_profile?.preferences || {};
  const preferenceEntries = Object.entries(preferences);
  const profileCurrent = $('#user-profile-context-current');
  if (profileCurrent) profileCurrent.innerHTML = preferenceEntries.length ? preferenceEntries.map(([key, preference]) => `<div class="preference-row"><span>${escapeHtml(key)}</span><strong>${escapeHtml(String(preference.value))}</strong><small>${preference.stable ? 'stable' : `${escapeHtml(preference.observations || 0)}/3 次观察`}</small></div>`).join('') : '还没有稳定偏好。';
  setText('#user-profile-context-status', preferenceEntries.length ? `${preferenceEntries.length} 项偏好` : '未观察');
  renderContextRecent('#user-profile-context-recent', mutations, 'observe_user_preference');

  const devices = Object.values(world.device_context?.devices || {});
  const deviceCurrent = $('#device-context-current');
  if (deviceCurrent) deviceCurrent.innerHTML = devices.length ? devices.map((device) => `<div class="device-row"><strong>${escapeHtml(device.device_id)}</strong><span>${escapeHtml(device.status || 'observed')}</span><small>${escapeHtml(JSON.stringify(device.metrics || {}))} · ${escapeHtml(formatContextTimestamp(device.observed_at))}</small></div>`).join('') : '尚未登记设备上下文。';
  setText('#device-context-status', devices.length ? `${devices.length} 台设备` : '未登记');
  renderContextRecent('#device-context-recent', mutations, 'record_device_context');
}

function setContextWorkbenchResult(kind, title, details) {
  const target = $('#context-workbench-result');
  if (!target) return;
  target.className = `mutation-result ${kind}`;
  target.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(details)}</span>`;
}

async function submitContextPanel(form) {
  const layer = form.dataset.contextLayer;
  if (!layer || state.contextPanelBusy[layer]) return;
  const config = CONTEXT_PANEL_CONFIG[layer];
  if (!config) return;
  state.contextPanelBusy[layer] = true;
  const button = form.querySelector('.context-submit');
  if (button) button.disabled = true;
  try {
    let action = config.action;
    let payload;
    if (layer === 'external_context') {
      const item = { item_id: contextFormValue(form, 'item_id'), title: contextFormValue(form, 'title'), summary: contextFormValue(form, 'summary'), category: contextFormValue(form, 'category') || 'news', url: contextFormValue(form, 'url') || undefined, published_at: optionalFormDate(form, 'published_at'), provider: contextFormValue(form, 'provider') || undefined };
      if (!item.item_id || !item.title || !item.summary) throw new Error('外部事件的 item_id、标题和摘要不能为空');
      payload = { action, item };
    } else if (layer === 'weather') {
      const snapshot = { location: contextFormValue(form, 'location'), condition: contextFormValue(form, 'condition'), temperature_c: optionalFormNumber(form, 'temperature_c'), humidity: optionalFormNumber(form, 'humidity'), wind_mps: optionalFormNumber(form, 'wind_mps'), observed_at: optionalFormDate(form, 'observed_at'), provider: contextFormValue(form, 'provider') || undefined };
      if (!snapshot.location || !snapshot.condition) throw new Error('天气地点和天气状况不能为空');
      payload = { action, snapshot };
    } else if (layer === 'calendar') {
      payload = { action, date: optionalFormDate(form, 'date'), timezone: contextFormValue(form, 'timezone') || undefined, season: contextFormValue(form, 'season') || undefined, solar_term: contextFormValue(form, 'solar_term') || undefined, holiday: contextFormValue(form, 'holiday') || undefined };
    } else if (layer === 'user_profile') {
      const key = contextFormValue(form, 'preference_key');
      const rawValue = contextFormValue(form, 'value');
      const valueType = contextFormValue(form, 'value_type');
      if (!key || !rawValue) throw new Error('偏好键和值不能为空');
      let value = rawValue;
      if (valueType === 'number') { value = Number(rawValue); if (!Number.isFinite(value)) throw new Error('数字偏好值无效'); }
      if (valueType === 'boolean') { if (!['true', 'false'].includes(rawValue.toLowerCase())) throw new Error('布尔值请输入 true 或 false'); value = rawValue.toLowerCase() === 'true'; }
      payload = { action, preference_key: key, value };
    } else if (layer === 'device_context') {
      const deviceId = contextFormValue(form, 'device_id');
      if (!deviceId) throw new Error('设备 ID 不能为空');
      const metricsRaw = contextFormValue(form, 'metrics');
      const stateRaw = contextFormValue(form, 'state');
      const metrics = metricsRaw ? JSON.parse(metricsRaw) : undefined;
      const deviceState = stateRaw ? JSON.parse(stateRaw) : undefined;
      payload = { action, device_id: deviceId, status: contextFormValue(form, 'status') || 'observed', metrics, state: deviceState, observed_at: optionalFormDate(form, 'observed_at') };
    }
    const result = await postJson('/api/event', {
      event_id: `context-${layer}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: 'world.mutation', source: 'deskbot-web-context', character_id: CHARACTER_ID, layer, source_kind: config.sourceKind, confidence: 1, provider: config.provider, observed_at: new Date().toISOString(),
      provenance: { interface: 'deskbot-web', mode: 'context-workbench', input_layer: layer, manually_injected: true },
      payload,
    });
    const mutation = result.world_mutation?.mutation;
    const accepted = mutation?.observation?.accepted !== false;
    const detail = mutation ? `${mutation.action} · rev ${mutation.before_revision} → ${mutation.after_revision}${mutation.observation?.reason ? ` · ${mutation.observation.reason}` : ''}` : '事件已进入输入层。';
    setContextWorkbenchResult(accepted ? 'ok' : 'warn', accepted ? `${layer} 已更新` : `${layer} 已记录但未应用`, detail);
    const status = $(`#${layer.replace('_', '-')}-context-status`);
    if (status && mutation) status.textContent = `rev ${mutation.after_revision}`;
    form.reset();
    if (layer === 'external_context') form.elements.namedItem('category').value = 'news';
    if (layer === 'weather') form.elements.namedItem('provider').value = 'manual';
    if (layer === 'calendar') form.elements.namedItem('timezone').value = 'Asia/Shanghai';
    if (layer === 'device_context') { form.elements.namedItem('device_id').value = 'deskbot-device-001'; form.elements.namedItem('status').value = 'online'; }
    await refreshDashboard();
  } catch (error) {
    setContextWorkbenchResult('bad', `${layer} 未提交`, error instanceof SyntaxError ? 'JSON 字段格式无效' : error.message);
  } finally {
    state.contextPanelBusy[layer] = false;
    if (button) button.disabled = false;
  }
}

function resetWorldLineForm() {
  state.worldLineSelected = null;
  setText('#worldline-form-mode', '新建世界线事件');
  setText('#worldline-selected', '未选择事件');
  setText('#worldline-submit-label', '写入世界线');
  $('#worldline-event-id').value = '';
  $('#worldline-title').value = '';
  $('#worldline-summary').value = '';
  $('#worldline-daily-consequence').value = '';
  $('#worldline-opportunity').value = '';
  $('#worldline-unresolved-hook').value = '';
  $('#worldline-arc-id').value = state.world?.world_line?.current_arc || '';
  $('#worldline-status').value = 'active';
  $('#worldline-source').value = 'world-engine';
  $('#worldline-occurred-at').value = '';
}

function selectWorldLineEvent(eventId) {
  const event = state.world?.world_line?.recent_events?.find((item) => item.event_id === eventId);
  if (!event) return;
  state.worldLineSelected = event;
  setText('#worldline-form-mode', '复制并修订世界线事件');
  setText('#worldline-selected', `修订 ${event.event_id}`);
  setText('#worldline-submit-label', '追加修订');
  $('#worldline-event-id').value = '';
  $('#worldline-title').value = event.title || '';
  $('#worldline-summary').value = event.summary || '';
  $('#worldline-daily-consequence').value = event.daily_consequence || '';
  $('#worldline-opportunity').value = event.opportunity || '';
  $('#worldline-unresolved-hook').value = event.unresolved_hook || '';
  $('#worldline-arc-id').value = event.arc_id || '';
  $('#worldline-status').value = event.status || 'active';
  $('#worldline-source').value = event.source || 'world-engine';
  $('#worldline-occurred-at').value = formatDateTimeLocal(event.occurred_at);
  $('#worldline-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setWorldLineResult(kind, title, details) {
  const target = $('#worldline-result');
  target.className = `mutation-result ${kind}`;
  target.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(details)}</span>`;
}

async function submitWorldLine() {
  if (state.worldLineBusy) return;
  state.worldLineBusy = true;
  const button = $('#worldline-form button[type="submit"]');
  button.disabled = true;
  try {
    const title = $('#worldline-title').value.trim();
    const summary = $('#worldline-summary').value.trim();
    if (!title || !summary) throw new Error('标题和事件摘要不能为空');
    const selected = state.worldLineSelected;
    const eventId = $('#worldline-event-id').value.trim() || `worldline-${Date.now()}`;
    const occurredAt = $('#worldline-occurred-at').value.trim();
    const payloadEvent = {
      event_id: eventId,
      title,
      summary,
      daily_consequence: $('#worldline-daily-consequence').value.trim() || null,
      opportunity: $('#worldline-opportunity').value.trim() || null,
      unresolved_hook: $('#worldline-unresolved-hook').value.trim() || null,
      arc_id: $('#worldline-arc-id').value.trim() || null,
      status: $('#worldline-status').value,
      source: $('#worldline-source').value.trim() || 'world-engine',
      ...(occurredAt ? { occurred_at: new Date(occurredAt).toISOString() } : {}),
    };
    const result = await postJson('/api/event', {
      event_id: `worldline-mutation-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: 'world.mutation',
      source: 'deskbot-web-research',
      character_id: CHARACTER_ID,
      layer: 'world_line',
      source_kind: 'world_engine',
      confidence: 1,
      provider: 'worldline-workbench',
      observed_at: new Date().toISOString(),
      provenance: { interface: 'deskbot-web', mode: selected ? 'worldline-revision' : 'worldline-create', manually_injected: true, ...(selected ? { revises_event_id: selected.event_id } : {}) },
      payload: { action: 'apply_world_line_event', event: payloadEvent },
    });
    const mutation = result.world_mutation?.mutation;
    const accepted = mutation?.observation?.accepted !== false;
    setWorldLineResult(accepted ? 'ok' : 'warn', selected ? '修订已追加' : '世界线事件已写入', mutation ? `${payloadEvent.title} · ${payloadEvent.event_id} · rev ${mutation.before_revision} → ${mutation.after_revision}` : '事件已进入输入层。');
    resetWorldLineForm();
    await refreshDashboard();
  } catch (error) {
    setWorldLineResult('bad', '世界线未写入', error.message);
  } finally {
    state.worldLineBusy = false;
    button.disabled = false;
  }
}

function updateRuntimeContext(payload) {
  const context = payload?.context || payload;
  if (!context) return;
  state.runtimeContext = context;
  const clock = context.real_time || {};
  const time = $('#real-time');
  if (time) {
    time.textContent = clock.display || '读取失败';
    time.dateTime = clock.iso_utc || '';
  }
  setText('#real-time-source', clock.timezone ? `服务器本地时钟 · ${clock.timezone} · ${clock.freshness || 'unknown'}` : '服务器本地时钟不可用');
  const sourceList = context.sources || [];
  $('#connection-list').innerHTML = sourceList.length ? sourceList.map((source) => {
    const active = source.status === 'active' || source.status === 'fresh';
    const status = active ? '已连接' : source.status === 'ready' ? '已配置' : source.status === 'stale' ? '已过期' : source.status === 'error' ? '连接失败' : source.status === 'not_configured' ? '未配置' : source.status || '未知';
    const detail = source.last_success_at ? `更新 ${formatTime(source.last_success_at)}` : source.contribution || '暂无数据';
    return `<div class="connection-row"><span class="connection-dot ${active ? 'active' : ''}"></span><div><strong>${escapeHtml(source.display_name || source.source_id)}</strong><small>${escapeHtml(detail)}</small></div><b>${escapeHtml(status)}</b></div>`;
  }).join('') : '<span class="console-hint">没有数据源状态。</span>';
}

function forecastStatusLabel(entry) {
  if (!entry) return '未请求';
  if (entry.status === 'fresh') return `有效 · ${formatTime(entry.last_success_at)}`;
  if (entry.status === 'stale') return '已过期';
  if (entry.status === 'error') return '连接失败';
  return '未请求';
}

function renderForecastList(selector, items, kind) {
  const target = $(selector);
  if (!target) return;
  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = '<span>等待数据</span>';
    return;
  }
  const visible = items.slice(0, kind === 'minutely' ? 6 : kind === 'hourly' ? 6 : 5);
  target.innerHTML = visible.map((item) => {
    if (kind === 'minutely') {
      const time = item.time ? formatTime(item.time) : '—';
      return `<div class="forecast-item"><b>${escapeHtml(time)}</b><span>${escapeHtml(item.description || item.type || '无降水')} · ${item.precip_mm == null ? '—' : `${escapeHtml(item.precip_mm)} mm`}</span></div>`;
    }
    if (kind === 'hourly') {
      const time = item.time ? formatTime(item.time) : '—';
      const rain = item.precipitation_probability == null ? '—' : `${escapeHtml(item.precipitation_probability)}%`;
      return `<div class="forecast-item"><b>${escapeHtml(time)}</b><span>${item.temperature_c == null ? '—' : `${escapeHtml(item.temperature_c)}°C`} · ${escapeHtml(item.condition || '—')} · 降水 ${rain}</span></div>`;
    }
    const date = item.date ? String(item.date).slice(5) : '—';
    const range = item.temp_min_c == null && item.temp_max_c == null ? '温度 —' : `${item.temp_min_c ?? '—'}–${item.temp_max_c ?? '—'}°C`;
    const rain = item.precipitation_probability == null ? '—' : `${escapeHtml(item.precipitation_probability)}%`;
    return `<div class="forecast-item"><b>${escapeHtml(date)}</b><span>${escapeHtml(range)} · ${escapeHtml(item.condition_day || '—')} · 降水 ${rain}</span></div>`;
  }).join('');
}

function updateWeatherForecast(payload) {
  const body = payload || {};
  state.weatherForecast = body;
  const connectorForecast = body.connector?.forecast || {};
  const forecast = body.forecast || {};
  const kinds = ['minutely', 'hourly', 'daily'];
  for (const kind of kinds) {
    setText(`#forecast-${kind}-status`, forecastStatusLabel(connectorForecast[kind]));
    renderForecastList(`#forecast-${kind}`, forecast[kind]?.items, kind);
  }
  const available = kinds.some((kind) => Array.isArray(forecast[kind]?.items) && forecast[kind].items.length > 0);
  const status = $('#forecast-status');
  if (status) {
    status.className = `mini-pill ${available ? 'ok' : 'muted'}`;
    status.textContent = available ? '已读取' : '尚未读取';
  }
}

async function refreshRuntimeContext() {
  try {
    updateRuntimeContext(await getJson('/api/context'));
  } catch (error) {
    setText('#real-time', '时间源不可达');
    setText('#real-time-source', error.message);
    $('#connection-list').innerHTML = `<span class="console-hint">读取失败：${escapeHtml(error.message)}</span>`;
  }
}

function updateShortState(payload) {
  const shortState = payload?.state || payload; if (!shortState) return; state.shortState = shortState;
  const interaction = shortState.interaction || {}; const caps = shortState.caps || {}; const base = caps.base_layer || {}; const fusion = caps.fusion || {};
  const intent = interaction.expression_intent || {}; const expression = interaction.expression || intent.expression || 'neutral';
  const expressionLabels = { neutral: '状态稳定', concerned: '正在关心', happy: '有点开心', tired: '能量偏低', alert: '保持警觉', surprised: '被新东西吸引' };
  const modeLabels = { companion: '陪伴', supportive: '支持', playful: '玩心', curious: '好奇', reflective: '思考', boundary: '边界' };
  setText('#state-revision', `rev ${shortState.state_revision ?? '—'}`); setText('#state-stance', interaction.stance === 'attentive' ? '在留意你' : interaction.stance || '等待互动'); setText('#state-description', `${expressionLabels[expression] || expression}${intent.mode ? ` · ${modeLabels[intent.mode] || intent.mode}` : ''}`); $('#state-expression').className = `expression-orb ${expression} ${intent.mode || ''}`;
  setText('#state-style', interaction.tts_style || 'balanced'); setText('#voice-style', interaction.tts_style || 'balanced'); setText('#state-intent', intent.pace ? `${modeLabels[intent.mode] || intent.mode || '陪伴'} · ${intent.pace} · ${Math.round(Number(intent.intensity ?? 0) * 100)}%` : '等待表达意图'); setText('#state-prosody', intent.prosody || 'warm_with_variation');
  for (const [name, value] of [['warmth', base.warmth], ['openness', base.openness], ['arousal', fusion.arousal]]) { const normalized = Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : null; setText(`#${name}-value`, normalized == null ? '—' : `${Math.round(normalized * 100)}%`); const meter = $(`#${name}-meter`); if (meter) meter.style.width = normalized == null ? '0%' : `${Math.round(normalized * 100)}%`; }
  const shaping = state.world?.shaping_field; setText('#state-field', shaping?.light_field ? `背景参数 · ${shaping.light_field}` : '背景参数 · 待观测'); $('#state-raw').textContent = JSON.stringify(shortState, null, 2);
}
function updateExpressionIntent(intent) {
  if (!intent || typeof intent !== 'object') return;
  const expression = intent.expression || state.shortState?.interaction?.expression || 'neutral';
  const modeLabels = { companion: '陪伴', supportive: '支持', playful: '玩心', curious: '好奇', reflective: '思考', boundary: '边界', attentive: '专注' };
  $('#state-expression').className = `expression-orb ${expression} ${intent.mode || ''}`;
  setText('#state-intent', `${modeLabels[intent.mode] || intent.mode || '陪伴'} · ${intent.pace || 'natural'} · ${Math.round(Number(intent.intensity ?? 0) * 100)}%`);
  setText('#state-prosody', intent.prosody || 'warm_with_variation');
  setText('#voice-style', intent.prosody || state.shortState?.interaction?.tts_style || 'balanced');
}
function updateVoice(payload) { state.voice = payload; const available = payload && !payload.error && payload.status !== 'unavailable'; const pill = $('#voice-pill'); pill.className = `mini-pill ${available ? 'ok' : 'muted'}`; pill.textContent = available ? '已连接' : '未配置'; setText('#voice-description', available ? '语音 sidecar 已连接，可在有输出设备后试听。' : '暂时没有音频输出接口；语音层保留为可插拔计划。'); $('#voice-raw').textContent = JSON.stringify(payload || { status: 'not checked' }, null, 2); }
function appendMessage(role, text, meta = '') { emptyState?.remove(); const item = document.createElement('article'); item.className = `message ${role}`; item.innerHTML = `<div class="message-avatar">${role === 'user' ? '你' : '✦'}</div><div><div class="message-bubble">${escapeHtml(text).replaceAll('\n', '<br>')}</div>${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ''}</div>`; messageList.append(item); messageList.scrollTop = messageList.scrollHeight; return item; }
function appendPending() { emptyState?.remove(); const item = document.createElement('article'); item.className = 'message assistant pending'; item.innerHTML = '<div class="message-avatar">✦</div><div><div class="message-bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div></div>'; messageList.append(item); messageList.scrollTop = messageList.scrollHeight; return item; }
function updateTrace(turn) { if (!turn) return; const event = turn.input_event || turn.event || {}; const outputPlan = turn.output_plan || turn.planned_output_plan || []; const decision = turn.interaction_decision || null; const intent = turn.expression_intent || turn.state?.interaction?.expression_intent || outputPlan.find((entry) => entry.expression_intent)?.expression_intent || null; setText('#last-event-label', formatTime(event.occurred_at)); setText('#trace-event-id', event.event_id || '—'); setText('#trace-event-text', event.payload?.text || '—'); const speak = outputPlan.find((entry) => entry.type === 'speak'); setText('#trace-provider', `${turn.provider || 'provider —'}${turn.trace?.usage?.total_tokens ? ` · ${turn.trace.usage.total_tokens} tokens` : ''}${speak?.tts_style ? ` · tts_style=${speak.tts_style}` : ''}${intent?.mode ? ` · ${intent.mode}/${intent.pace || 'natural'}` : ''}`); setText('#trace-decision-route', decision?.route || '—'); setText('#trace-decision-reason', decision ? `${decision.reason || '—'}${turn.proactive_candidates?.length ? ` · 可选候选 ${turn.proactive_candidates.length} 条` : ''}${turn.active_role_trials?.length ? ` · 试行 ${turn.active_role_trials.map((trial) => trial.label || trial.direction_id).join('、')}` : ''}` : '未生成情境决策。'); }
function renderEventLog(events = []) { const target = $('#event-log'); target.innerHTML = events.length ? [...events].reverse().map((event) => `<div><b>${escapeHtml(event.layer || event.type || 'event')}</b> · ${escapeHtml(event.type || '')} · ${escapeHtml(event.source_kind || 'unknown')} · ${escapeHtml(event.payload?.text || event.event_id || '')}</div>`).join('') : '<span>还没有事件记录</span>'; }
function renderEvidenceLog(evidence = []) { const target = $('#evidence-log'); target.innerHTML = evidence.length ? evidence.map((item) => `<div><b>${escapeHtml(item.eligibility?.status || 'unknown')}</b> · ${escapeHtml(item.event_type || item.event_id || '')}</div>`).join('') : '<span>还没有证据记录</span>'; }

const ROLE_STATUS_LABELS = { proposed: '待选择', trying: '试行中', accepted: '已确认', rejected: '已拒绝', deferred: '稍后再议', archived: '已归档' };
const ROLE_DIRECTION_LABELS = { wetland_frog: '荷叶青蛙', starry_observer: '星空观察者', workshop_maker: '工坊学徒', dream_cloud: '云朵梦境生物' };

function setRoleResult(kind, title, details) {
  const target = $('#role-result');
  if (!target) return;
  target.className = `mutation-result ${kind}`;
  target.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(details)}</span>`;
}

function renderRolePulls(pulls = []) {
  state.rolePulls = Array.isArray(pulls) ? pulls : [];
  const target = $('#role-pulls');
  if (!target) return;
  const visible = state.rolePulls.filter((pull) => pull.status === 'candidate');
  $('#role-pulls-status').textContent = visible.length ? `${visible.length} 个候选` : '暂无候选';
  target.innerHTML = visible.length ? visible.map((pull) => `
    <article class="role-item candidate">
      <div class="role-item-heading"><div><span class="role-direction-id">${escapeHtml(pull.direction_id)}</span><strong>${escapeHtml(pull.label)}</strong></div><b>${escapeHtml(pull.fantasy_pull)}</b></div>
      <p>${escapeHtml(pull.life)}</p>
      <small>${escapeHtml(pull.evidence_ids?.length || 0)} 条证据 · ${escapeHtml(pull.sources?.join(' / ') || '来源未知')}</small>
      <button class="quiet-button role-action" type="button" data-role-action="propose" data-direction-id="${escapeHtml(pull.direction_id)}">提出试行</button>
    </article>
  `).join('') : '<span class="console-hint">还没有达到跨来源门槛的方向。继续生活，证据会慢慢聚合。</span>';
}

function roleActionButtons(proposal) {
  const id = escapeHtml(proposal.proposal_id);
  if (proposal.status === 'proposed' || proposal.status === 'deferred') {
    return `<div class="role-actions"><button class="quiet-button role-action" type="button" data-role-action="choose" data-role-id="${id}" data-choice="try">试一段</button><button class="quiet-button role-action" type="button" data-role-action="choose" data-role-id="${id}" data-choice="later">稍后</button><button class="quiet-button role-action" type="button" data-role-action="choose" data-role-id="${id}" data-choice="reject">不要</button></div>`;
  }
  if (proposal.status === 'trying') {
    if (!proposal.trial) return `<button class="quiet-button role-action" type="button" data-role-action="start" data-role-id="${id}">开始试行</button>`;
    const trial = proposal.trial;
    const feedback = trial.status === 'active' ? `<div class="role-actions"><button class="quiet-button role-action" type="button" data-role-action="observe" data-signal="positive" data-role-id="${id}">这方向不错</button><button class="quiet-button role-action" type="button" data-role-action="observe" data-signal="negative" data-role-id="${id}">不太像我</button></div>` : '';
    return `${feedback}<div class="role-actions"><button class="quiet-button role-action" type="button" data-role-action="complete" data-decision="accepted" data-role-id="${id}">确认方向</button><button class="quiet-button role-action" type="button" data-role-action="complete" data-decision="deferred" data-role-id="${id}">暂不确认</button><button class="quiet-button role-action" type="button" data-role-action="complete" data-decision="rejected" data-role-id="${id}">回退</button></div>`;
  }
  if (proposal.status !== 'archived') return `<button class="quiet-button role-action" type="button" data-role-action="archive" data-role-id="${id}">归档</button>`;
  return '';
}

function renderRoleProposals(proposals = []) {
  state.roleProposals = Array.isArray(proposals) ? proposals : [];
  const target = $('#role-proposals');
  if (!target) return;
  $('#role-proposals-status').textContent = state.roleProposals.length ? `${state.roleProposals.length} 条记录` : '暂无记录';
  target.innerHTML = state.roleProposals.length ? [...state.roleProposals].reverse().map((proposal) => {
    const trial = proposal.trial;
    const trialSummary = trial ? `试行 ${trial.turns_observed}/${trial.max_turns} · 正 ${trial.positive_feedback} / 负 ${trial.negative_feedback} · ${trial.status}` : '尚未开始试行';
    const overlay = trial?.status === 'active' ? { wetland_frog: '亲水、轻快、把事变成一个小动作', starry_observer: '观察细节、保留不确定性', workshop_maker: '拆解、验证、先试一块', dream_cloud: '轻盈联想、提出奇怪但低风险的选择' }[proposal.direction_id] : null;
    return `<article class="role-item proposal ${escapeHtml(proposal.status)}"><div class="role-item-heading"><div><span class="role-direction-id">${escapeHtml(proposal.direction_id)}</span><strong>${escapeHtml(proposal.label || ROLE_DIRECTION_LABELS[proposal.direction_id] || proposal.direction_id)}</strong></div><b>${escapeHtml(ROLE_STATUS_LABELS[proposal.status] || proposal.status)}</b></div><p>${escapeHtml(proposal.life || '')}</p><small>${escapeHtml(trialSummary)}</small>${overlay ? `<small class="role-overlay">当前表达覆盖：${escapeHtml(overlay)}</small>` : ''}${proposal.evidence_ids?.length ? `<small>提案证据：${escapeHtml(proposal.evidence_ids.join(', '))}</small>` : ''}<div class="role-action-slot">${roleActionButtons(proposal)}</div></article>`;
  }).join('') : '<span class="console-hint">提出方向后，它会出现在这里。接受不会自动换壳。</span>';
}

async function refreshRoleLab() {
  const results = await Promise.allSettled([
    getJson(`/api/roles/pulls?character_id=${encodeURIComponent(CHARACTER_ID)}`),
    getJson(`/api/roles/proposals?character_id=${encodeURIComponent(CHARACTER_ID)}`),
  ]);
  if (results[0].status === 'fulfilled') renderRolePulls(results[0].value.pulls || []);
  else { $('#role-pulls-status').textContent = '接口不可用'; $('#role-pulls').innerHTML = '<span class="console-hint">角色方向接口尚未启动。</span>'; }
  if (results[1].status === 'fulfilled') renderRoleProposals(results[1].value.proposals || []);
  else { $('#role-proposals-status').textContent = '接口不可用'; $('#role-proposals').innerHTML = '<span class="console-hint">角色提案接口尚未启动。</span>'; }
  const count = state.roleProposals.length;
  const pill = $('#role-pill');
  if (pill) { pill.className = `mini-pill ${count ? 'ok' : 'muted'}`; pill.textContent = count ? `${count} 条阶段记录` : '等待候选'; }
}

async function handleRoleAction(actionTarget) {
  if (state.roleBusy) return;
  state.roleBusy = true;
  actionTarget.disabled = true;
  try {
    const action = actionTarget.dataset.roleAction;
    const proposalId = actionTarget.dataset.roleId;
    let result;
    if (action === 'propose') {
      result = await postJson('/api/roles/proposals', { character_id: CHARACTER_ID, direction_id: actionTarget.dataset.directionId });
      setRoleResult('ok', '方向提案已创建', `${result.proposal.label} · 仍需明确选择是否试行`);
    } else if (action === 'choose') {
      result = await postJson(`/api/roles/proposals/${encodeURIComponent(proposalId)}/choose`, { choice: actionTarget.dataset.choice });
      if (actionTarget.dataset.choice === 'try') {
        result = await postJson(`/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/start`, { window_turns: 5 });
      }
      setRoleResult('ok', '选择已记录', `当前阶段：${ROLE_STATUS_LABELS[result.proposal?.status] || result.proposal?.status || '已更新'}`);
    } else if (action === 'start') {
      result = await postJson(`/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/start`, { window_turns: 5 });
      setRoleResult('ok', '试行已开始', `观察窗口 ${result.proposal.trial.max_turns} 回合`);
    } else if (action === 'observe') {
      const eventId = `role-feedback-${proposalId}-${Date.now()}`;
      result = await postJson(`/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/observations`, { event_id: eventId, signal: actionTarget.dataset.signal, evidence_id: `evidence-${eventId}` });
      setRoleResult('ok', '试行反馈已记录', `当前反馈：${actionTarget.dataset.signal === 'positive' ? '喜欢这个方向' : '暂时不合适'} · ${result.proposal.trial.turns_observed}/${result.proposal.trial.max_turns}`);
    } else if (action === 'complete') {
      result = await postJson(`/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/complete`, { decision: actionTarget.dataset.decision, reason: '研究台明确阶段选择' });
      setRoleResult('ok', '试行阶段已更新', `当前阶段：${ROLE_STATUS_LABELS[result.proposal.status] || result.proposal.status}`);
    } else if (action === 'archive') {
      result = await postJson(`/api/roles/proposals/${encodeURIComponent(proposalId)}/archive`, { reason: '研究台归档' });
      setRoleResult('ok', '方向已归档', '历史记录仍可回放。');
    }
    await refreshRoleLab();
  } catch (error) {
    setRoleResult('bad', '角色方向操作失败', error.message);
  } finally {
    state.roleBusy = false;
    actionTarget.disabled = false;
  }
}

async function refreshDashboard() {
  setServicePill('pending', '检查服务…');
  const results = await Promise.allSettled([getJson('/health'), getJson('/api/context'), getJson('/api/world'), getJson('/api/world/map'), getJson(`/api/state/${encodeURIComponent(CHARACTER_ID)}`), getJson('/api/voice/health'), getJson('/api/events?limit=12'), getJson('/api/evidence?limit=8'), getJson('/api/world/schema'), getJson('/api/world/mutations?limit=20'), getJson('/api/research/scenarios'), getJson('/api/research/probes'), getJson('/api/research/probe-observations?limit=50'), getJson('/api/connectors/weather/forecast'), getJson(`/api/roles/pulls?character_id=${encodeURIComponent(CHARACTER_ID)}`), getJson(`/api/roles/proposals?character_id=${encodeURIComponent(CHARACTER_ID)}`)]);
  const [health, runtimeContext, world, worldMap, shortState, voice, events, evidence, schema, mutations, scenarios, probes, probeObservations, weatherForecast, rolePulls, roleProposals] = results;
  if (health.status === 'fulfilled') setServicePill('ok', `在线 · ${health.value.version || 'Node'}`); else setServicePill('bad', '服务不可达');
  if (rolePulls.status === 'fulfilled') renderRolePulls(rolePulls.value.pulls || []);
  if (roleProposals.status === 'fulfilled') renderRoleProposals(roleProposals.value.proposals || []);
  if (weatherForecast.status === 'fulfilled') updateWeatherForecast(weatherForecast.value);
  if (worldMap.status === 'fulfilled') renderWorldMap(worldMap.value); else { $('#map-status').className = 'mini-pill warn'; $('#map-status').textContent = '地图不可用'; }
  if (runtimeContext.status === 'fulfilled') updateRuntimeContext(runtimeContext.value); else refreshRuntimeContext(); if (world.status === 'fulfilled') updateWorld(world.value.world || world.value); if (shortState.status === 'fulfilled') updateShortState(shortState.value); if (voice.status === 'fulfilled') updateVoice(voice.value); else updateVoice({ status: 'unavailable', error: voice.reason?.body?.error || 'voice_sidecar_not_configured' }); renderEventLog(events.status === 'fulfilled' ? events.value.events || [] : []); renderEvidenceLog(evidence.status === 'fulfilled' ? evidence.value.evidence || [] : []); if (schema.status === 'fulfilled') updateWorldSchema(schema.value); else { $('#schema-pill').className = 'mini-pill muted'; $('#schema-pill').textContent = '契约不可用'; } state.multisourceMutations = mutations.status === 'fulfilled' ? mutations.value.mutations || [] : []; renderMutationLedger(state.multisourceMutations); renderContextWorkbench(state.world, state.multisourceMutations); if (scenarios.status === 'fulfilled') renderScenarioCatalog(scenarios.value); else { $('#scenario-pill').className = 'mini-pill muted'; $('#scenario-pill').textContent = '场景不可用'; } if (probes.status === 'fulfilled') renderProbeCatalog(probes.value); else { $('#probe-pill').className = 'mini-pill muted'; $('#probe-pill').textContent = '探针不可用'; } renderProbeObservations(probeObservations.status === 'fulfilled' ? probeObservations.value.observations || [] : []);
}

async function submitMutation() {
  if (state.mutationBusy) return;
  state.mutationBusy = true;
  const formButton = $('#mutation-form button[type="submit"]');
  formButton.disabled = true;
  try {
    const payload = JSON.parse($('#mutation-payload').value);
    const layer = $('#mutation-layer').value;
    const eventId = $('#mutation-event-id').value.trim() || `research-${layer}-${Date.now()}`;
    const confidence = Number($('#mutation-confidence').value);
    const provider = $('#mutation-provider').value.trim() || 'research-console';
    const body = {
      event_id: eventId,
      type: 'world.mutation',
      source: 'deskbot-web-research',
      character_id: CHARACTER_ID,
      layer,
      source_kind: $('#mutation-source-kind').value,
      confidence,
      provider,
      observed_at: new Date().toISOString(),
      provenance: { interface: 'deskbot-web', mode: 'research', manually_injected: true },
      payload,
    };
    const result = await postJson('/api/event', body);
    const mutation = result.world_mutation?.mutation;
    const accepted = mutation?.observation?.accepted !== false;
    const duplicate = result.duplicate === true;
    const label = duplicate ? '重复事件，未再次应用' : accepted ? '事件已写入 canonical world' : '观测已记录，但被世界规则拒绝';
    const detail = mutation ? `${mutation.action} · ${mutation.source_kind || 'unknown'} · rev ${mutation.before_revision} → ${mutation.after_revision}${mutation.observation?.reason ? ` · ${mutation.observation.reason}` : ''}` : '事件已进入输入层，但没有改变 canonical world。';
    setMutationResult(accepted ? 'ok' : 'warn', label, detail);
    $('#mutation-event-id').value = '';
    await refreshDashboard();
  } catch (error) {
    setMutationResult('bad', error instanceof SyntaxError ? 'payload 不是有效 JSON' : '事件未被服务接受', error.message);
  } finally {
    state.mutationBusy = false;
    formButton.disabled = false;
  }
}

async function sendMessage(text) {
  if (!text || state.busy) return; state.busy = true; sendButton.disabled = true; input.disabled = true; appendMessage('user', text); const pending = appendPending(); const eventId = `web-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  try { const payload = await postJson('/api/chat', { event_id: eventId, character_id: CHARACTER_ID, source: 'deskbot-web', message: text }); pending.remove(); const turn = payload.turn || payload; const reply = turn.reply || turn.reply_event?.payload?.text || '这次没有收到可显示的回复。'; const style = turn.state?.interaction?.tts_style || turn.output_plan?.find((entry) => entry.type === 'speak')?.tts_style; const intent = turn.expression_intent || turn.state?.interaction?.expression_intent; appendMessage('assistant', reply, intent?.mode ? `表达计划 · ${intent.mode} · ${intent.pace || 'natural'}` : style ? `表达计划 · ${style}` : '表达计划 · balanced'); updateTrace(turn); if (payload.state || turn.state) updateShortState({ state: payload.state || turn.state }); if (turn.expression_intent) updateExpressionIntent(turn.expression_intent); if (payload.canonical_world?.snapshot) updateWorld(payload.canonical_world.snapshot); else if (payload.canonical_world?.world) updateWorld(payload.canonical_world.world); await refreshDashboard(); }
  catch (error) { pending.remove(); appendMessage('assistant', `这次连接没有完成：${error.message}`, '错误不会写入角色世界'); }
  finally { state.busy = false; sendButton.disabled = false; input.disabled = false; input.focus(); }
}

$('#chat-form').addEventListener('submit', (event) => { event.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; sendMessage(text); });
input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chat-form').requestSubmit(); } });
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.prompt || ''; input.focus(); }));
$('#research-toggle').addEventListener('change', (event) => document.body.classList.toggle('research-mode', event.target.checked)); refreshDashboard(); setInterval(refreshRuntimeContext, 15_000);
$('#open-context-lab').addEventListener('click', () => { document.body.classList.add('research-mode'); const toggle = $('#research-toggle'); if (toggle) toggle.checked = true; $('#context-lab').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#mutation-layer').addEventListener('change', configureMutationActions);
$('#mutation-action').addEventListener('change', configureMutationPayload);
$('#mutation-form').addEventListener('submit', (event) => { event.preventDefault(); submitMutation(); });
$('#refresh-ledger').addEventListener('click', refreshDashboard);
$('#scenario-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-scenario-id]');
  if (button) runScenario(button.dataset.scenarioId);
});
$('#worldline-new').addEventListener('click', resetWorldLineForm);
$('#open-worldline').addEventListener('click', () => {
  document.body.classList.add('research-mode');
  const toggle = $('#research-toggle');
  if (toggle) toggle.checked = true;
  $('#worldline-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#worldline-timeline').addEventListener('click', (event) => {
  const button = event.target.closest('[data-worldline-id]');
  if (button) selectWorldLineEvent(button.dataset.worldlineId);
});
$('#worldline-form').addEventListener('submit', (event) => { event.preventDefault(); submitWorldLine(); });
$('#world-map').addEventListener('click', (event) => {
  const button = event.target.closest('[data-map-location]');
  if (!button) return;
  state.mapSelectedLocationId = button.dataset.mapLocation;
  const inspector = document.querySelector('[data-game-panel="map"]');
  if (inspector) inspector.hidden = false;
  renderWorldMap(state.worldMap);
  syncGameDock();
});
$('#map-detail').addEventListener('click', (event) => {
  const button = event.target.closest('[data-travel-location]');
  if (button) travelTo(button.dataset.travelLocation);
});
document.querySelectorAll('[data-panel-target]').forEach((button) => button.addEventListener('click', () => toggleGamePanel(button.dataset.panelTarget)));
document.querySelectorAll('.panel-close').forEach((button) => button.addEventListener('click', () => {
  const panel = button.closest('[data-game-panel]');
  if (panel) panel.hidden = true;
  syncGameDock();
}));
syncGameDock();
document.querySelectorAll('.context-form').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); submitContextPanel(form); }));
$('#probe-id').addEventListener('change', configureProbePrompt);
$('#probe-form').addEventListener('submit', (event) => { event.preventDefault(); submitProbeObservation(); });
$('#refresh-probes').addEventListener('click', refreshProbeObservations);
$('#role-lab').addEventListener('click', (event) => {
  const target = event.target.closest('[data-role-action]');
  if (target) handleRoleAction(target);
});
