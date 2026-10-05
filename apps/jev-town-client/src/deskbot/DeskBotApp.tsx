import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Action } from "@shared/actions.ts";
import type { Citizen } from "@shared/citizens.ts";
import type { Point } from "@shared/positions.ts";
import { mapToWorld } from "@shared/world.ts";
import { TownMap } from "../components/TownMap.tsx";
import type { LabelSpec } from "../three/sceneSpec.ts";
import { buildRoutePreview, buildTravelVisual, resolveTravelRoute, type DeskBotTravelVisual } from "./routeVisual.ts";
import { canonicalPointForLocation, canonicalRouteBetween } from "./canonicalGeometry.ts";
import { buildNpcCandidates, controlWorldTask, controlAutonomousLife, respondSocialInvitation, suggestLifeIdea, deskbotBaseUrl, executeCandidate, fetchDeskBotWorld, fetchWorldRoute, interactWithNpc, sendChat, travelRouteToLocation, startLivingActivity, transferResource } from "./bridge.ts";
import type { DeskBotActionCandidate, DeskBotInteractionIntent, DeskBotLifeWorld, DeskBotNpc, DeskBotNpcInteractionResponse, DeskBotWorldMap, DeskBotWorldRouteResponse } from "./types.ts";
import "./deskbot.css";
import { LifeSidebar } from "./LifeSidebar.tsx";
import {projectSceneActivities} from './activityProjection.ts';
import {activeActorTask,taskDisplayTitle,taskTimeLabel,worldGlance} from './lifeGlance.ts';

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

