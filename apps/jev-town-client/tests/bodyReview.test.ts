import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {BodyStatus,bodyConnectionLabel} from '../src/deskbot/BodyStatus.tsx';
import {BodyTurnDetail,bodyCommandLabel} from '../src/deskbot/BodyTurnDetail.tsx';
import {BodyReviewPanel,createBodyReviewFeed} from '../src/deskbot/BodyReviewPanel.tsx';
import {fetchBodyPerception,runBodyReviewRound} from '../src/deskbot/bodyBridge.ts';
import type {DeskBotBodyPerception,DeskBotBodyTurn} from '../src/deskbot/bodyTypes.ts';

const at='2026-10-05T12:00:00Z';
const body=():DeskBotBodyPerception=>({schema:'deskbot.body-perception.v1',installed_at:at,revision:0,character_id:'shaping-001',hardware:{camera:false,locomotion:false,yaw_degrees_of_freedom:1,yaw_limit_degrees:60},attention:null,last_sound_direction:null,shell:null,yaw:{actual_degrees:null,reported_degrees:null,feedback_kind:'unknown',last_ack_at:null,device_id:null,status:'unknown'},turns:[],connection:{devices:[],hardware_verified:false}});
const turn=():DeskBotBodyTurn=>({turn_id:'body:fixture-input',event_id:'fixture-input',device_id:'fixture-device',kind:'sound_direction',observed_at:at,received_at:at,expires_at:'2026-10-05T12:05:00Z',perception_status:'observed',summary:'麦克风报告声音方向 -30°，不知道说话者是谁。',response:{text:'这边传来声音了，我还不知道是谁。',expression:'neutral',intensity:.4},execution_status:'queued',commands:[{command_id:'fixture-yaw',type:'orientation.base_yaw',status:'queued',requested_yaw_degrees:-30}],independent_evidence:false,direct_identity_change:false,simulated:false,hardware_verified:false,source_label:'绑定设备上报'});
const renderTurn=(value:DeskBotBodyTurn,model=body(),isolated=false)=>renderToStaticMarkup(createElement(BodyTurnDetail,{turn:value,body:model,isolated}));
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe('body input and execution evidence UI',()=>{
  it('does not infer a live device from an old registry record or from simulated sessions',()=>{
    const value=body();value.connection!.devices=[{device_id:'fixture',connected:false,transport:'websocket',simulated:false,capabilities:{},last_seen_at:at}];
    expect(bodyConnectionLabel(value)).toBe('尚未连接设备');
    value.connection!.devices[0]!.connected=true;value.connection!.devices[0]!.simulated=true;
    expect(bodyConnectionLabel(value)).toBe('仅模拟设备在线');
    value.connection!.devices[0]!.simulated=false;expect(bodyConnectionLabel(value)).toBe('设备已连接');
    value.connection=undefined;expect(bodyConnectionLabel(value)).toBe('设备连接未核验');
  });
  it('keeps direction uncertainty, unknown identity and stale shell recognition visible',()=>{
    const value=body();value.last_sound_direction={angle_degrees:-30,coordinate_frame:'unknown_frame',confidence:.2,speaker_identity:'unknown',observed_at:at,expires_at:at,device_id:'fixture',status:'uncertain'};
    value.shell={status:'stale',shell_id:'registered-old-shell',label:'旧登记壳',last_known_shell_id:'registered-old-shell',reason:'读数已过期',observed_at:at,expires_at:at,device_id:'fixture',hardware_verified:true};
    const html=renderToStaticMarkup(createElement(BodyStatus,{body:value}));
    expect(html).toContain('声源方向不够确定');expect(html).toContain('身份未知');expect(html).toContain('外壳识别已过期');expect(html).not.toContain('外壳：旧登记壳');expect(html).not.toContain('声源相对方向 -30°');
  });
  it('does not give an uncalibrated microphone reading the meaning of body-forward direction',()=>{
    const value=body();value.last_sound_direction={angle_degrees:-30,coordinate_frame:'unknown_frame',confidence:.9,speaker_identity:'unknown',observed_at:at,expires_at:at,device_id:'fixture',status:'fresh'};
    let html=renderToStaticMarkup(createElement(BodyStatus,{body:value}));expect(html).toContain('方向参考尚未校准');expect(html).not.toContain('声源相对正前方 -30°');
    value.last_sound_direction.coordinate_frame='calibrated_forward';html=renderToStaticMarkup(createElement(BodyStatus,{body:value}));expect(html).toContain('声源相对正前方 -30°');expect(html).toContain('身份未知');
  });
  it('keeps a prepared yaw and dispatch distinct from a completed device receipt',()=>{
    const value=turn();let html=renderTurn(value);
    expect(html).toContain('表达意图，尚不等于已执行');expect(html).toContain('-30°');expect(html).toContain('等待设备回执');expect(html).toContain('角度未实测');expect(html).not.toContain('设备报告完成');
    value.execution_status='dispatched';value.commands[0]!.status='dispatched';value.commands[0]!.dispatched_at=at;
    html=renderTurn(value);expect(html).toContain('已发往设备，等待回执');expect(html).toContain('已发送，等待回执');expect(html).not.toContain('设备报告完成');
  });
  it('labels simulated completion and failure as simulation, never confirmed physical motion',()=>{
    const value=turn();value.simulated=true;value.execution_status='simulation';value.commands[0]!.status='completed';value.commands[0]!.simulated=true;
    const before=JSON.stringify(value);let html=renderTurn(value,body(),true);
    expect(html).toContain('独立模拟输入');expect(html).toContain('模拟回执完成');expect(html).toContain('模拟回执不能确认实机角度');expect(html).not.toContain('角度反馈传感器记录');expect(html).not.toContain('设备报告完成');expect(JSON.stringify(value)).toBe(before);
    value.execution_status='failed';value.commands[0]!.status='failed';value.commands[0]!.error_code='fixture_motor_blocked';value.commands[0]!.error_message='模拟电机被阻挡。';
    html=renderTurn(value,body(),true);expect(html).toContain('模拟执行失败');expect(html).toContain('模拟电机被阻挡');expect(html).toContain('fixture_motor_blocked');
  });
  it('shows open-loop device report separately from measured angle feedback',()=>{
    const value=turn(),model=body();value.hardware_verified=true;value.execution_status='acknowledged';value.commands[0]!.status='completed';value.commands[0]!.hardware_verified=true;value.commands[0]!.verification_status='verified';
    model.yaw={actual_degrees:null,reported_degrees:-30,feedback_kind:'open_loop_report',last_ack_at:at,device_id:value.device_id,status:'acknowledged_report'};
    let html=renderTurn(value,model);expect(html).toContain('设备报告完成');expect(html).toContain('设备报告朝向 -30°');expect(html).toContain('开环角度未实测');expect(html).not.toContain('角度反馈传感器记录');
    model.yaw={...model.yaw,actual_degrees:-29,feedback_kind:'measured',status:'measured'};
    html=renderTurn(value,model);expect(html).toContain('角度反馈传感器记录 -29°');expect(html).not.toContain('设备报告朝向 -30°');
    // Even an accidentally supplied measured value in a fixture remains an isolated record.
    html=renderTurn(value,model,true);expect(html).not.toContain('角度反馈传感器记录 -29°');expect(bodyCommandLabel(value.commands[0]!,value,true)).toBe('模拟回执完成');
  });
  it('shows busy suppression and a finite attention invitation without fabricating world completion',()=>{
    const value=turn();value.kind='head_touch';value.commands=[];value.execution_status='suppressed';value.execution_reason='正在进行不可打断的工作，先保留触碰。';value.world_attention={status:'pending',expires_at:at,decision:null};
    const html=renderTurn(value);expect(html).toContain('正在进行不可打断的工作');expect(html).toContain('等手头空下来再考虑');expect(html).toContain('没有已入队的设备指令');expect(html).not.toContain('实际选择了');
  });
  it('starts the independent page in simulation and exposes no manual device ACK controls',()=>{
    const html=renderToStaticMarkup(createElement(BodyReviewPanel));
    expect(html).toContain('运行隔离模拟回合');expect(html).toContain('输入与回执来自隔离模拟服务');expect(html).toContain('没有现实移动能力');expect(html).not.toContain('/api/outbox');expect(html).not.toContain('确认设备成功');
  });
});

