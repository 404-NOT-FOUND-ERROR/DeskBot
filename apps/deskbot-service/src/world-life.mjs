import { createHash } from 'node:crypto';
import { InputError } from './input-store.mjs';
import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';

const SLOT_MS = 30 * 60 * 1000;
const NPC_ROUTINE_SLOT_MS = 2 * 60 * 60 * 1000;
const SCENE_COOLDOWN_COUNT = 2;
const LIFE_CONTENT_VERSION = 'world-life-v2';
const INTERACTION_INTENTS = Object.freeze(['observe', 'greet', 'suggest', 'help', 'invite']);
const DIRECTIONAL_INTENTS = new Set(['suggest', 'help', 'invite']);

const NPC_PROFILES = Object.freeze({
  'pathfinder-001': Object.freeze({
    npc_id: 'pathfinder-001',
    display_name: '潮痕巡路员',
    role: 'route_keeper',
    location_id: 'tidal-old-road',
    status: '正在检查退潮后的路标',
    bio: '背着缺角地图的短角巡路员。相信路线会记住走过它的人，但从不保证同一条路第二次还通向原处。',
    temperament: '谨慎、务实，对新路线有压不住的好奇心',
    speech_style: '先提醒风险，再给一条能立刻试的小路',
    accent: 'tide',
  }),
  'shade-collector-001': Object.freeze({
    npc_id: 'shade-collector-001',
    display_name: '影栖',
    role: 'afterlight_collector',
    location_id: 'backlit-grove',
    status: '正把一段旧影子卷进叶筒',
    bio: '住在逆光林地的旧光采集者，头顶像两片合拢的叶芽。它收集没有跟上主人的影子，偶尔把其中一段借给别人试穿。',
    temperament: '安静但不疏远，讨厌别人替影子决定它该像谁',
    speech_style: '句子很短，经常先观察对方的影子再回答',
    accent: 'grove',
  }),
});

const NPC_ROLE_DIRECTIONS = Object.freeze({
  route_keeper: Object.freeze({
    direction_id: 'tide_route_explorer',
    label: '潮痕探路者',
    life: '在会改变方向的路上试走、标记并分享安全岔口的生活',
    cues: Object.freeze(['路线', '岔路', '探路', '路标']),
  }),
  afterlight_collector: Object.freeze({
    direction_id: 'afterlight_wearer',
    label: '旧光试穿者',
    life: '收集不同日子的光与影子，试穿它们带来的奇异生活',
    cues: Object.freeze(['旧光', '影子', '试穿', '外壳']),
  }),
});

const NPC_ROUTINES = Object.freeze({
  'pathfinder-001': Object.freeze({
    route: Object.freeze(['tidal-old-road', 'shaping-field-desk', 'tidal-old-road', 'whisper-market', 'echo-waterside', 'backlit-grove']),
    purpose: '巡查会随生活变化的公共路线',
    offset: 0,
  }),
  'shade-collector-001': Object.freeze({
    route: Object.freeze(['backlit-grove', 'echo-waterside', 'whisper-market', 'tidal-old-road']),
    purpose: '沿途收集不属于今天的光与影子',
    offset: 1,
  }),
});

