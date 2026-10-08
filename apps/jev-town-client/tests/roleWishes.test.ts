import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RoleWishes,RoleWishCard,roleWishView} from '../src/deskbot/RoleWishes.tsx';
import {respondRoleWish,fetchRoleWishes} from '../src/deskbot/bridge.ts';
import {readRoleWishesReview} from '../src/roleWishesReview.ts';
import type {RoleWishesReviewFixture} from '../src/roleWishesReview.ts';
import type {DeskBotLivedMemory,DeskBotRoleProposal,DeskBotRoleWishDirection,DeskBotRoleWishSnapshot,DeskBotRoleWishes} from '../src/deskbot/types.ts';

const oldFixture=JSON.parse(readFileSync(new URL('../public/development-facets-review.json',import.meta.url),'utf8'));
const memory=()=>structuredClone(oldFixture.samples[0].memory) as DeskBotLivedMemory;
const at='2026-10-06T04:00:00.000Z';
const direction=():DeskBotRoleWishDirection=>({direction_id:'wetland_frog',label:'荷叶青蛙',axis:'form',authored_reason:'这几天我主动回到水边，也实际照看过苗床，想准备试试这个方向。',next_step:'先准备一次水岸生活里的实际试做。',fingerprint:'frozen-view',
  readiness:{eligible:true,barriers:[],checks:[{id:'active_days',label:'持续关注',passed:true,actual:3,required:3}]},
  basis:{scope:'direction_mapped_canonical_roots_in_window',root_outcome_ids:['task:water-once','task:water-once'],active_roots:['task:water-once'],active_days:['2026-10-04','2026-10-05','2026-10-06'],active_contexts:['observe:waterside','water-bed:nursery'],threshold_root_ids:['task:water-once'],practice_success_roots:['task:water-once'],practice_days:['2026-10-06'],invited_practice_roots:[],obligation_roots:[],condition_failure_roots:[],performance_failure_roots:[],unknown_failure_roots:[],counts:{active:3,practice_successes:1}}});
