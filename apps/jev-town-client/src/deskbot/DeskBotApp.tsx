import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Action } from "@shared/actions.ts";
import type { Citizen } from "@shared/citizens.ts";
import type { Point } from "@shared/positions.ts";
import { mapToWorld } from "@shared/world.ts";
import { TownMap } from "../components/TownMap.tsx";
import type { LabelSpec } from "../three/sceneSpec.ts";
import { buildRoutePreview, buildTravelVisual, resolveTravelRoute, type DeskBotTravelVisual } from "./routeVisual.ts";
import { canonicalPointForLocation, canonicalRouteBetween } from "./canonicalGeometry.ts";
import { buildNpcCandidates, deskbotBaseUrl, executeCandidate, fetchDeskBotWorld, fetchWorldRoute, interactWithNpc, sendChat, travelRouteToLocation } from "./bridge.ts";
import type { DeskBotActionCandidate, DeskBotInteractionIntent, DeskBotLifeWorld, DeskBotNpc, DeskBotNpcInteractionResponse, DeskBotWorldMap, DeskBotWorldRouteResponse } from "./types.ts";
import "./deskbot.css";

const INTERACTION_ACTIONS: { intent: DeskBotInteractionIntent; label: string }[] = [
  { intent: "observe", label: "观察" },
  { intent: "greet", label: "问候" },
  { intent: "chat", label: "聊一聊" },
  { intent: "suggest", label: "交换想法" },
  { intent: "help", label: "搭手帮忙" },
  { intent: "invite", label: "尝试同行" },
];

function newInteractionId(): string {
  return `jev-town-interaction-${crypto.randomUUID()}`;
}

function newWorldEventId(prefix: string): string {
  return `jev-town-${prefix}-${crypto.randomUUID()}`;
}

interface StoryLine {
  id: string;
  speaker: string;
  text: string;
}

function numericId(value: string, offset = 0): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.abs(hash % 100000) + 1000 + offset;
}

function position(x: number, y: number): Point {
  return { x, y };
}

function formatLogicalTime(map: DeskBotWorldMap): string {
  const hours = Math.floor(map.logical_time.minute_of_day / 60).toString().padStart(2, "0");
  const minutes = (map.logical_time.minute_of_day % 60).toString().padStart(2, "0");
  return `第 ${map.logical_time.day} 天 · ${hours}:${minutes}`;
}