describe('body review bridge uses only the dedicated API boundary',()=>{
  it('refreshes the delayed simulated ACK after the fixture POST first returns dispatch',async()=>{
    vi.useFakeTimers();
    const dispatched=body(),complete=body(),input=turn();input.simulated=true;input.execution_status='dispatched';input.commands[0]!.status='dispatched';dispatched.turns=[input];complete.turns=[{...input,execution_status:'simulation',commands:[{...input.commands[0]!,status:'completed',simulated:true}]}];
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body()))).mockResolvedValueOnce(new Response(JSON.stringify({scenario_id:'sound_left',body:dispatched}))).mockResolvedValueOnce(new Response(JSON.stringify(complete)));
    vi.stubGlobal('fetch',fetchMock);const publish=vi.fn();
    const feed=createBodyReviewFeed({mode:'simulation',baseUrl:'http://127.0.0.1:4313',onBody:publish,onError:vi.fn(),onBusy:vi.fn()});
    try{
      await vi.advanceTimersByTimeAsync(0);await feed.run('sound_left');expect(publish.mock.lastCall?.[0].turns[0].execution_status).toBe('dispatched');
      await vi.advanceTimersByTimeAsync(1000);expect(publish.mock.lastCall?.[0].turns[0].execution_status).toBe('simulation');expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:4313/api/life/body');
    }finally{feed.stop();}
  });
  it('does not let a late fixture round overwrite a newly selected live read model',async()=>{
    vi.useFakeTimers();
    let finishRound:(response:Response)=>void=()=>{};const delayed=new Promise<Response>(resolve=>{finishRound=resolve;});
    const liveBody=body();liveBody.revision=37;
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body()))).mockReturnValueOnce(delayed).mockResolvedValueOnce(new Response(JSON.stringify(liveBody)));
    vi.stubGlobal('fetch',fetchMock);const publish=vi.fn(),onBusy=vi.fn();
    const oldFeed=createBodyReviewFeed({mode:'simulation',baseUrl:'http://127.0.0.1:4313',onBody:publish,onError:vi.fn(),onBusy});
    await vi.advanceTimersByTimeAsync(0);const pending=oldFeed.run('head_touch');oldFeed.stop();
    const liveFeed=createBodyReviewFeed({mode:'live',baseUrl:'http://127.0.0.1:4311',onBody:publish,onError:vi.fn(),onBusy});
    try{
      await vi.advanceTimersByTimeAsync(0);const count=publish.mock.calls.length;
      finishRound(new Response(JSON.stringify({scenario_id:'head_touch',body:body()})));await pending;
      expect(publish.mock.calls).toHaveLength(count);expect(publish.mock.lastCall?.[0].revision).toBe(37);
      await vi.advanceTimersByTimeAsync(1000);expect(fetchMock).toHaveBeenCalledTimes(3);
    }finally{liveFeed.stop();}
  });
  it('keeps a live feed read-only even if a run is requested by an outdated UI handler',async()=>{
    vi.useFakeTimers();const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify(body())));vi.stubGlobal('fetch',fetchMock);
    const feed=createBodyReviewFeed({mode:'live',baseUrl:'http://127.0.0.1:4311',onBody:vi.fn(),onError:vi.fn(),onBusy:vi.fn()});
    try{await vi.advanceTimersByTimeAsync(0);await feed.run('head_touch');expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0]?.[1]?.method).not.toBe('POST');}
    finally{feed.stop();}
  });
  it('reads body state and sends a scenario only to the isolated review endpoint',async()=>{
    const value=body(),fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(value),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({scenario_id:'head_touch',body:value}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    expect(await fetchBodyPerception('http://127.0.0.1:4311/')).toEqual(value);
    expect(await runBodyReviewRound('http://127.0.0.1:4313/','head_touch')).toMatchObject({scenario_id:'head_touch',body:value});
    expect(fetchMock.mock.calls[0]).toEqual(['http://127.0.0.1:4311/api/life/body',{cache:'no-store',signal:expect.any(AbortSignal)}]);
    expect(fetchMock.mock.calls[1]).toEqual(['http://127.0.0.1:4313/api/life/body/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario_id:'head_touch'}),signal:expect.any(AbortSignal)}]);
  });
  it('reports the absent fixture endpoint without fabricating a finished round',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'not_found',message:'隔离回合入口尚未启动'}),{status:404})));
    await expect(runBodyReviewRound('http://127.0.0.1:4313','head_touch')).rejects.toThrow('隔离回合入口尚未启动');
  });
  it('does not render a connection-only response as an installed body',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({enabled:false,connection:{devices:[],hardware_verified:false}}),{status:200})));
    await expect(fetchBodyPerception('http://127.0.0.1:4311')).rejects.toThrow('尚未启用可读取的身体感知层');
  });
});
