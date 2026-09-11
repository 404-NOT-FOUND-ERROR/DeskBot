const CHARACTER_ID = 'shaping-001';
const state = { world: null, runtimeContext: null, weatherForecast: null, shortState: null, voice: null, worldSchema: null, scenarioCatalog: null, probeCatalog: null, worldLineSelected: null, multisourceMutations: [], contextPanelBusy: {}, busy: false, mutationBusy: false, worldLineBusy: false, scenarioBusy: false, probeBusy: false };
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
  const event = world.active_event; $('#world-event').innerHTML = event ? `<span class="event-spark">◌</span><span>${escapeHtml(event.title || event.event_id || '进行中的事件')}</span>` : '<span class="event-spark">◌</span><span>当前没有进行中的世界事件</span>';
  renderWorldLine(world.world_line || {});
  const weather = world.weather?.snapshot;
  const externalItems = world.external_context?.items || [];
  const contextItems = [
    weather ? `天气 · ${weather.location || '未标注位置'} · ${weather.condition || '未标注'}${Number.isFinite(Number(weather.temperature_c)) ? ` · ${weather.temperature_c}°C` : ''}` : null,
    ...externalItems.slice(0, 3).map((item) => `${item.category || '外部事件'} · ${item.title || item.summary || item.item_id || '未命名记录'}${item.provider ? ` · ${item.provider}` : ''}`),
  ].filter(Boolean);
  $('#context-items').innerHTML = contextItems.length ? contextItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>尚未接入天气或外部事件。</span>';
  $('#world-raw').textContent = JSON.stringify(world, null, 2);
  const isCurrent = protagonist.character_id === CHARACTER_ID && world.name === '聚形域'; $('#world-warning').classList.toggle('hidden', isCurrent); setText('#character-badge', isCurrent ? (protagonist.display_name || '喵伴') : `${protagonist.display_name || '旧角色'} · 待重启`);
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
  setText('#state-revision', `rev ${shortState.state_revision ?? '—'}`); setText('#state-stance', interaction.stance === 'attentive' ? '在留意你' : interaction.stance || '等待互动'); const expression = interaction.expression || 'neutral'; setText('#state-description', expression === 'neutral' ? '状态稳定，等待下一次互动。' : `当前表达倾向：${expression}`); $('#state-expression').className = `expression-orb ${expression}`;
  setText('#state-style', interaction.tts_style || 'balanced'); setText('#voice-style', interaction.tts_style || 'balanced');
  for (const [name, value] of [['warmth', base.warmth], ['openness', base.openness], ['arousal', fusion.arousal]]) { const normalized = Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : null; setText(`#${name}-value`, normalized == null ? '—' : `${Math.round(normalized * 100)}%`); const meter = $(`#${name}-meter`); if (meter) meter.style.width = normalized == null ? '0%' : `${Math.round(normalized * 100)}%`; }
  const shaping = state.world?.shaping_field; setText('#state-field', shaping?.light_field ? `背景参数 · ${shaping.light_field}` : '背景参数 · 待观测'); $('#state-raw').textContent = JSON.stringify(shortState, null, 2);
}
function updateVoice(payload) { state.voice = payload; const available = payload && !payload.error && payload.status !== 'unavailable'; const pill = $('#voice-pill'); pill.className = `mini-pill ${available ? 'ok' : 'muted'}`; pill.textContent = available ? '已连接' : '未配置'; setText('#voice-description', available ? '语音 sidecar 已连接，可在有输出设备后试听。' : '暂时没有音频输出接口；语音层保留为可插拔计划。'); $('#voice-raw').textContent = JSON.stringify(payload || { status: 'not checked' }, null, 2); }
function appendMessage(role, text, meta = '') { emptyState?.remove(); const item = document.createElement('article'); item.className = `message ${role}`; item.innerHTML = `<div class="message-avatar">${role === 'user' ? '你' : '✦'}</div><div><div class="message-bubble">${escapeHtml(text).replaceAll('\n', '<br>')}</div>${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ''}</div>`; messageList.append(item); messageList.scrollTop = messageList.scrollHeight; return item; }
function appendPending() { emptyState?.remove(); const item = document.createElement('article'); item.className = 'message assistant pending'; item.innerHTML = '<div class="message-avatar">✦</div><div><div class="message-bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div></div>'; messageList.append(item); messageList.scrollTop = messageList.scrollHeight; return item; }
function updateTrace(turn) { if (!turn) return; const event = turn.input_event || turn.event || {}; const outputPlan = turn.output_plan || turn.planned_output_plan || []; const decision = turn.interaction_decision || null; setText('#last-event-label', formatTime(event.occurred_at)); setText('#trace-event-id', event.event_id || '—'); setText('#trace-event-text', event.payload?.text || '—'); const speak = outputPlan.find((entry) => entry.type === 'speak'); setText('#trace-provider', `${turn.provider || 'provider —'}${turn.trace?.usage?.total_tokens ? ` · ${turn.trace.usage.total_tokens} tokens` : ''}${speak?.tts_style ? ` · tts_style=${speak.tts_style}` : ''}`); setText('#trace-decision-route', decision?.route || '—'); setText('#trace-decision-reason', decision ? `${decision.reason || '—'}${turn.proactive_candidates?.length ? ` · 可选候选 ${turn.proactive_candidates.length} 条` : ''}` : '未生成情境决策。'); }
function renderEventLog(events = []) { const target = $('#event-log'); target.innerHTML = events.length ? [...events].reverse().map((event) => `<div><b>${escapeHtml(event.layer || event.type || 'event')}</b> · ${escapeHtml(event.type || '')} · ${escapeHtml(event.source_kind || 'unknown')} · ${escapeHtml(event.payload?.text || event.event_id || '')}</div>`).join('') : '<span>还没有事件记录</span>'; }
function renderEvidenceLog(evidence = []) { const target = $('#evidence-log'); target.innerHTML = evidence.length ? evidence.map((item) => `<div><b>${escapeHtml(item.eligibility?.status || 'unknown')}</b> · ${escapeHtml(item.event_type || item.event_id || '')}</div>`).join('') : '<span>还没有证据记录</span>'; }