function snapshot():DeskBotRoleWishSnapshot {
  const wishes:DeskBotRoleWishes={schema:'deskbot.role-wishes.v1',enabled:true,character_id:memory().owner_id,at,evidence_revision:1,window:{days:14,from:'2026-09-22T04:00:00.000Z',until:at,time_zone:'Asia/Shanghai'},fingerprint:'view',directions:[direction()]};
  return {evolution:{schema:'deskbot.role-evolution-snapshot.v0.4',wishes},proposals:[]};
}
const proposal=(status='proposed'):DeskBotRoleProposal=>({proposal_id:'wish-frog',direction_id:'wetland_frog',label:'荷叶青蛙',axis:'form',origin:'lived_wish',status,authored_reason:direction().authored_reason,wish_basis:direction().basis,current_gate:direction().readiness,next_step:direction().next_step});
function fixture():RoleWishesReviewFixture {const value=snapshot();return {schema:'deskbot.role-wishes-review.v1',simulated:true,live_world_untouched:true,samples:[{id:'ready',label:'准备实际试做',now:at,summary:'受控时钟与真实任务结果带来的方向。',memory:memory(),evolution:value.evolution,proposals:[proposal('prepared')]}]};}
const researchSource=readFileSync(new URL('../../deskbot-web/public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function researchFunction(name:string,context:Record<string,unknown>) {
  const start=researchSource.indexOf(`function ${name}(`);
  const from=researchSource.slice(start-6,start)==='async '?start-6:start;
  const end=researchSource.indexOf('\n}\n',start)+3;
  return runInNewContext(`${researchSource.slice(from,end)};${name}`,context);
}

afterEach(()=>vi.unstubAllGlobals());
describe('lived wishes show reasons, prerequisites and preparation without premature transformation',()=>{
  it('distinguishes combinable form and vocation, and keeps absent modules silent',()=>{
    const value=snapshot(),vocation={...direction(),direction_id:'chef',label:'厨师',axis:'vocation' as const};value.evolution.wishes!.directions.push(vocation);
    const html=renderToStaticMarkup(createElement(RoleWishes,{snapshot:value,memory:memory()}));
    for(const text of ['形态兴趣','职业愿望','可以一起长出来','荷叶青蛙','厨师','还没有正在准备的愿望'])expect(html).toContain(text);
    expect(renderToStaticMarkup(createElement(RoleWishes,{snapshot:null}))).toBe('');
    expect(roleWishView({evolution:{schema:'old'},proposals:[]})).toBe(null);
  });
  it('shows current barriers and traceable unique roots, disables preparation until actual conditions permit it',()=>{
    const p=proposal();p.current_gate={eligible:false,checks:[],barriers:[{id:'crop_absent',label:'苗床里还没有可照看的苗木',scope:'circumstance'}]};
    const before=JSON.stringify(p);
    const html=renderToStaticMarkup(createElement(RoleWishCard,{proposal:p,memory:memory(),onChoose:()=>{}}));
    expect(html).toContain('苗床里还没有可照看的苗木');
    expect(html).toMatch(/disabled="">准备实际试做/);
    expect(html.match(/<code>task:water-once<\/code>/g)).toHaveLength(1);
    expect(html).toContain('目前没有变身，也没有认定职业资格');expect(JSON.stringify(p)).toBe(before);
  });
  it('prepared, deferred, rejected and withdrawn never offer chat trials or a repeated immediate choice',()=>{
    for(const status of ['prepared','deferred','rejected','withdrawn']) {
      const p=proposal(status);p.cooldown_until='2026-10-09T04:00:00.000Z';
      const html=renderToStaticMarkup(createElement(RoleWishCard,{proposal:p,onChoose:()=>{}}));
      expect(html).not.toContain('<button');expect(html).not.toContain('确认方向');expect(html).not.toContain('试行反馈');
      if(status==='prepared')expect(html).toContain('还没有开始实际试做');
      if(['deferred','rejected'].includes(status))expect(html).toContain('新的实际经历');
    }
    const p=proposal();p.proposal_gate={eligible:false,barriers:[{id:'axis_busy',label:'同一轴已有准备中的方向'}]};
    const html=renderToStaticMarkup(createElement(RoleWishCard,{proposal:p,onChoose:()=>{}}));
    expect(html).not.toContain('disabled="">准备实际试做');expect(html).not.toContain('同一轴已有准备中的方向');
  });
  it('keeps an early prepared form visible when another axis accumulates twelve settled wishes, with bounded recent history',()=>{
    const value=snapshot();
    value.proposals=[proposal('prepared'),...Array.from({length:12},(_,index)=>({...proposal(index%2?'rejected':'deferred'),proposal_id:`chef-history-${index+1}`,direction_id:'chef',axis:'vocation' as const,label:`厨师旧想法${index+1}`}))];
    const before=JSON.stringify(value);
    const html=renderToStaticMarkup(createElement(RoleWishes,{snapshot:value,readOnly:true}));
    expect(html).toContain('荷叶青蛙 · 已准备试做');
    expect(html).toContain('还没有开始实际试做');
    expect(html).not.toContain('还没有正在准备的愿望');
    expect(html.match(/class="life-wish life-wish--(?:deferred|rejected)"/g)).toHaveLength(6);
    expect(html).toContain('厨师旧想法12');expect(html).toContain('厨师旧想法7');
    expect(html).not.toContain('厨师旧想法6');expect(JSON.stringify(value)).toBe(before);
  });
  it('validates isolated wish review data, including actual facets, and rejects malformed or writing-capable fixtures',()=>{
    const value=fixture(),before=JSON.stringify(value);expect(readRoleWishesReview(value)).toEqual(value);expect(JSON.stringify(value)).toBe(before);
    for(const change of [(v:any)=>v.simulated=false,(v:any)=>v.live_world_untouched=false,(v:any)=>v.samples.push(v.samples[0]),(v:any)=>delete v.samples[0].evolution,(v:any)=>v.samples[0].proposals[0].status='accepted',(v:any)=>v.samples[0].memory.development.facets.enabled=false]) {
      const broken=structuredClone(value);change(broken);expect(readRoleWishesReview(broken)).toBe(null);
    }
    const compatibility=fixture();compatibility.samples[0]!.evolution={schema:'new',development:{role_wishes:snapshot().evolution.wishes}};
    expect(readRoleWishesReview(compatibility)).not.toBe(null);
  });
  it('renders every generated SQLite lifecycle sample without treating preparation as an enacted trial',()=>{
    const value=JSON.parse(readFileSync(new URL('../public/role-wishes-review.json',import.meta.url),'utf8'));
    const review=readRoleWishesReview(value);expect(review).not.toBe(null);expect(review!.samples.length).toBeGreaterThanOrEqual(5);
    for(const sample of review!.samples) {
      const before=JSON.stringify(sample),html=renderToStaticMarkup(createElement(RoleWishes,{snapshot:{evolution:sample.evolution,proposals:sample.proposals},memory:sample.memory,readOnly:true}));
      expect(html).toContain('形态兴趣与职业愿望');expect(html).not.toContain('确认方向');expect(JSON.stringify(sample)).toBe(before);
      if(sample.proposals.some(p=>p.origin==='lived_wish'&&p.status==='prepared'))expect(html).toContain('还没有开始实际试做');
    }
  });
  it('reads roles separately from the living map and posts a wish response only to choose',async()=>{
    const calls:{url:string;method:string;body:unknown}[]=[];
    vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{calls.push({url:input,method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):null});return new Response(JSON.stringify(input.includes('/evolution')?snapshot().evolution:{proposals:[proposal()],proposal:proposal('prepared')}),{status:200});});
    await fetchRoleWishes('shaping-001','http://local');await respondRoleWish('wish/frog','try','http://local');
    expect(calls).toHaveLength(3);expect(calls[2]).toEqual({url:'http://local/api/roles/proposals/wish%2Ffrog/choose',method:'POST',body:{choice:'try'}});
    expect(calls.some(value=>value.url.includes('/trial/'))).toBe(false);
  });
  it('preserves the original research controls for legacy proposals while all new wish states avoid trial controls',()=>{
    const buttons=researchFunction('roleActionButtons',{escapeHtml:(s:unknown)=>String(s)});
    expect(buttons(proposal())).toContain('准备实际试做');
    for(const status of ['prepared','deferred','rejected','withdrawn'])expect(buttons(proposal(status))).toBe('');
    expect(buttons({...proposal(),origin:'legacy_input_cues'})).toContain('试一段');
    expect(buttons({...proposal('trying'),origin:undefined,trial:null})).toContain('data-role-action="start"');
    expect(buttons({...proposal('trying'),origin:undefined,trial:{status:'active'}})).toContain('data-role-action="complete"');
  });
  it('labels unstarted legacy drafts as history in the new phase, but keeps started trials and the original no-wishes mode',()=>{
    const buttons=researchFunction('roleActionButtons',{escapeHtml:(s:unknown)=>String(s)});
    for(const status of ['proposed','deferred','trying']) {
      const legacy={...proposal(status),origin:'legacy_input_cues',trial:null};
      const html=buttons(legacy,true);
      expect(html).not.toContain('data-choice="try"');expect(html).not.toContain('data-role-action="start"');
      expect(html).toContain('data-choice="later"');expect(html).toContain('data-choice="reject"');expect(html).toContain('归档历史记录');
    }
    const started={...proposal('trying'),origin:'legacy_input_cues',trial:{status:'active',started_at:at}};
    expect(buttons(started,true)).toContain('data-role-action="complete"');
    expect(buttons({...proposal(),origin:undefined},false)).toContain('data-choice="try"');
    const value=snapshot();value.proposals=[{...proposal(),origin:'legacy_input_cues'}];
    const html=renderToStaticMarkup(createElement(RoleWishes,{snapshot:value}));
    expect(html).toContain('历史方向记录；新尝试需要实际生活依据');expect(html).not.toContain('准备实际试做</button>');
    value.evolution.wishes!.enabled=false;expect(renderToStaticMarkup(createElement(RoleWishes,{snapshot:value}))).toBe('');
  });
  it('a forged old try/start action in the new phase makes no request and does not block preserving or archiving history',async()=>{
    for(const action of ['try','start','later','reject','archive']) {
      const posts:string[]=[],messages:string[]=[];
      const handle=researchFunction('handleRoleAction',{state:{roleBusy:false,roleWishesEnabled:true,roleProposals:[{...proposal(),origin:'legacy_input_cues'}]},
        postJson:async(url:string)=>{posts.push(url);return {proposal:proposal('deferred')};},refreshRoleLab:async()=>{},setRoleResult:(_kind:string,_title:string,message:string)=>messages.push(message),ROLE_STATUS_LABELS:{deferred:'稍后再议'},CHARACTER_ID:'shaping-001'});
      await handle({disabled:false,dataset:{roleAction:action==='start'||action==='archive'?action:'choose',roleId:'wish-frog',choice:action}});
      if(['try','start'].includes(action)){expect(posts).toEqual([]);expect(messages.join('')).toContain('历史方向记录');}
      else expect(posts).toHaveLength(1);
    }
  });
  it('the original research try path calls choose once for a wish and keeps the old two-call legacy flow',async()=>{
    for(const lived of [true,false]) {
      const posts:string[]=[],messages:string[]=[];
      const handle=researchFunction('handleRoleAction',{state:{roleBusy:false,roleProposals:[{...proposal(),origin:lived?'lived_wish':'legacy_input_cues'}]},
        postJson:async(url:string)=>{posts.push(url);return {proposal:{...proposal('prepared'),trial:{max_turns:5}}};},refreshRoleLab:async()=>{},setRoleResult:(_kind:string,_title:string,message:string)=>messages.push(message),ROLE_STATUS_LABELS:{prepared:'已准备試做'},CHARACTER_ID:'shaping-001'});
      await handle({disabled:false,dataset:{roleAction:'choose',roleId:'wish-frog',choice:'try'}});
      expect(posts).toEqual(lived?['/api/roles/proposals/wish-frog/choose']:['/api/roles/proposals/wish-frog/choose','/api/roles/proposals/wish-frog/trial/start']);
      if(lived)expect(messages.join('')).toContain('实际试做尚未开始');
    }
  });
});