export function DeskBotApp() {
  const baseUrl = useMemo(deskbotBaseUrl, []);
  const [npcSelectionRequest,setNpcSelectionRequest]=useState(0);
  const suggestionRetry=useRef<{fingerprint:string;id:string}|null>(null);
  const socialRetry=useRef<{fingerprint:string;id:string}|null>(null);
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
  const [placeFocusRequest,setPlaceFocusRequest]=useState(0);
  const [selectedRoute, setSelectedRoute] = useState<DeskBotWorldRouteResponse | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [travelBusy, setTravelBusy] = useState(false);
  const [arrivalText, setArrivalText] = useState<string | null>(null);
  const [travelVisual, setTravelVisual] = useState<DeskBotTravelVisual | null>(null);
  const [message, setMessage] = useState("正在连接雾灯镇…");
  const interactionRetry = useRef<{ fingerprint: string; id: string } | null>(null);
  const chatRetry = useRef<{ fingerprint: string; id: string } | null>(null);
  const travelRetry = useRef<{ fingerprint: string; id: string } | null>(null);
  const livingRetry=useRef<{fingerprint:string;id:string}|null>(null);
  const routeRequest = useRef(0);
  const observedTask = useRef<{ id: string; status: string } | null>(null);
  const currentTask = map?.tasks?.find(task => task.actor_id === map.protagonist.character_id && ["running", "paused"].includes(task.status));
  const travelling = currentTask?.kind === "travel";
  const ownLife=map?.autonomy?.actors.find(actor=>actor.actor_id===map.protagonist.character_id);
  const taskTitle = currentTask ? taskDisplayTitle(map,currentTask) : undefined;
  const glance=worldGlance(map);
  const sceneActivities=useMemo(()=>projectSceneActivities(map),[map]);

  useEffect(() => {
    const previous = observedTask.current;
    const task = previous ? map?.tasks?.find(task => task.task_id === previous.id) : null;
    if (previous && task?.status === "completed" && previous.status !== "completed" && task.kind === "travel") {
      const place = map?.locations.find(place => place.location_id === task.destination_location_id);
      setArrivalText(place?.arrival_text || `我到${place?.name ?? "目的地"}了。`);
      setMessage(`已抵达${place?.name ?? "目的地"}。`);
    }
    if (previous && task?.status === "failed" && previous.status !== "failed") {
      setArrivalText(null);
      setMessage(task.failure_reason === "travel_blocked" ? "道路受阻，这次出行停在上次确认的位置；可以重新选择路线。" : task.activity_id ? `${task.title}未完成：${task.failure_reason}，预留材料已归还。` : "这次活动没有完成，已保存结果；可以重新安排。");
    }
    if(previous&&task?.status==='completed'&&previous.status!=='completed'&&task.activity_id)setMessage(task.completion?.result?.text??`${task.title}完成了。`);
    observedTask.current = currentTask ? { id: currentTask.task_id, status: currentTask.status } : task ? { id: task.task_id, status: task.status } : previous;
  }, [map, currentTask]);

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
    setPlaceFocusRequest(request=>request+1);
    setSelectedRoute(null);
    setArrivalText(null);
  }, []);

  function appendStoryLine(line: StoryLine) {
    setStoryLines((current) => [...current.filter((item) => item.id !== line.id), line].slice(-16));
  }

  async function runLivingAction(activityId:string|null,objectId?:string,resource?:string,operation?:"take"|"store") {
    const fingerprint=JSON.stringify([activityId,objectId,resource,operation]);
    if(livingRetry.current?.fingerprint!==fingerprint)livingRetry.current={fingerprint,id:newWorldEventId('living')};
    setBusy(true);
    try {
      const eventId=livingRetry.current.id;
      if(activityId)await startLivingActivity(activityId,eventId,baseUrl);
      else await transferResource(objectId!,resource!,operation!,eventId,baseUrl);
      livingRetry.current=null;await refresh();setMessage(activityId?'活动已经开始，经过实际时间后会检查结果。':operation==='take'?'物品已放进随身袋。':'物品已存回这里。');
    } catch(error){setMessage(error instanceof Error?error.message:'活动未完成');}finally{setBusy(false);}
  }

  async function toggleAutonomy(){if(!ownLife)return;setBusy(true);try{await controlAutonomousLife(ownLife.paused?'resume':'pause',baseUrl);await refresh();setMessage(ownLife.paused?'喵呜恢复自行安排生活。':'下一次自发安排暂缓，手里的活动仍会继续。');}catch(error){setMessage(error instanceof Error?error.message:'更新失败');}finally{setBusy(false);}}
  async function respondInvitation(id:string,operation:'join'|'decline'|'withdraw'){const fingerprint=id+':'+operation;if(socialRetry.current?.fingerprint!==fingerprint)socialRetry.current={fingerprint,id:newWorldEventId('social')};setBusy(true);try{await respondSocialInvitation(id,operation,socialRetry.current.id,baseUrl);socialRetry.current=null;await refresh();setMessage(operation==='join'?'愿意参加，手头的事忙完再赴约。':operation==='decline'?'已经告诉对方这次不参加。':'已经告诉对方退出，实际做过的事会保存。');}catch(error){setMessage(error instanceof Error?error.message:'约定更新失败');}finally{setBusy(false);}}

  const refresh = useCallback(async () => {
    try {
      const snapshot = await fetchDeskBotWorld(baseUrl);
      applyMap(snapshot.map);
      applyLife(snapshot.life);
      setMessage("小镇的近况已更新。");
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
      personality: map.protagonist.travel_state?.status === "travelling" ? "正在路上，尚未抵达。" : protagonistLocation?.arrival_text || "正在观察这个持续世界。",
      homeId: "cottage_north",
      workId: "market",
      palette: 4,
      residentStyle: 'shaping-001',
      leaning: {},
    };
    return [protagonist, ...map.npcs.map((npc, index) => ({
      id: npcIds.get(npc.npc_id)!,
      name: npc.display_name,
      role: npc.role_label??npc.role,
      residentStyle:npc.resident_version?npc.npc_id:undefined,
      personality: `${npc.temperament}；${npc.status}`,
      homeId: "cottage_north" as const,
      workId: "market" as const,
      palette: npc.palette??index % 6,
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
    map.npcs.forEach((npc) => {
      const location = byId.get(npc.location_id);
      if (!location) return;
      const peers=map.npcs.filter(n=>n.location_id===npc.location_id),rank=peers.findIndex(n=>n.npc_id===npc.npc_id);
      const angle=rank/Math.max(1,peers.length)*Math.PI*2;
      const spreadX=peers.length>1?Math.cos(angle)*3:0,spreadY=peers.length>1?Math.sin(angle)*3:0;
      const point = canonicalPointForLocation(location);
      result.set(npcIds.get(npc.npc_id)!, position(point.x + spreadX, point.y + spreadY));
    });
    return result;
  }, [map, npcIds]);

  const labels = useMemo<readonly LabelSpec[]>(() => map?.locations.map((location) => {
    const point = location.presentation?.lot ?? canonicalPointForLocation(location);
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
  const selectedNpcTask=activeActorTask(map,selectedNpc?.npc_id);
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
    if (!map || !selectedPlace || selectedPlace.current || currentTask || travelBusy || routeBusy || !selectedRoute?.route.found || selectedRoute.route.blocked) return;
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
      if (result.pending) {
        setMessage(`喵呜已出发前往${selectedPlace.name}，途中进度会继续保存。`);
        return;
      }
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

  async function sendSuggestion(suggestion:string) {
    if(busy)return;
    if(suggestionRetry.current?.fingerprint!==suggestion)suggestionRetry.current={fingerprint:suggestion,id:newWorldEventId('suggestion')};
    setBusy(true);
    try {await suggestLifeIdea(suggestion,suggestionRetry.current.id,baseUrl);suggestionRetry.current=null;await refresh();setMessage('建议已经送达，喵呜会在下一次安排时考虑。');}
    catch(error){setMessage(error instanceof Error?error.message:'建议没有送达');}
    finally{setBusy(false);}
  }

  return (
    <div className="deskbot-mode">
      <header className="deskbot-mode__header">
        <div>
          <span className="deskbot-mode__eyebrow">THE SHAPING FIELD · 聚形域</span>
          <h1>{map?.settlement?.display_name ?? "雾灯镇"}<span>伴生世界</span></h1>
          <p>光粒聚成的生命，在这里慢慢过日子。</p>
        </div>
        <div className="deskbot-mode__status">
          <div className="deskbot-mode__clock"><span>{glance.date?`${glance.date} · 上海`:'上海 · 与现实相伴'}</span><strong>{glance.clock}</strong></div>
          <div className="deskbot-mode__weather" aria-label="当前昼夜和天气"><span className="deskbot-mode__phase"><i aria-hidden="true">{['午夜','深夜','入夜'].includes(glance.phase)?'☾':'✧'}</i>{glance.phase}</span><span title={map?.environment?.weather.wind_mps!=null&&glance.weatherState==='fresh'?`风 ${map.environment.weather.wind_mps.toFixed(1)} m/s`:undefined}>{glance.weather}{glance.temperature!==null?` ${glance.temperature}°`:''}</span></div>
          <div className="deskbot-mode__header-actions"><button type="button" disabled={!map} onClick={()=>map&&handlePlaceClick(map.protagonist.location_id)}>看看喵呜 <span aria-hidden="true">↗</span></button><button type="button" onClick={() => void refresh()} aria-label="刷新小镇近况">↻</button></div>
        </div>
      </header>

      <main className="deskbot-mode__grid">
        <section className="deskbot-mode__stage">
          <TownMap
            citizens={citizens}
            labels={labels}
            sceneLocations={map?.locations}
            environment={map?.environment}
            focusLocationId={selectedPlaceId}
            focusRequest={placeFocusRequest}
            positions={positions}
            durations={durations}
            actions={actions}
            confidences={confidences}
            focusedAction={null}
            onFocusAction={() => {}}
            onPlaceClick={handlePlaceClick}
            onCitizenClick={id=>{const npc=map?.npcs.find(n=>npcIds.get(n.npc_id)===id);if(npc){setSelectedNpcId(npc.npc_id);setNpcSelectionRequest(v=>v+1);}}}
            travelVisual={travelVisual}
            routePreview={routePreview}
            activities={sceneActivities}
          />
          <details className="deskbot-mode__story" aria-label="雾灯镇当前故事" open={storyLines.length>0?true:undefined}><summary><span>喵呜 · {map?.locations.find(l=>l.current)?.name??"雾灯镇"}</span><strong>{currentTask?taskTitle:"此刻的日常"}</strong></summary>
            <div className="deskbot-mode__story-scene">
              <span>{travelling ? "此刻 · 在路上" : `此刻 · ${map?.locations.find((location) => location.current)?.name ?? "雾灯镇"}`}</span>
              <h2>{currentTask ? taskTitle : life?.current_scene?.title ?? "雾灯镇的日常"}</h2>
              <p>{currentTask?.origin==='autonomous_life' ? ownLife?.plan?.reason : travelling ? currentTask.status === "paused" ? "这次出行暂时停下了。继续时会接着剩下的路程走。" : "喵呜还没抵达。这段路按现实时间慢慢走，关掉网页也会继续。" : life?.current_scene?.narration ?? "风从镇边的水路慢慢吹来。喵呜正沿着地图看向下一个想去的地方。"}</p>
              {!currentTask && life?.current_scene?.sensory_cue ? <em>{life.current_scene.sensory_cue}</em> : null}
              {!currentTask && life?.current_scene?.opportunity ? <small>喵呜还在惦记：{life.current_scene.opportunity}（尚未发生）</small> : null}
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
          </details>

          {selectedPlace ? (
            <section className="deskbot-mode__place-card" aria-label={`${selectedPlace.name} 地点信息`}>
              <button className="deskbot-mode__place-close" type="button" aria-label="关闭地点信息" onClick={() => { setSelectedPlaceId(null); setSelectedRoute(null); }}>×</button>
              <span className="deskbot-mode__eyebrow">{selectedPlace.current ? "喵呜现在就在这里" : selectedRoute?.route.blocked ? "路线暂时受阻" : selectedRoute?.route.found ? (selectedRouteIsTransfer ? `需要中转 · ${selectedRouteSteps.length} 段` : "直达 · 相邻地点") : routeBusy ? "正在规划路线…" : "暂无可行路线"}</span>
              <h2>{selectedPlace.name}</h2>
              {selectedPlace.areas?.some(area=>area.objects?.some(object=>object.state)) ? <div className="deskbot-mode__living-summary" aria-label="当前环境与设施">{selectedPlace.areas.flatMap(area=>area.objects??[]).filter(object=>object.state).map(object=><p key={object.object_id}><strong>{object.name}</strong><span>{object.status_text}</span></p>)}</div> : null}
              <p>{selectedPlace.description || "这里还没有留下描述。"}</p>
              <small>{map?.regions?.find(region => region.region_id === selectedPlace.region_id)?.name}</small>
              <div className="deskbot-mode__area-list" aria-label="地点内部区域">
                {selectedPlace.areas?.map(area => <details key={area.area_id}>
                  <summary>{area.name}<span>{area.access === "resident" ? "来访需同意" : "公共区域"}</span></summary>
                  <p>{area.description}</p>
                  {area.objects?.map(object => <div key={object.object_id}><strong>{object.name}</strong><p>{object.status_text??object.description}</p>
                    {object.state?.stock?<div className="deskbot-mode__stock" aria-label={`${object.name}库存`}>{Object.entries(object.state.stock).map(([resource,count])=><div key={resource}><span>{map?.living?.resource_names[resource]??resource} {Math.floor(count)} 份</span>
                      {selectedPlace.current?<><button disabled={busy||Boolean(currentTask)||count<1} onClick={()=>void runLivingAction(null,object.object_id,resource,'take')}>取 1 份</button><button disabled={busy||Boolean(currentTask)||(map?.living?.inventory.stock[resource]??0)<1} onClick={()=>void runLivingAction(null,object.object_id,resource,'store')}>存 1 份</button></>:null}</div>)}</div>:null}
                    {map?.living?.resource_renewal?.source_object_id===object.object_id?<p className="deskbot-mode__supply-note">{map.living.resource_renewal.description}</p>:null}
                  </div>)}
                </details>)}
              </div>
              <div className="deskbot-mode__living-actions" aria-label="这里的生活活动">{map?.living?.activities.filter(activity=>activity.location_id===selectedPlace.location_id).map(activity=><div key={activity.activity_id}>
                <button disabled={busy||!activity.available} onClick={()=>void runLivingAction(activity.activity_id)}>{activity.title} · {Math.ceil(activity.duration_seconds/60)} 分钟</button>
                <small>{activity.available ? activity.inputs.length?activity.inputs.map(input=>`${input.from}：${input.name} ${input.count} 份`).join('，'):'不需要材料' : activity.unavailable_reason}</small>
                {activity.output?<small>完成后：{activity.output.name} {activity.output.count} 份，放入{activity.output.to}。</small>:null}
              </div>)}</div>
              {map?.paths?.filter(path => !path.open && [path.from_location_id,path.to_location_id].includes(selectedPlace.location_id)).map(path => <small key={path.passage_id ?? `${path.from_location_id}-${path.to_location_id}`} className="deskbot-mode__closed-path">通路暂时封闭：{path.blocked_reason}</small>)}
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
                  <button className="deskbot-mode__travel-button" type="button" disabled={travelBusy || routeBusy || Boolean(currentTask)} onClick={() => void confirmTravel()}>
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

        <LifeSidebar onSuggest={id=>void sendSuggestion(id)} map={map} selectedNpcId={selectedNpc?.npc_id??null} selectionRequest={npcSelectionRequest} busy={busy} onPlace={handlePlaceClick} onSelectNpc={id=>{setSelectedNpcId(id);setCandidate(null);}} onAutonomy={()=>void toggleAutonomy()} onRespond={(id,operation)=>void respondInvitation(id,operation)} taskDetail={currentTask ? <section className="deskbot-mode__place-card" aria-label="正在进行的活动">
            <p className="deskbot-mode__task-time">{taskTimeLabel(currentTask)}</p>
            {travelling ? <small>正从{map?.locations.find(place => place.current)?.name??'上一处地点'}出发，尚未抵达。</small> : null}
            <div className="deskbot-mode__task-controls"><button type="button" disabled={busy} onClick={() => { void (async () => { setBusy(true); try { await controlWorldTask(currentTask.task_id, currentTask.status === "paused" ? "resume" : "pause", baseUrl); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "更新失败"); } finally { setBusy(false); } })(); }}>{currentTask.status === "paused" ? "继续" : "暂停"}</button>
            <button type="button" disabled={busy} onClick={() => { void (async () => { setBusy(true); try { await controlWorldTask(currentTask.task_id, "cancel", baseUrl); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "取消失败"); } finally { setBusy(false); } })(); }}>取消这次活动</button></div>
            {currentTask.activity_id?<small className="deskbot-mode__task-note">材料已备好。暂停时留着，取消或失败后会归还。</small>:null}
          </section> : null} npcDetail={<section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">这位居民的近况</span>
            {selectedNpc ? (
              <div className="deskbot-mode__npc">
                <h2>{selectedNpc.display_name}</h2>
                <strong>{selectedNpcTask?taskDisplayTitle(map,selectedNpcTask):selectedNpc.status}</strong>
                {selectedNpcTask?<small className="deskbot-mode__resident-time">{taskTimeLabel(selectedNpcTask)}</small>:null}
                <button className="life-place-link" onClick={()=>handlePlaceClick(selectedNpc.location_id)}>{map?.locations.find(l=>l.location_id===selectedNpc.location_id)?.name} ↗</button>
                <p>{selectedNpc.bio}</p>
                {selectedNpc.desires?<p>惦记：{selectedNpc.desires[0]}</p>:null}
                {selectedNpc.project?<small>长一点的愿望：{selectedNpc.project.goal} · 还在慢慢尝试</small>:null}
                {selectedNpc.relationship ? (
                  <div className="deskbot-mode__relationship" aria-label="与这位居民的关系记录">
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
                      <textarea id="npc-idea" maxLength={500} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="写下一件你想和这位居民 一起试试的事" />
                      <small className="deskbot-mode__idea-count">{idea.length}/500</small>
                    </>
                  ) : <p className="deskbot-mode__not-present">还没在同一处碰面。先到对方所在的地方，再当面聊聊。</p>}
                </div>
              </div>
            ) : <p>镇上还没有居民。</p>}
          </section>} experienceDetail={<><details className="life-settled"><summary>共同经历</summary><section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">最近一起经历的小事</span>
            {life?.recent_experiences.length ? (
              <ol className="deskbot-mode__experiences">
                {[...life.recent_experiences].reverse().slice(0, 5).map((experience) => (
                  <li key={experience.experience_id}>
                    <strong>{experience.npc_name ?? "世界记录"}</strong>
                    <span>{experience.summary}</span>
                    <time dateTime={experience.occurred_at}>{new Date(experience.occurred_at).toLocaleString("zh-CN", { timeZone:'Asia/Shanghai', month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                  </li>
                ))}
              </ol>
            ) : <p className="deskbot-mode__empty-experiences">还没有共同经历。和同一地点的居民打个招呼，日子就开始留下痕迹。</p>}
          </section></details><details className="life-settled"><summary>开发调试 · 居民行程</summary><section className="deskbot-mode__panel">
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
          </section></details></>}/>
      </main>

      <footer className="deskbot-mode__footer">
        <span>{message}</span>
        <details><summary>开发信息</summary><code>{baseUrl} · 世界版本 {map?.world_revision}</code><a href="http://127.0.0.1:4322/" target="_blank" rel="noreferrer">研究界面 ↗</a></details>
      </footer>
    </div>
  );
}