const LIFE_SCENES = Object.freeze({
  'shaping-field-desk': Object.freeze([
    Object.freeze({ id: 'desk-warm-start', bands: ['morning', 'day'], title: '桌边的光粒开始点名', narration: '底座边缘一圈光粒依次亮起，像在确认今天醒来的东西有没有少一个。', cue: '外壳底部传来很轻的机器余温', opportunity: '把昨晚留下的一件小东西收进今日旅记' }),
    Object.freeze({ id: 'desk-window-noise', bands: ['day', 'evening'], title: '桌外的声音漏进聚形域', narration: '现实桌面的键盘声被压成一串有方向的小方块，沿着桌沿往不同光域滚去。', cue: '每个声音方块都带着不同颜色的短尾巴', opportunity: '挑一个声音方块，猜它会通向哪种生活' }),
    Object.freeze({ id: 'desk-late-glow', bands: ['evening', 'night'], title: '屏幕熄下去，外壳还醒着', narration: '主屏已经暗了，外壳缝隙里的余光却还在慢慢交换今天的见闻。', cue: '房间越安静，细小的光路越清楚', opportunity: '决定把哪一件事留到明天再想' }),
  ]),
  'tidal-old-road': Object.freeze([
    Object.freeze({ id: 'road-marker-check', bands: ['morning', 'day'], title: '退潮后的路标正在重新找方向', narration: '退潮后的箭头比昨天偏了半格，几枚湿路标一边变色，一边试着对齐旧地图留下的刻痕。', cue: '湿路标每被碰一下就换一种蓝绿色', opportunity: '确认一条只走十步的试验路线', participant_overrides: Object.freeze({ 'pathfinder-001': Object.freeze({ title: '潮痕巡路员重新校准路标', narration: '退潮后的箭头比昨天偏了半格，巡路员正用缺角地图一块块比对。', opportunity: '帮巡路员确认一条只走十步的试验路线' }) }), npc_actions: Object.freeze({ 'pathfinder-001': Object.freeze({ action_name: 'recalibrate_markers', status: '正在重新校准潮痕路标' }) }) }),
    Object.freeze({ id: 'road-puddle-map', bands: ['day', 'evening'], title: '水洼拼出一张临时地图', narration: '几块水洼把天空切成不同方向，连起来刚好像一条从未登记过的小路。', cue: '水面地图会随着脚步轻轻改道', opportunity: '在地图消失前记住其中一个岔口', npc_actions: Object.freeze({ 'pathfinder-001': Object.freeze({ action_name: 'compare_puddle_map', status: '蹲在水洼边比对临时路线' }) }) }),
    Object.freeze({ id: 'road-tide-listening', bands: ['evening', 'night'], title: '旧路在涨潮前发出提示音', narration: '看不见的水线沿石缝倒数，湿路标每听见一声回响就依次熄掉一格。', cue: '石缝里传出很远的空杯回声', opportunity: '判断最后一段安全路线何时关闭', participant_overrides: Object.freeze({ 'pathfinder-001': Object.freeze({ narration: '看不见的水线沿石缝倒数，只有巡路员听得懂哪一声代表该回头。', opportunity: '问清最后一班安全路线何时关闭' }) }), npc_actions: Object.freeze({ 'pathfinder-001': Object.freeze({ action_name: 'listen_for_tide', status: '侧耳听着涨潮前的提示音' }) }) }),
  ]),
  'whisper-market': Object.freeze([
    Object.freeze({ id: 'market-unowned-trinket', bands: ['morning', 'day'], title: '无主小物开始挑选新用途', narration: '一排没有标价的小玩意把自己往路人面前挪，谁停得久，它们就向谁亮一下。', cue: '摊灯下响着细小的陶瓷碰杯声', opportunity: '替一件无主小物提出一个它没想过的用途' }),
    Object.freeze({ id: 'market-story-price', bands: ['day', 'evening'], title: '故事摊今天不收重复结局', narration: '摊主把听过的结局全部翻到背面，只收能让旧故事拐弯的新一句。', cue: '每讲完一句，灯芯就多出一种颜色', opportunity: '用一个古怪但完整的结局换取材料' }),
    Object.freeze({ id: 'market-wish-awning', bands: ['evening', 'night'], title: '没说出口的愿望挂满檐下', narration: '收摊以后，没被认领的愿望仍在檐角轻响，像一串不肯睡的风铃。', cue: '越靠近某个愿望，声音反而越轻', opportunity: '只听一个愿望，不替它决定主人' }),
  ]),
  'backlit-grove': Object.freeze([
    Object.freeze({ id: 'grove-shadow-roll', bands: ['morning', 'day'], title: '一段迟到的影子正在走完最后一步', narration: '那段影子比主人晚了整整三个动作，一只空叶筒立在旁边，安静等它自己决定什么时候收尾。', cue: '叶背一亮，地上的旧动作就重演一次', opportunity: '判断这段影子究竟迟了多久', participant_overrides: Object.freeze({ 'shade-collector-001': Object.freeze({ title: '影栖在收一段迟到的影子', narration: '那段影子比主人晚了整整三个动作，影栖正等它把最后一步走完再卷起来。', opportunity: '帮影栖判断这段影子究竟迟了多久' }) }), npc_actions: Object.freeze({ 'shade-collector-001': Object.freeze({ action_name: 'collect_late_shadow', status: '等一段迟到的影子走完最后一步' }) }) }),
    Object.freeze({ id: 'grove-light-swatch', bands: ['day', 'evening'], title: '旧日光色被摊成一排样片', narration: '不同日子的光被压成薄片，沿着树根铺开，像是在等待谁来挑一种新用途。', cue: '每片光样都带着当时的一点温度', opportunity: '选一片最不像今天的光，猜猜它来自哪里', participant_overrides: Object.freeze({ 'shade-collector-001': Object.freeze({ narration: '影栖把不同日子的光压成薄片，正在挑哪一种适合做新外壳的内衬。', opportunity: '选一片最不像今天的光，问问它来自哪里' }) }), npc_actions: Object.freeze({ 'shade-collector-001': Object.freeze({ action_name: 'sort_afterlight', status: '在给旧日光色分类' }) }) }),
    Object.freeze({ id: 'grove-second-shadow', bands: ['evening', 'night'], title: '林地里多出一层不肯重合的影子', narration: '天色变暗后，一层更淡的影子仍停在叶间；旁边放着一只空叶筒，没有谁催它靠近。', cue: '两层影子之间隔着半步距离', opportunity: '等它自己决定要不要靠近', participant_overrides: Object.freeze({ 'shade-collector-001': Object.freeze({ narration: '天色变暗后，一层更淡的影子仍停在叶间，影栖没有去抓，只在旁边放了一个空叶筒。', opportunity: '陪影栖等它自己决定要不要靠近' }) }), npc_actions: Object.freeze({ 'shade-collector-001': Object.freeze({ action_name: 'wait_for_wild_shadow', status: '守着一只空叶筒安静等待' }) }) }),
  ]),
  'echo-waterside': Object.freeze([
    Object.freeze({ id: 'waterside-old-reply', bands: ['morning', 'day'], title: '一条很久以前的回答终于靠岸', narration: '水面把一句模糊的回答推到岸边，却找不到最初问问题的人。', cue: '声音波纹碰到石头才显出文字形状', opportunity: '猜一猜它原本在回答什么问题' }),
    Object.freeze({ id: 'waterside-voice-drift', bands: ['day', 'evening'], title: '几句陌生声音在浅水里并排行走', narration: '它们互相不认识，却因为速度相同暂时组成了一小队。', cue: '每句话脚下都有一圈不会打湿岸边的水纹', opportunity: '跟其中一句同行一小段，不追问主人' }),
    Object.freeze({ id: 'waterside-night-message', bands: ['evening', 'night'], title: '夜色替一条留言藏起署名', narration: '水面保留了内容，却把名字折进最深的一层回声里。', cue: '只有句末还留着一点犹豫的亮光', opportunity: '留下一句不需要立刻得到回答的话' }),
  ]),
});