export function DeskBotApp() {
  const baseUrl = useMemo(deskbotBaseUrl, []);
  const [map, setMap] = useState<DeskBotWorldMap | null>(null);
  const [life, setLife] = useState<DeskBotLifeWorld | null>(null);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<DeskBotActionCandidate | null>(null);
  const [idea, setIdea] = useState("");
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [lastInteraction, setLastInteraction] = useState<DeskBotNpcInteractionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [storyLines, setStoryLines] = useState<StoryLine[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<DeskBotWorldRouteResponse | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [travelBusy, setTravelBusy] = useState(false);
  const [arrivalText, setArrivalText] = useState<string | null>(null);
  const [travelVisual, setTravelVisual] = useState<DeskBotTravelVisual | null>(null);
  const [message, setMessage] = useState("正在读取 DeskBot canonical world…");
  const interactionRetry = useRef<{ fingerprint: string; id: string } | null>(null);
  const chatRetry = useRef<{ fingerprint: string; id: string } | null>(null);
  const travelRetry = useRef<{ fingerprint: string; id: string } | null>(null);
  const routeRequest = useRef(0);

  // Async reads can finish out of order (especially while a travel animation
  // is running). Never let an older canonical revision roll the scene back.
  const applyMap = useCallback((next: DeskBotWorldMap) => {
    setMap((current) => (
      current
      && current.world_id === next.world_id
      && next.world_revision < current.world_revision
        ? current
        : next
    ));
  }, []);
  const applyLife = useCallback((next: DeskBotLifeWorld) => {
    setLife((current) => (
      current
      && current.world_revision > next.world_revision
        ? current
        : next
    ));
  }, []);
  const handlePlaceClick = useCallback((locationId: string) => {
    setSelectedPlaceId(locationId);
    setSelectedRoute(null);
    setArrivalText(null);
  }, []);

  function appendStoryLine(line: StoryLine) {
    setStoryLines((current) => [...current.filter((item) => item.id !== line.id), line].slice(-16));
  }

  const refresh = useCallback(async () => {
    try {
      const snapshot = await fetchDeskBotWorld(baseUrl);
      applyMap(snapshot.map);
      applyLife(snapshot.life);
      setMessage(`已读取 world revision ${snapshot.map.world_revision}；页面没有维护第二份世界事实。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取 DeskBot 世界");
    }
  }, [applyLife, applyMap, baseUrl]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedPlaceId || !map) {
      setSelectedRoute(null);
      setRouteBusy(false);
      return;
    }
    const selected = map.locations.find((item) => item.location_id === selectedPlaceId);
    if (!selected || selected.current) {
      setSelectedRoute(null);
      setRouteBusy(false);
      return;
    }
    let active = true;
    const requestId = ++routeRequest.current;
    setSelectedRoute(null);
    setRouteBusy(true);
    void fetchWorldRoute(selectedPlaceId, baseUrl)
      .then((result) => {
        if (!active || requestId !== routeRequest.current) return;
        if (result.world_revision !== map.world_revision) {
          applyMap(result.map);
          setSelectedRoute(null);
          return;
        }
        setSelectedRoute(result);
      })
      .catch((error) => {
        if (!active || requestId !== routeRequest.current) return;
        setMessage(error instanceof Error ? `路线读取失败：${error.message}` : "路线读取失败，请重试。 ");
      })
      .finally(() => {
        if (active && requestId === routeRequest.current) setRouteBusy(false);
      });
    return () => { active = false; };
  }, [applyMap, baseUrl, map?.world_id, map?.world_revision, selectedPlaceId]);

  // A refresh or another world mutation invalidates any in-flight visual and
  // route preview. Keeping either would make a current map look like it is
  // still travelling through the previous revision.
  useEffect(() => {
    if (travelVisual && (!map
      || travelVisual.worldRevision !== map.world_revision
      || travelVisual.worldId !== map.world_id)) {
      setTravelVisual(null);
    }
    if (selectedRoute && (!map
      || selectedRoute.world_revision !== map.world_revision
      || selectedRoute.route.world_id !== map.world_id)) {
      setSelectedRoute(null);
    }
  }, [map, selectedRoute, travelVisual]);

  const npcIds = useMemo(() => new Map(map?.npcs.map((npc) => [npc.npc_id, numericId(npc.npc_id)]) ?? []), [map]);
  const citizens = useMemo<readonly Citizen[]>(() => {
    if (!map) return [];
    const protagonistLocation = map.locations.find((item) => item.location_id === map.protagonist.location_id);
    const protagonist: Citizen = {
      id: numericId(map.protagonist.character_id, 500000),
      name: "喵呜",
      role: "聚形中的潮玩生命体",
      personality: protagonistLocation?.arrival_text || "正在观察这个持续世界。",
      homeId: "cottage_north",
      workId: "market",
      palette: 4,
      leaning: {},
    };
    return [protagonist, ...map.npcs.map((npc, index) => ({
      id: npcIds.get(npc.npc_id)!,
      name: npc.display_name,
      role: npc.role,
      personality: `${npc.temperament}；${npc.status}`,
      homeId: "cottage_north" as const,
      workId: "market" as const,
      palette: index % 6,
      leaning: {},
    }))];
  }, [map, npcIds]);

  const positions = useMemo(() => {
    const result = new Map<number, Point>();
    if (!map) return result;
    const byId = new Map(map.locations.map((location) => [location.location_id, location]));
    const protagonistLocation = byId.get(map.protagonist.location_id);
    if (protagonistLocation) {
      const point = canonicalPointForLocation(protagonistLocation);
      result.set(numericId(map.protagonist.character_id, 500000), position(point.x, point.y));
    }
    map.npcs.forEach((npc, index) => {
      const location = byId.get(npc.location_id);
      if (!location) return;
      const spread = (index - (map.npcs.length - 1) / 2) * 2.5;
      const point = canonicalPointForLocation(location);
      result.set(npcIds.get(npc.npc_id)!, position(point.x + spread, point.y + spread));
    });
    return result;
  }, [map, npcIds]);

  const labels = useMemo<readonly LabelSpec[]>(() => map?.locations.map((location) => {
    const point = canonicalPointForLocation(location);
    const world = mapToWorld(point.x, point.y);
    return {
      id: location.location_id,
      x: world.x,
      z: world.z,
      label: location.name,
      kind: location.current ? "plaza" : "landmark",
      height: 8,
    };
  }) ?? [], [map]);

  const durations = useMemo(() => {
    const result = new Map(citizens.map((item) => [item.id, 900]));
    if (travelVisual) result.set(travelVisual.citizenId, travelVisual.durationMs);
    return result;
  }, [citizens, travelVisual]);
  const actions = useMemo(() => new Map(citizens.map((item) => [item.id, null as Action | null])), [citizens]);
  const confidences = useMemo(() => new Map(citizens.map((item) => [item.id, null as number | null])), [citizens]);
  const encounters = life?.encounters ?? [];
  const encounterIds = useMemo(() => new Set(encounters.map((npc) => npc.npc_id)), [encounters]);
  const selectedNpcBase = map?.npcs.find((item) => item.npc_id === selectedNpcId) ?? encounters[0] ?? map?.npcs[0] ?? null;
  const selectedNpc: DeskBotNpc | null = selectedNpcBase
    ? encounters.find((npc) => npc.npc_id === selectedNpcBase.npc_id) ?? selectedNpcBase
    : null;
  const selectedNpcIsPresent = Boolean(selectedNpc && encounterIds.has(selectedNpc.npc_id));
  const candidates = map && selectedNpc ? buildNpcCandidates(map, selectedNpc) : [];
  const selectedPlace = map?.locations.find((location) => location.location_id === selectedPlaceId) ?? null;
  const selectedRouteSteps = selectedRoute?.route.steps ?? [];
  const selectedRouteLocations = selectedRoute?.route.locations ?? [];
  const selectedRouteIsTransfer = selectedRouteSteps.length > 1;
  const routePreview = useMemo(
    () => buildRoutePreview(selectedRoute?.route, map),
    [map, selectedRoute],
  );

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!map || !text || chatBusy) return;
    const fingerprint = text;
    const eventId = chatRetry.current?.fingerprint === fingerprint
      ? chatRetry.current.id
      : newWorldEventId("chat");
    chatRetry.current = { fingerprint, id: eventId };
    setChatBusy(true);
    setChatInput("");
    setMessage("喵呜正在听你说……");
    appendStoryLine({ id: `${eventId}:user`, speaker: "你", text });
    try {
      const result = await sendChat({
        eventId,
        characterId: map.protagonist.character_id,
        message: text,
      }, baseUrl);
      chatRetry.current = null;
      appendStoryLine({ id: `${eventId}:assistant`, speaker: "喵呜", text: result.reply });
      setMessage(result.expressionIntent?.mode
        ? `喵呜回应了 · ${result.expressionIntent.mode}${result.expressionIntent.pace ? ` · ${result.expressionIntent.pace}` : ""}`
        : "喵呜回应了；世界状态仍由 DeskBot 确认。 ");
      try {
        const snapshot = await fetchDeskBotWorld(baseUrl);
        applyMap(snapshot.map);
        applyLife(snapshot.life);
      } catch {
        setMessage("对话已完成；世界面板暂时没有刷新，稍后会自动重读。");
      }
    } catch (error) {
      setChatInput(text);
      setMessage(error instanceof Error ? `这次对话没有完成：${error.message}` : "这次对话没有完成，可以重试。");
    } finally {
      setChatBusy(false);
    }
  }

  async function confirmTravel() {
    if (!map || !selectedPlace || selectedPlace.current || travelBusy || routeBusy || !selectedRoute?.route.found || selectedRoute.route.blocked) return;
    const locationId = selectedPlace.location_id;
    const fingerprint = locationId;
    const eventId = travelRetry.current?.fingerprint === fingerprint
      ? travelRetry.current.id
      : newWorldEventId("travel");
    travelRetry.current = { fingerprint, id: eventId };
    setTravelBusy(true);
    setArrivalText(null);
    setTravelVisual(null);
    setMessage(`正在规划前往${selectedPlace.name}的路线……`);
    try {
      const result = await travelRouteToLocation({
        destinationLocationId: locationId,
        eventIdPrefix: eventId,
        reason: `从雾灯镇地图沿路线前往${selectedPlace.name}`,
      }, baseUrl, async ({ step, total, destinationName, fromLocationId, toLocationId, travelCostMinutes, presentationSpace, presentationPoints, map: stepMap }) => {
        const byId = new Map(stepMap.locations.map((location) => [location.location_id, location]));
        const from = byId.get(fromLocationId);
        const to = byId.get(toLocationId);
        const protagonistId = numericId(stepMap.protagonist.character_id, 500000);
        if (from && to) {
          const fromPoint = canonicalPointForLocation(from);
          const toPoint = canonicalPointForLocation(to);
          const fallbackRoute = canonicalRouteBetween(from, to);
          const visual = buildTravelVisual(
            protagonistId,
            fromLocationId,
            toLocationId,
            position(fromPoint.x, fromPoint.y),
            position(toPoint.x, toPoint.y),
            resolveTravelRoute(presentationPoints, fromPoint, toPoint, fallbackRoute, presentationSpace),
            step,
            total,
            destinationName,
            travelCostMinutes,
            stepMap.world_id,
            stepMap.world_revision,
          );
          setTravelVisual(visual);
          applyMap(stepMap);
          setMessage(`喵呜正在前往${selectedPlace.name} · 第 ${step}/${total} 段，下一站是${destinationName}……`);
          await new Promise<void>((resolve) => window.setTimeout(resolve, visual.durationMs));
          setTravelVisual(null);
          return;
        }
        applyMap(stepMap);
        setMessage(`喵呜正在前往${selectedPlace.name} · 第 ${step}/${total} 段，下一站是${destinationName}……`);
      });
      travelRetry.current = null;
      applyMap(result.map);
      setSelectedRoute(null);
      setSelectedPlaceId(null);
      const finalLocation = result.map.locations.find((location) => location.current);
      const arrival = finalLocation?.arrival_text || selectedPlace.arrival_text || `喵，我到${selectedPlace.name}了。`;
      setArrivalText(arrival);
      if (result.completed) {
        appendStoryLine({ id: `${eventId}:arrival`, speaker: "喵呜", text: arrival });
      }
      setTravelVisual(null);
      setMessage(result.completed ? `已抵达${selectedPlace.name}，路线共 ${result.stepsCompleted} 段。` : "旅行已暂停，请重新规划。 ");
      try {
        const snapshot = await fetchDeskBotWorld(baseUrl);
        applyMap(snapshot.map);
        applyLife(snapshot.life);
      } catch {
        setMessage(`已抵达${selectedPlace.name}；场景面板稍后自动刷新。`);
      }
    } catch (error) {
      setTravelVisual(null);
      setSelectedRoute(null);
      setMessage(error instanceof Error ? `旅行已暂停：${error.message}` : "旅行已暂停，请重新规划。 ");
      await refresh();
      setMessage(error instanceof Error ? `旅行已暂停：${error.message} 已重新读取世界。` : "旅行已暂停，已重新读取世界。 ");
    } finally {
      setTravelBusy(false);
    }
  }

  async function submitInteraction(intent: DeskBotInteractionIntent) {
    if (!selectedNpc || !selectedNpcIsPresent) return;
    const submittedIdea = intent === "suggest" ? idea.trim() : "";
    if (intent === "suggest" && !submittedIdea) {
      setMessage("先写下想交换的想法，再交给 DeskBot。");
      return;
    }
    const fingerprint = JSON.stringify([selectedNpc.npc_id, intent, submittedIdea]);
    const interactionId = interactionRetry.current?.fingerprint === fingerprint
      ? interactionRetry.current.id
      : newInteractionId();
    interactionRetry.current = { fingerprint, id: interactionId };
    setInteractionBusy(true);
    try {
      const result = await interactWithNpc({
        npcId: selectedNpc.npc_id,
        intent,
        ...(submittedIdea ? { idea: submittedIdea } : {}),
        interactionId,
      }, baseUrl);
      interactionRetry.current = null;
      setLastInteraction(result);
      applyLife(result.life);
      appendStoryLine({ id: result.interaction_id, speaker: result.npc.display_name, text: result.response });
      if (intent === "suggest") setIdea("");
      setMessage(result.duplicate
        ? "DeskBot 确认这是已记录互动的安全重试，没有重复增加关系。"
        : "NPC 已回应；这段共同经历已写入 DeskBot 世界。");
      const snapshot = await fetchDeskBotWorld(baseUrl);
      applyMap(snapshot.map);
      applyLife(result.life);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "NPC 互动没有完成；可以重试同一项互动。");
    } finally {
      setInteractionBusy(false);
    }
  }

  async function confirmCandidate() {
    if (!candidate) return;
    setBusy(true);
    try {
      const result = await executeCandidate(candidate, baseUrl);
      applyMap(result.map);
      setCandidate(null);
      setMessage(result.duplicate ? "这条事件已经执行过，DeskBot 返回了幂等结果。" : `行动已由 DeskBot 接受，canonical revision 现在是 ${result.map.world_revision}。`);
      const snapshot = await fetchDeskBotWorld(baseUrl);
      applyLife(snapshot.life);
    } catch (error) {
      setCandidate(null);
      setMessage(error instanceof Error ? error.message : "行动没有执行");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deskbot-mode">
      <header className="deskbot-mode__header">
        <div>
          <span className="deskbot-mode__eyebrow">CECILIA JEV TOWN × DESKBOT · WORLD CLIENT</span>
          <h1>{map?.settlement?.display_name ?? "雾灯镇"} · 聚形域</h1>
          <p>{map?.settlement?.narrative_anchor ?? "Jev Town 负责低多边形舞台与人物运动；DeskBot 仍是唯一世界事实来源。"}</p>
        </div>
        <div className="deskbot-mode__status">
          <strong>{map ? formatLogicalTime(map) : "等待世界"}</strong>
          <span>revision {map?.world_revision ?? "-"}</span>
          <button type="button" onClick={() => void refresh()}>重新读取</button>
        </div>
      </header>

      <main className="deskbot-mode__grid">
        <section className="deskbot-mode__stage">
          <TownMap
            citizens={citizens}
            labels={labels}
            positions={positions}
            durations={durations}
            actions={actions}
            confidences={confidences}
            focusedAction={null}
            onFocusAction={() => {}}
            onPlaceClick={handlePlaceClick}
            travelVisual={travelVisual}
            routePreview={routePreview}
          />
          <section className="deskbot-mode__story" aria-label="雾灯镇当前故事">
            <div className="deskbot-mode__story-scene">
              <span>此刻 · {map?.locations.find((location) => location.current)?.name ?? "雾灯镇"}</span>
              <h2>{life?.current_scene?.title ?? "雾灯镇的日常"}</h2>
              <p>{life?.current_scene?.narration ?? "风从镇边的水路慢慢吹来。喵呜正沿着地图看向下一个想去的地方。"}</p>
              {life?.current_scene?.sensory_cue ? <em>{life.current_scene.sensory_cue}</em> : null}
              {life?.current_scene?.opportunity ? <small>喵呜还在惦记：{life.current_scene.opportunity}（尚未发生）</small> : null}
            </div>
            {storyLines.length ? (
              <ol className="deskbot-mode__story-lines" aria-live="polite" aria-relevant="additions text">
                {storyLines.slice(-6).map((line) => (
                  <li key={line.id} className={line.speaker === "你" ? "is-user" : "is-character"}>
                    <strong>{line.speaker}</strong><p>{line.text}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            {lastInteraction?.experience ? <small className="deskbot-mode__story-note">共同经历已记入：{lastInteraction.experience.summary}</small> : null}
            {lastInteraction?.role_evidence?.direction ? <small className="deskbot-mode__story-note">角色方向线索：{lastInteraction.role_evidence.direction.label} · 观察中，尚未改变身份或外壳</small> : null}
          </section>

          {selectedPlace ? (
            <section className="deskbot-mode__place-card" aria-label={`${selectedPlace.name} 地点信息`}>
              <button className="deskbot-mode__place-close" type="button" aria-label="关闭地点信息" onClick={() => { setSelectedPlaceId(null); setSelectedRoute(null); }}>×</button>
              <span className="deskbot-mode__eyebrow">{selectedPlace.current ? "喵呜现在就在这里" : selectedRoute?.route.blocked ? "路线暂时受阻" : selectedRoute?.route.found ? (selectedRouteIsTransfer ? `需要中转 · ${selectedRouteSteps.length} 段` : "直达 · 相邻地点") : routeBusy ? "正在规划路线…" : "暂无可行路线"}</span>
              <h2>{selectedPlace.name}</h2>
              <p>{selectedPlace.description || "这里还没有留下描述。"}</p>
              {!selectedPlace.current && selectedRoute?.route.found && !selectedRoute.route.blocked ? (
                <>
                  <small>{selectedRouteIsTransfer ? "这不是不可达，而是需要沿相邻地点逐段前往。" : "当前地点与目标地点相邻，可以直接前往。"}</small>
                  {selectedRouteLocations.length > 1 ? (
                    <ol className="deskbot-mode__route-preview" aria-label="规划路线">
                      {selectedRouteLocations.map((location, index) => (
                        <li key={`${location.location_id}-${index}`} className={index === 0 ? "is-origin" : index === selectedRouteLocations.length - 1 ? "is-destination" : "is-transfer"}>
                          <span aria-hidden="true">{index + 1}</span>
                          <strong>{location.name}</strong>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  <small>预计 {selectedRoute.route.total_cost_minutes} 分钟；每一段都会重新确认世界状态。</small>
                  <button className="deskbot-mode__travel-button" type="button" disabled={travelBusy || routeBusy} onClick={() => void confirmTravel()}>
                    {travelBusy ? (selectedRouteIsTransfer ? "正在逐段前往…" : "正在前往…") : (selectedRouteIsTransfer ? `按路线前往${selectedPlace.name}` : `前往${selectedPlace.name}`)}
                  </button>
                </>
              ) : null}
              {!selectedPlace.current && selectedRoute?.route.blocked ? <small>{selectedRoute.route.blocked_reason || "当前世界事件暂时阻断旅行。"}</small> : null}
              {!selectedPlace.current && !routeBusy && selectedRoute && !selectedRoute.route.found ? <small>当前世界没有可行路线；地点仍然存在，但需要等世界状态变化后重新规划。</small> : null}
              {!selectedPlace.current && !selectedRoute && !routeBusy ? <small>正在读取从当前位置出发的路线。</small> : null}
            </section>
          ) : null}

          {arrivalText ? <div className="deskbot-mode__arrival" role="status">{arrivalText}</div> : null}

          <form className="deskbot-mode__composer" onSubmit={(event) => void submitChat(event)}>
            <label className="sr-only" htmlFor="deskbot-world-chat">和喵呜对话</label>
            <textarea
              id="deskbot-world-chat"
              rows={1}
              maxLength={2000}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="和喵呜说说话，或问问眼前的事…"
              disabled={chatBusy || !map}
            />
            <button type="submit" disabled={chatBusy || !chatInput.trim() || !map}>{chatBusy ? "正在听…" : "发送"}</button>
          </form>
        </section>

        <aside className="deskbot-mode__side">
          <section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">NPC · 来自 canonical map</span>
            <div className="deskbot-mode__npc-tabs">
              {map?.npcs.map((npc) => (
                <button key={npc.npc_id} type="button" className={selectedNpc?.npc_id === npc.npc_id ? "is-active" : ""} onClick={() => { setSelectedNpcId(npc.npc_id); setCandidate(null); }}>
                  {npc.display_name}<span>{encounterIds.has(npc.npc_id) ? "当前相遇" : "远处"}</span>
                </button>
              ))}
            </div>
            {selectedNpc ? (
              <div className="deskbot-mode__npc">
                <h2>{selectedNpc.display_name}</h2>
                <strong>{selectedNpc.status}</strong>
                <p>{selectedNpc.bio}</p>
                <small>{selectedNpc.speech_style}</small>
                {selectedNpc.relationship ? (
                  <div className="deskbot-mode__relationship" aria-label="与这个 NPC 的关系记录">
                    <span>熟悉 {selectedNpc.relationship.familiarity}</span>
                    <span>信任 {selectedNpc.relationship.trust}</span>
                    <span>相遇 {selectedNpc.relationship.encounters}</span>
                  </div>
                ) : null}
                <div className="deskbot-mode__interactions">
                  <span className="deskbot-mode__eyebrow">当面互动</span>
                  {selectedNpcIsPresent ? (
                    <>
                      <div className="deskbot-mode__interaction-actions">
                        {INTERACTION_ACTIONS.filter((action) => life?.available_interactions.includes(action.intent) ?? true).map((action) => (
                          <button key={action.intent} type="button" disabled={interactionBusy} onClick={() => void submitInteraction(action.intent)}>
                            {interactionBusy ? "正在回应…" : action.label}
                          </button>
                        ))}
                      </div>
                      <label className="deskbot-mode__idea-label" htmlFor="npc-idea">想和对方交换什么想法</label>
                      <textarea id="npc-idea" maxLength={500} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="写下一件你想和这个 NPC 一起试试的事" />
                      <small className="deskbot-mode__idea-count">{idea.length}/500</small>
                    </>
                  ) : <p className="deskbot-mode__not-present">喵呜和这位 NPC 不在同一地点。先在世界里相遇后，才能进行当面互动。</p>}
                </div>
              </div>
            ) : <p>当前没有 NPC。</p>}
          </section>

          <section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">NPC 行程候选 · 管理视图 · 尚未发生</span>
            <div className="deskbot-mode__candidates">
              {candidates.map((item) => (
                <button key={item.id} type="button" className={candidate?.id === item.id ? "is-active" : ""} onClick={() => setCandidate(item)}>
                  <strong>{item.title}</strong>
                  <span>{item.rationale}</span>
                </button>
              ))}
            </div>
            {candidate ? (
              <div className="deskbot-mode__confirm">
                <p>确认后才会写入 DeskBot。执行时会重新读取 revision、NPC 位置和邻接关系。</p>
                <button type="button" disabled={busy} onClick={() => void confirmCandidate()}>{busy ? "正在交给 DeskBot…" : "确认这次行动"}</button>
              </div>
            ) : null}
          </section>

          <section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">最近共同经历 · DeskBot 持久记录</span>
            {life?.recent_experiences.length ? (
              <ol className="deskbot-mode__experiences">
                {[...life.recent_experiences].reverse().slice(0, 5).map((experience) => (
                  <li key={experience.experience_id}>
                    <strong>{experience.npc_name ?? "世界记录"}</strong>
                    <span>{experience.summary}</span>
                    <time dateTime={experience.occurred_at}>{new Date(experience.occurred_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                  </li>
                ))}
              </ol>
            ) : <p className="deskbot-mode__empty-experiences">还没有共同经历。与同地点 NPC 互动后，记录会出现在这里。</p>}
          </section>
        </aside>
      </main>

      <footer className="deskbot-mode__footer">
        <span>{message}</span>
        <code>{baseUrl}</code>
        <a href="/">返回原 Jev Town</a>
      </footer>
    </div>
  );
}
