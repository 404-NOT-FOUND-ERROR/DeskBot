import { useCallback, useEffect, useMemo, useState } from "react";
import type { Action } from "@shared/actions.ts";
import type { Citizen } from "@shared/citizens.ts";
import type { Point } from "@shared/positions.ts";
import { mapToWorld } from "@shared/world.ts";
import { TownMap } from "../components/TownMap.tsx";
import type { LabelSpec } from "../three/sceneSpec.ts";
import { buildNpcCandidates, deskbotBaseUrl, executeCandidate, fetchDeskBotWorld } from "./bridge.ts";
import type { DeskBotActionCandidate, DeskBotLifeWorld, DeskBotNpc, DeskBotWorldMap } from "./types.ts";
import "./deskbot.css";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("正在读取 DeskBot canonical world…");

  const refresh = useCallback(async () => {
    try {
      const snapshot = await fetchDeskBotWorld(baseUrl);
      setMap(snapshot.map);
      setLife(snapshot.life);
      setMessage(`已读取 world revision ${snapshot.map.world_revision}；页面没有维护第二份世界事实。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取 DeskBot 世界");
    }
  }, [baseUrl]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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
    if (protagonistLocation) result.set(numericId(map.protagonist.character_id, 500000), position(protagonistLocation.x, protagonistLocation.y));
    map.npcs.forEach((npc, index) => {
      const location = byId.get(npc.location_id);
      if (!location) return;
      const spread = (index - (map.npcs.length - 1) / 2) * 2.5;
      result.set(npcIds.get(npc.npc_id)!, position(location.x + spread, location.y + spread));
    });
    return result;
  }, [map, npcIds]);

  const labels = useMemo<readonly LabelSpec[]>(() => map?.locations.map((location) => {
    const world = mapToWorld(location.x, location.y);
    return {
      id: location.location_id,
      x: world.x,
      z: world.z,
      label: location.name,
      kind: location.current ? "plaza" : "landmark",
      height: 8,
    };
  }) ?? [], [map]);

  const durations = useMemo(() => new Map(citizens.map((item) => [item.id, 900])), [citizens]);
  const actions = useMemo(() => new Map(citizens.map((item) => [item.id, null as Action | null])), [citizens]);
  const confidences = useMemo(() => new Map(citizens.map((item) => [item.id, null as number | null])), [citizens]);
  const selectedNpc: DeskBotNpc | null = map?.npcs.find((item) => item.npc_id === selectedNpcId) ?? map?.npcs[0] ?? null;
  const candidates = map && selectedNpc ? buildNpcCandidates(map, selectedNpc) : [];

  async function confirmCandidate() {
    if (!candidate) return;
    setBusy(true);
    try {
      const result = await executeCandidate(candidate, baseUrl);
      setMap(result.map);
      setCandidate(null);
      setMessage(result.duplicate ? "这条事件已经执行过，DeskBot 返回了幂等结果。" : `行动已由 DeskBot 接受，canonical revision 现在是 ${result.map.world_revision}。`);
      const snapshot = await fetchDeskBotWorld(baseUrl);
      setLife(snapshot.life);
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
          <h1>聚形域 · 世界观测台</h1>
          <p>Jev Town 负责低多边形舞台与人物运动；DeskBot 仍是唯一世界事实来源。</p>
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
          />
          <div className="deskbot-mode__scene-card">
            <span>此刻正在发生</span>
            <h2>{life?.current_scene?.title ?? "世界还没有生成 Scene"}</h2>
            <p>{life?.current_scene?.narration ?? "等 DeskBot 世界生活引擎给出下一段生活。"}</p>
            {life?.current_scene?.sensory_cue ? <em>{life.current_scene.sensory_cue}</em> : null}
          </div>
        </section>

        <aside className="deskbot-mode__side">
          <section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">NPC · 来自 canonical map</span>
            <div className="deskbot-mode__npc-tabs">
              {map?.npcs.map((npc) => (
                <button key={npc.npc_id} type="button" className={selectedNpc?.npc_id === npc.npc_id ? "is-active" : ""} onClick={() => { setSelectedNpcId(npc.npc_id); setCandidate(null); }}>
                  {npc.display_name}
                </button>
              ))}
            </div>
            {selectedNpc ? (
              <div className="deskbot-mode__npc">
                <h2>{selectedNpc.display_name}</h2>
                <strong>{selectedNpc.status}</strong>
                <p>{selectedNpc.bio}</p>
                <small>{selectedNpc.speech_style}</small>
              </div>
            ) : <p>当前没有 NPC。</p>}
          </section>

          <section className="deskbot-mode__panel">
            <span className="deskbot-mode__eyebrow">合法行动候选 · 尚未发生</span>
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