function hashNumber(value) {
  return Number.parseInt(createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

function timeBand(minute = 0) {
  if (minute < 6 * 60) return 'night';
  if (minute < 12 * 60) return 'morning';
  if (minute < 18 * 60) return 'day';
  if (minute < 22 * 60) return 'evening';
  return 'night';
}

function boundedIdea(value, required = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new InputError(400, 'npc_idea_required', '提出想法时需要写下具体内容');
    return null;
  }
  const result = String(value).trim();
  if (result.length > 500) throw new InputError(400, 'npc_idea_too_long', '想法最多 500 个字符');
  return result;
}

function optionalInteractionKey(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const key = String(value).trim();
  if (key.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(key)) {
    throw new InputError(400, 'invalid_interaction_id', 'interaction_id 只能包含字母、数字、点、冒号、下划线和短横线，且最多 120 个字符');
  }
  return key;
}

function sameStrings(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nextHop(world, fromLocationId, destinationId) {
  if (fromLocationId === destinationId) return destinationId;
  const locations = new Map((world.locations ?? []).map((location) => [location.location_id, location]));
  const queue = [[fromLocationId, []]];
  const seen = new Set([fromLocationId]);
  while (queue.length) {
    const [locationId, path] = queue.shift();
    for (const neighbor of locations.get(locationId)?.neighbors ?? []) {
      if (seen.has(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === destinationId) return nextPath[0] ?? null;
      seen.add(neighbor);
      queue.push([neighbor, nextPath]);
    }
  }
  return null;
}

function selectScene(world, now) {
  const locationId = world.protagonist.location_id;
  const catalog = LIFE_SCENES[locationId] ?? LIFE_SCENES['shaping-field-desk'];
  const band = timeBand(world.logical_time?.minute_of_day ?? 0);
  const preferred = catalog.filter((scene) => scene.bands.includes(band));
  const eligible = preferred.length ? preferred : catalog;
  const current = world.life?.current_scene ?? null;
  const recentlyUsed = [current, ...[...(world.life?.recent_scenes ?? [])].reverse()]
    .filter((scene) => scene?.location_id === locationId && scene.template_id)
    .map((scene) => scene.template_id)
    .filter((templateId, index, values) => values.indexOf(templateId) === index)
    .slice(0, SCENE_COOLDOWN_COUNT);
  const cooled = new Set(recentlyUsed);
  const uncooled = eligible.filter((scene) => !cooled.has(scene.id));
  const currentTemplate = current?.location_id === locationId
    ? eligible.find((scene) => scene.id === current.template_id)
    : null;
  const choices = uncooled.length ? uncooled : currentTemplate ? [currentTemplate] : eligible;
  const slot = Math.floor(now.getTime() / SLOT_MS);
  const journeyKey = world.protagonist?.travel_state?.event_id ?? 'resident';
  const eventKey = world.world_line?.latest_event?.event_id ?? 'quiet-world';
  const weatherKey = world.weather?.snapshot?.condition ?? 'no-weather';
  const selected = choices[hashNumber(`${locationId}:${world.logical_time?.day}:${slot}:${eventKey}:${weatherKey}`) % choices.length];
  const startsAt = new Date(slot * SLOT_MS).toISOString();
  const expiresAt = new Date((slot + 1) * SLOT_MS).toISOString();
  const participants = (world.npcs ?? []).filter((npc) => npc.location_id === locationId).map((npc) => npc.npc_id).sort();
  const participantOverride = participants.map((npcId) => selected.participant_overrides?.[npcId]).find(Boolean) ?? {};
  const contextSuffix = createHash('sha256')
    .update(`${LIFE_CONTENT_VERSION}:${journeyKey}:${participants.join(',')}:${selected.id}:${eventKey}:${weatherKey}`)
    .digest('hex')
    .slice(0, 6);
  const currentParticipantsMatch = sameStrings([...(current?.participants ?? [])].sort(), participants);
  const continuityKind = !current
    ? 'opening'
    : current.location_id !== locationId
      ? 'arrival'
      : !currentParticipantsMatch
        ? 'encounter_changed'
        : current.template_id === selected.id
          ? 'continued'
          : 'local_progression';
  return {
    scene_id: `life-scene:${locationId}:${slot}:${contextSuffix}`,
    template_id: selected.id,
    slot_key: String(slot),
    location_id: locationId,
    content_version: LIFE_CONTENT_VERSION,
    title: participantOverride.title ?? selected.title,
    narration: participantOverride.narration ?? selected.narration,
    sensory_cue: selected.cue,
    opportunity: participantOverride.opportunity ?? selected.opportunity,
    time_band: band,
    participants,
    source_factors: {
      logical_day: world.logical_time?.day ?? null,
      logical_minute: world.logical_time?.minute_of_day ?? null,
      weather: world.weather?.snapshot?.condition ?? null,
      world_event_id: world.world_line?.latest_event?.event_id ?? null,
    },
    continuity: {
      kind: continuityKind,
      previous_scene_id: current?.scene_id ?? null,
      previous_template_id: current?.template_id ?? null,
      previous_title: current?.title ?? null,
      cooled_template_ids: recentlyUsed,
    },
    started_at: startsAt,
    expires_at: expiresAt,
    npc_actions: selected.npc_actions ?? {},
  };
}

function profileFor(npc) {
  const profile = NPC_PROFILES[npc.npc_id] ?? {};
  return {
    ...profile,
    ...npc,
    bio: npc.bio ?? profile.bio ?? '它在聚形域里有自己的行程，目前还没有留下完整档案。',
    temperament: npc.temperament ?? profile.temperament ?? '仍在观察中',
    speech_style: npc.speech_style ?? profile.speech_style ?? '直接回应眼前的事',
    accent: npc.accent ?? profile.accent ?? 'neutral',
    relationship: {
      familiarity: npc.relationship?.familiarity ?? 0,
      trust: npc.relationship?.trust ?? 0,
      encounters: npc.relationship?.encounters ?? 0,
    },
  };
}

function npcResponse(npc, intent, idea) {
  const quoted = idea ? `“${idea.slice(0, 80)}${idea.length > 80 ? '……' : ''}”` : '';
  if (npc.role === 'route_keeper') {
    return {
      observe: `${npc.display_name}没有抬头，只把一枚湿路标转向你：“先看脚下。路今天往哪边拐，还没完全决定。”`,
      greet: `${npc.display_name}用缺角地图碰了碰额前的短角：“来得正好。别急着选远路，先听听最近这块石头怎么响。”`,
      suggest: `${npc.display_name}把${quoted}记在地图空白处：“能试，但先走十步。十步以后路还认，我们再往下算。”`,
      help: `${npc.display_name}递来一枚会变色的小路标：“帮我盯住它。变紫就喊我，别自己追过去。”`,
      invite: `${npc.display_name}卷起地图的一角：“同行可以。你走亮处，我走湿处，谁先发现岔路谁就停。”`,
    }[intent];
  }
  if (npc.role === 'afterlight_collector') {
    return {
      observe: `${npc.display_name}先看了看你的影子，才小声说：“它今天跟得很稳。比你本人稳一点。”`,
      greet: `${npc.display_name}抱着叶筒点了一下头：“嘘。旁边这段影子还差一步才走完。”`,
      suggest: `${npc.display_name}把${quoted}对着光看了一会儿：“这个想法有影子。我先不替它定形，让它自己多走两步。”`,
      help: `${npc.display_name}分给你一只空叶筒：“不用抓。等那段旧光自己靠近，再把筒口转过去。”`,
      invite: `${npc.display_name}往林地深处让出半步：“可以同行。但遇见不肯重合的影子，先问它，不要问我。”`,
    }[intent];
  }
  return {
    observe: `${npc.display_name}注意到你的目光，停下手里的事看了过来。`,
    greet: `${npc.display_name}向你打了个招呼。`,
    suggest: `${npc.display_name}认真听完${quoted}，说会先从一件小事试起。`,
    help: `${npc.display_name}给你留出一个可以搭手的位置。`,
    invite: `${npc.display_name}答应先同行一小段。`,
  }[intent];
}

export function createWorldLife({
  now = () => new Date(),
  worldSnapshot,
  ingest,
  npcGoals = null,
  enabled = true,
} = {}) {
  if (typeof worldSnapshot !== 'function' || typeof ingest !== 'function') {
    throw new TypeError('world life needs worldSnapshot and ingest');
  }

  function seedNpcs() {
    if (!enabled) return;
    for (const seed of Object.values(NPC_PROFILES)) {
      const world = worldSnapshot();
      const existing = (world.npcs ?? []).find((npc) => npc.npc_id === seed.npc_id);
      if (existing?.bio && existing?.temperament && existing?.speech_style) continue;
      try {
        ingest({
          event_id: `world-life-v1:seed:${seed.npc_id}`,
          type: 'world.mutation',
          source: 'world-life-engine',
          source_kind: 'world_engine',
          layer: 'world_line',
          character_id: DEFAULT_CHARACTER_ID,
          occurred_at: now().toISOString(),
          payload: { action: 'upsert_npc', npc: existing ? { ...seed, location_id: existing.location_id, status: existing.status } : seed },
        });
      } catch (error) {
        if (error?.code !== 'npc_limit_reached') throw error;
      }
    }
  }

  function snapshot() {
    const world = worldSnapshot();
    const currentLocationId = world.protagonist.location_id;
    return {
      schema: 'deskbot.world-life.v0.2',
      enabled,
      world_revision: world.world_revision,
      current_location_id: currentLocationId,
      current_scene: world.life?.current_scene ?? null,
      recent_scenes: world.life?.recent_scenes ?? [],
      recent_experiences: world.life?.recent_experiences ?? [],
      encounters: (world.npcs ?? []).filter((npc) => npc.location_id === currentLocationId).map(profileFor),
      available_interactions: INTERACTION_INTENTS,
    };
  }

  function scheduleNpcRoutines() {
    if (!npcGoals || typeof npcGoals.add !== 'function' || typeof npcGoals.tick !== 'function') return;
    const timestamp = now();
    const routineSlot = Math.floor(timestamp.getTime() / NPC_ROUTINE_SLOT_MS);
    for (const [npcId, routine] of Object.entries(NPC_ROUTINES)) {
      const world = worldSnapshot();
      const npc = (world.npcs ?? []).find((item) => item.npc_id === npcId);
      if (!npc || npcGoals.reserved?.(npcId)) continue;
      const destinationId = routine.route[(routineSlot + routine.offset) % routine.route.length];
      if (!destinationId || destinationId === npc.location_id) continue;
      const hop = nextHop(world, npc.location_id, destinationId);
      if (!hop) continue;
      const destination = (world.locations ?? []).find((location) => location.location_id === hop);
      const goalId = `world-life-routine:${npcId}:${routineSlot}`;
      try {
        npcGoals.add({
          id: goalId,
          npc_id: npcId,
          purpose: routine.purpose,
          origin: 'world-life-engine',
          options: [{
            when: { kind: 'npc_status', value: npc.status },
            action_name: `travel_to_${hop}`,
            status: `刚到${destination?.name ?? hop}，正在继续自己的行程`,
            location_id: hop,
          }],
        });
      } catch (error) {
        if (!['goal_exists', 'npc_reserved'].includes(error?.code)) throw error;
      }
    }
    npcGoals.tick();
  }

  function tick({ force = false } = {}) {
    if (!enabled) return snapshot();
    seedNpcs();
    scheduleNpcRoutines();
    let world = worldSnapshot();
    const selected = selectScene(world, now());
    const current = world.life?.current_scene;
    const sameParticipants = sameStrings([...(current?.participants ?? [])].sort(), selected.participants);
    const sameContext = current
      && current.location_id === selected.location_id
      && current.template_id === selected.template_id
      && current.content_version === selected.content_version
      && sameParticipants;
    if (sameContext && current.slot_key !== selected.slot_key) {
      ingest({
        event_id: `world-life-v2:continue:${current.scene_id}:${selected.slot_key}`,
        type: 'world.mutation',
        source: 'world-life-engine',
        source_kind: 'world_engine',
        layer: 'world_line',
        character_id: DEFAULT_CHARACTER_ID,
        occurred_at: selected.started_at,
        payload: {
          action: 'continue_life_scene',
          scene_id: current.scene_id,
          slot_key: selected.slot_key,
          expires_at: selected.expires_at,
          source_factors: selected.source_factors,
          continuity: selected.continuity,
        },
      });
      world = worldSnapshot();
    } else if (!current || current.slot_key !== selected.slot_key || current.location_id !== selected.location_id || !sameContext) {
      ingest({
        event_id: `world-life-v2:scene:${selected.scene_id}`,
        type: 'world.mutation',
        source: 'world-life-engine',
        source_kind: 'world_engine',
        layer: 'world_line',
        character_id: DEFAULT_CHARACTER_ID,
        occurred_at: selected.started_at,
        payload: { action: 'set_life_scene', scene: { ...selected, npc_actions: undefined } },
      });
      world = worldSnapshot();
      for (const [npcId, action] of Object.entries(selected.npc_actions)) {
        if (!(world.npcs ?? []).some((npc) => npc.npc_id === npcId && npc.location_id === selected.location_id)) continue;
        ingest({
          event_id: `world-life-v1:npc-scene:${selected.scene_id}:${npcId}`,
          type: 'world.mutation',
          source: 'world-life-engine',
          source_kind: 'world_engine',
          layer: 'world_line',
          character_id: DEFAULT_CHARACTER_ID,
          occurred_at: selected.started_at,
          payload: { action: 'npc_action', npc_id: npcId, ...action, occurred_at: selected.started_at },
        });
      }
    }
    return snapshot();
  }

  function interact(body = {}) {
    if (!enabled) throw new InputError(409, 'world_life_disabled', '世界生活引擎尚未启用');
    const npcId = typeof body.npc_id === 'string' ? body.npc_id.trim() : '';
    const intent = typeof body.intent === 'string' ? body.intent.trim() : '';
    if (!npcId) throw new InputError(400, 'npc_id_required', 'npc_id is required');
    if (!INTERACTION_INTENTS.includes(intent)) throw new InputError(400, 'invalid_npc_intent', '不支持的 NPC 互动方式');
    const idea = boundedIdea(body.idea, intent === 'suggest');
    const world = worldSnapshot();
    const npc = (world.npcs ?? []).find((item) => item.npc_id === npcId);
    if (!npc) throw new InputError(404, 'npc_not_found', '没有找到这个 NPC');
    if (npc.location_id !== world.protagonist.location_id) {
      throw new InputError(409, 'npc_not_present', '只有与喵呜在同一地点时才能互动');
    }
    const response = npcResponse(profileFor(npc), intent, idea);
    const timestamp = now().toISOString();
    const digest = createHash('sha256').update(`${npcId}:${intent}:${idea ?? ''}`).digest('hex').slice(0, 10);
    const requestedKey = optionalInteractionKey(body.interaction_id);
    const interactionId = requestedKey
      ? `npc-interaction:${npcId}:${requestedKey}`
      : `npc-interaction:${npcId}:${now().getTime()}:${digest}`;
    const direction = DIRECTIONAL_INTENTS.has(intent) ? NPC_ROLE_DIRECTIONS[npc.role] ?? null : null;
    const location = (world.locations ?? []).find((item) => item.location_id === npc.location_id);
    const intentLabel = { observe: '观察', greet: '问候', suggest: '交换想法', help: '搭手帮忙', invite: '尝试同行' }[intent];
    const experience = {
      experience_id: interactionId,
      kind: 'npc_interaction',
      npc_name: npc.display_name,
      scene_id: world.life?.current_scene?.scene_id ?? null,
      location_id: npc.location_id,
      summary: `在${location?.name ?? npc.location_id}与${npc.display_name}${intentLabel}${idea ? `：“${idea.slice(0, 80)}${idea.length > 80 ? '……' : ''}”` : ''}`,
      occurred_at: timestamp,
      role_direction: direction,
    };
    const result = ingest({
      event_id: interactionId,
      type: 'world.mutation',
      source: body.source ?? 'deskbot-web',
      source_kind: 'user',
      layer: 'world_line',
      character_id: DEFAULT_CHARACTER_ID,
      occurred_at: timestamp,
      confidence: direction ? 0.45 : 0.3,
      payload: {
        action: 'npc_interaction',
        interaction_id: interactionId,
        npc_id: npcId,
        intent,
        idea,
        response,
        occurred_at: timestamp,
        experience,
        role_direction: direction,
      },
    });
    const mutationResult = result.worldMutation ?? result;
    return {
      schema: 'deskbot.npc-interaction-response.v0.2',
      accepted: Boolean(mutationResult.applied || mutationResult.duplicate),
      duplicate: Boolean(mutationResult.duplicate),
      interaction_id: interactionId,
      response,
      experience: (worldSnapshot().life?.recent_experiences ?? []).find((item) => item.experience_id === interactionId) ?? null,
      role_evidence: direction ? { status: 'observing', confidence: 0.45, direction } : null,
      npc: profileFor((worldSnapshot().npcs ?? []).find((item) => item.npc_id === npcId)),
      life: snapshot(),
    };
  }

  return { tick, snapshot, interact, seedNpcs };
}

export { INTERACTION_INTENTS, LIFE_CONTENT_VERSION, LIFE_SCENES, NPC_PROFILES, NPC_ROLE_DIRECTIONS, NPC_ROUTINES, NPC_ROUTINE_SLOT_MS, SCENE_COOLDOWN_COUNT, SLOT_MS };
