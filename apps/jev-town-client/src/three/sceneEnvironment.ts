import type { DeskBotEnvironment } from "../deskbot/types.ts";
import { sceneTimePhaseAt } from './sceneLife.ts';

const clamp=(n:number,min=0,max=1)=>Math.min(max,Math.max(min,n));
/** No client mutation: time is interpolated only for continuous illumination. */
export function sceneEnvironmentAt(environment:DeskBotEnvironment,now=Date.now()) {
  const synced=Date.parse(environment.time.synced_at ?? environment.projected_at);
  const elapsed=environment.time.mode==="real_time" && Number.isFinite(synced) ? Math.max(0,now-synced)/60000 : 0;
  const minute=((environment.time.minute_of_day+elapsed)%1440+1440)%1440;
  const smooth=(t:number)=>{const x=clamp(t);return x*x*(3-2*x);};
  const daylight=minute<330 || minute>=1140 ? 0 : minute<420 ? smooth((minute-330)/90) : minute>=1050 ? 1-smooth((minute-1050)/90) : 1;
  const expiry=Date.parse(environment.weather.expires_at??"");
  const fresh=environment.weather.status==="fresh" && Number.isFinite(expiry) && now<expiry;
  const cloud=fresh ? clamp(environment.weather.cloud_cover) : 0;
  const wind=fresh && Number.isFinite(environment.weather.wind_mps) ? clamp(environment.weather.wind_mps!,0,35) : 0;
  const twilight=minute>=330&&minute<450 ? Math.sin(clamp((minute-330)/120)*Math.PI) : minute>=1020&&minute<1140 ? Math.sin(clamp((minute-1020)/120)*Math.PI) : 0;
  return {minute,phase:sceneTimePhaseAt(minute),daylight,night:1-daylight,twilight,cloud,wind,
    precipitation:fresh ? environment.weather.precipitation : "none",
    intensity:fresh ? clamp(environment.weather.intensity) : 0,
    weatherStatus:environment.weather.status==="fresh" && !fresh ? "stale" : environment.weather.status};
}

export function environmentDescription(environment?:DeskBotEnvironment) {
  if(!environment)return "正在读取昼夜与天气";
  const view=sceneEnvironmentAt(environment);
  const phase=view.phase.label;
  const weather=view.weatherStatus==="unavailable" ? "天气未接入" : view.weatherStatus==="stale" ? "天气观测已过期" : `${environment.weather.location??""} · ${environment.weather.condition??"天气观测"}${environment.weather.wind_mps!==null ? ` · 风 ${environment.weather.wind_mps.toFixed(1)} m/s` : ""}`;
  return `${phase} · ${weather}`;
}