async function refreshDashboard() {
  setServicePill('pending', '检查服务…');
  const results = await Promise.allSettled([getJson('/health'), getJson('/api/context'), getJson('/api/world'), getJson(`/api/state/${encodeURIComponent(CHARACTER_ID)}`), getJson('/api/voice/health'), getJson('/api/events?limit=12'), getJson('/api/evidence?limit=8'), getJson('/api/world/schema'), getJson('/api/world/mutations?limit=20'), getJson('/api/research/scenarios'), getJson('/api/research/probes'), getJson('/api/research/probe-observations?limit=50'), getJson('/api/connectors/weather/forecast')]);
  const [health, runtimeContext, world, shortState, voice, events, evidence, schema, mutations, scenarios, probes, probeObservations, weatherForecast] = results;
  if (health.status === 'fulfilled') setServicePill('ok', `在线 · ${health.value.version || 'Node'}`); else setServicePill('bad', '服务不可达');
  if (weatherForecast.status === 'fulfilled') updateWeatherForecast(weatherForecast.value);
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
  try { const payload = await postJson('/api/chat', { event_id: eventId, character_id: CHARACTER_ID, source: 'deskbot-web', message: text }); pending.remove(); const turn = payload.turn || payload; const reply = turn.reply || turn.reply_event?.payload?.text || '这次没有收到可显示的回复。'; const style = turn.state?.interaction?.tts_style || turn.output_plan?.find((entry) => entry.type === 'speak')?.tts_style; appendMessage('assistant', reply, style ? `表达计划 · ${style}` : '表达计划 · balanced'); updateTrace(turn); if (payload.state || turn.state) updateShortState({ state: payload.state || turn.state }); if (payload.canonical_world?.snapshot) updateWorld(payload.canonical_world.snapshot); else if (payload.canonical_world?.world) updateWorld(payload.canonical_world.world); await refreshDashboard(); }
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
document.querySelectorAll('.context-form').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); submitContextPanel(form); }));
$('#probe-id').addEventListener('change', configureProbePrompt);
$('#probe-form').addEventListener('submit', (event) => { event.preventDefault(); submitProbeObservation(); });
$('#refresh-probes').addEventListener('click', refreshProbeObservations);
