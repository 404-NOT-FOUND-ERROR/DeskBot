import {afterEach, expect, it, vi} from 'vitest';
import {createWorldObserverClient,fetchWorldSnapshot,validateWorldSnapshot,type WorldSnapshot} from '../src/deskbot/worldObserver.ts';
import {actorMode} from '../src/deskbot/WorldRuntimeStatus.tsx';

function snapshot(revision=4, capture=1, instance='process-a'): WorldSnapshot {
  return {schema:'deskbot.world-observer-snapshot.v1',world_id:'test',world_revision:revision,sequence:revision,capture,instance_id:instance,snapshot_id:`${instance}:${capture}`,captured_at:'2026-10-19T02:00:00Z',
    map:{schema:'deskbot.world-map.v0.1',world_id:'test',world_revision:revision},
    life:{schema:'deskbot.world-life.v0.3',world_revision:revision},
    role_wishes:{world_id:'test',world_revision:revision,evolution:{},proposals:[]},
    runtime:{schema:'deskbot.world-runtime.v1',world_id:'test',world_revision:revision,actors:[],facilities:[]},
  } as unknown as WorldSnapshot;
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('fetches all read models in one HTTP response; never falls back to mismatched endpoints', async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot())));vi.stubGlobal('fetch',fetcher);
  expect((await fetchWorldSnapshot('http://local/')).world_revision).toBe(4);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![0]).toBe('http://local/api/world/snapshot');
  fetcher.mockResolvedValue(new Response('missing',{status:404}));
  await expect(fetchWorldSnapshot('http://local')).rejects.toThrow('404');expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects missing data, mixed revision, wrong world and invalid projection timestamps',()=>{
  for(const edit of [(s:WorldSnapshot)=>{s.life.world_revision++},(s:WorldSnapshot)=>{s.role_wishes.world_revision++},(s:WorldSnapshot)=>{s.map.world_id='other'},(s:WorldSnapshot)=>{s.captured_at='bad'},(s:WorldSnapshot)=>{s.sequence=-1}]){
    const s=snapshot();edit(s);expect(()=>validateWorldSnapshot(s)).toThrow();
  }
  expect(()=>validateWorldSnapshot({})).toThrow();
});

it('late old reads cannot roll back map, life or roles after a newer mutation refresh',async()=>{
  const replies:((s:WorldSnapshot)=>void)[]=[];const onChange=vi.fn();
  const client=createWorldObserverClient({read:()=>new Promise(resolve=>replies.push(resolve)),onChange});
  const a=client.refresh(),b=client.refresh();replies[1]!(snapshot(9,2));await b;replies[0]!(snapshot(4,1));await a;
  expect(client.getState().snapshot?.world_revision).toBe(9);expect(onChange).toHaveBeenCalledTimes(1);client.stop();
});

it('a restart at the same ledger head is accepted; a restored older save is explicitly held',async()=>{
  const read=vi.fn().mockResolvedValueOnce(snapshot(9,40)).mockResolvedValueOnce(snapshot(9,1,'new-process')).mockResolvedValueOnce(snapshot(4,1,'restored'));
  const client=createWorldObserverClient({read,onChange:()=>{}});await client.refresh();await client.refresh();
  expect(client.getState().snapshot?.instance_id).toBe('new-process');await client.refresh();
  expect(client.getState().status).toBe('stale');expect(client.getState().snapshot?.world_revision).toBe(9);client.stop();
});

it('same revision but newer role projection is accepted, older capture is ignored',async()=>{
  const first=snapshot(9,40),newer=snapshot(9,41);newer.role_wishes.proposals=[{proposal_id:'new'}] as WorldSnapshot['role_wishes']['proposals'];
  const read=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(newer).mockResolvedValueOnce(first);
  const client=createWorldObserverClient({read,onChange:()=>{}});await client.refresh();await client.refresh();await client.refresh();
  expect(client.getState().snapshot?.role_wishes.proposals[0]?.proposal_id).toBe('new');client.stop();
});

it('timeout retains last view, aborts read and recovers without reloading or losing chat state',async()=>{
  vi.useFakeTimers();let signal:AbortSignal|undefined;
  const read=vi.fn().mockResolvedValueOnce(snapshot()).mockImplementationOnce((s:AbortSignal)=>{signal=s;return new Promise(()=>{});}).mockResolvedValueOnce(snapshot(5,2));
  const client=createWorldObserverClient({read,onChange:()=>{},timeoutMs:100});await client.refresh();
  const pending=client.refresh();await vi.advanceTimersByTimeAsync(101);await pending;
  expect(signal?.aborted).toBe(true);expect(client.getState().status).toBe('stale');expect(client.getState().snapshot?.world_revision).toBe(4);
  await client.refresh();expect(client.getState().status).toBe('connected');expect(client.getState().snapshot?.world_revision).toBe(5);client.stop();
});

it('stopped/unmounted observer cannot publish a late response',async()=>{
  let resolve!:(s:WorldSnapshot)=>void;const changed=vi.fn();
  const client=createWorldObserverClient({read:()=>new Promise(r=>{resolve=r}),onChange:changed});const pending=client.refresh();client.stop();resolve(snapshot());await pending;
  expect(changed).not.toHaveBeenCalled();
});

it('reports an absent cognitive worker without claiming autonomous cognition is running',()=>{
  expect(actorMode({scheduler:'continuous_cognition',status:'worker_unavailable'} as never)).toContain('未启动');
  expect(actorMode({scheduler:'autonomous_life',status:'ready',decision_mode:'rules'} as never)).toBe('规则生活');
});
