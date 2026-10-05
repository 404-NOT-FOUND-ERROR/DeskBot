import type {BodyReviewRound,BodyReviewScenarioId,DeskBotBodyPerception} from './bodyTypes.ts';

const base=(value:string)=>value.replace(/\/+$/,'');
async function readResponse<T>(response:Response):Promise<T> {
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message??data?.error??`身体联调服务返回 HTTP ${response.status}`);
  if(!data)throw new Error('身体联调服务没有返回可读取的状态。');
  return data as T;
}
export async function fetchBodyPerception(baseUrl:string,signal?:AbortSignal):Promise<DeskBotBodyPerception> {
  const timeout=AbortSignal.timeout(10000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  const data=await readResponse<DeskBotBodyPerception>(await fetch(`${base(baseUrl)}/api/life/body`,{cache:'no-store',signal:requestSignal}));
  if(data.schema!=='deskbot.body-perception.v1'||!data.hardware||!data.yaw||!Array.isArray(data.turns))throw new Error('这个服务尚未启用可读取的身体感知层。');
  return data;
}
/** This endpoint exists only on the isolated fixture service, never the production world. */
export async function runBodyReviewRound(baseUrl:string,scenarioId:BodyReviewScenarioId):Promise<BodyReviewRound> {
  const data=await readResponse<BodyReviewRound>(await fetch(`${base(baseUrl)}/api/life/body/review`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario_id:scenarioId}),signal:AbortSignal.timeout(10000),
  }));
  if(data.body?.schema!=='deskbot.body-perception.v1')throw new Error('隔离服务没有返回这一轮的身体状态。');
  return data;
}
