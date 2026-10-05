import type {DeskBotBodyCommand,DeskBotBodyPerception,DeskBotBodyTurn} from './bodyTypes.ts';

const perceptionLabels={observed:'已经感知',unsupported:'超出身体能力',record_only:'只作记录',cooldown:'重复输入，稍后再回应'};
const executionLabels={not_requested:'没有请求反馈',awaiting_queue:'等待反馈入队',queued:'等待设备回执',dispatched:'已发往设备，等待回执',acknowledged:'已有设备回执',acknowledged_report:'已有报告，尚未核验实机结果',failed:'反馈未成功',unsupported:'设备不支持',suppressed:'这次暂不反馈',simulation:'已有模拟回执',expired:'反馈已过期'};
const verificationLabels={verified:'已按登记设备核验回执',verification_missing:'回执未提供可核验的朝向',actual_yaw_out_of_range:'报告角度超出单轴允许范围',actual_yaw_deviates_from_request:'报告角度与期望朝向偏差过大',simulation:'模拟回执',unverified_device_report:'这条回执尚未核验为实机报告'};
const commandNames:Record<string,string>={'render.expression':'屏幕表达','orientation.base_yaw':'左右转头','audio.play':'声音播放'};
const expressions:Record<string,string>={neutral:'平静',happy:'轻快',concerned:'温柔关切',tired:'轻声',alert:'留意',surprised:'好奇'};
const when=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
export function bodyCommandLabel(command:DeskBotBodyCommand,turn:DeskBotBodyTurn,isolated=false) {
  const simulated=isolated||turn.simulated||command.simulated===true||command.result?.simulated===true;
  if(command.status==='completed'||command.status==='acknowledged')return simulated?'模拟回执完成':turn.hardware_verified?'设备报告完成':'收到完成回执，尚未实机核验';
  if(command.status==='failed')return simulated?'模拟执行失败':'设备报告执行失败';
  if(command.status==='expired')return '指令已过期';
  return ['sent','dispatched'].includes(command.status)?'已发送，等待回执':'等待设备回执';
}
export function BodyTurnDetail({turn,body,isolated=false}:{turn?:DeskBotBodyTurn|null;body:DeskBotBodyPerception;isolated?:boolean}) {
  const simulation=isolated||turn?.simulated===true;
  const stages=[['01 · 来源','发生了什么'],['02 · 感知','身体怎样理解'],['03 · 意图','准备怎样回应'],['04 · 回执','设备实际怎么回报']];
  const heading=(index:number)=><header><span className="body-review__stage-label">{stages[index]![0]}</span><h2>{stages[index]![1]}</h2></header>;
  if(!turn)return <div className="body-review__flow">{stages.map((stage,index)=><section className="body-review__stage" key={stage[0]}>{heading(index)}<p className="body-review__empty">{index===0?'等待一条身体输入。':'这一轮还没有记录。'}</p></section>)}</div>;
  return <>
    <div className="body-review__flow" aria-label="感知到设备反馈的一轮记录">
      <section className="body-review__stage">{heading(0)}
        <div className="body-review__chips"><span className="body-review__chip">{simulation?'独立模拟输入':turn.hardware_verified?'已核验实机输入':'设备上报，待实机核验'}</span></div>
        <p>{turn.source_label}</p><dl className="body-review__facts"><div><dt>输入设备</dt><dd>{turn.device_id}</dd></div><div><dt>观测时间</dt><dd><time dateTime={turn.observed_at}>{when(turn.observed_at)}</time></dd></div><div><dt>接收时间</dt><dd><time dateTime={turn.received_at}>{when(turn.received_at)}</time></dd></div></dl>
        <code>{turn.kind}</code>
      </section>
      <section className="body-review__stage">{heading(1)}
        <span className={`body-review__chip${turn.perception_status==='observed'?'':' body-review__chip--unknown'}`}>{perceptionLabels[turn.perception_status]}</span>
        <p>{turn.summary}</p><small>这是对本次输入的有限理解，不构成新身份或外壳变化。</small>
        {turn.world_attention?<p className="body-review__record"><strong>怎样带回生活</strong><br/>{turn.world_attention.status==='chosen'?turn.world_attention.decision?.text:'本次触碰先留在心上，等手头空下来再考虑。'}{turn.world_attention.status==='expired'?<small> · 这条注意邀请已过期。</small>:null}</p>:null}
      </section>
      <section className="body-review__stage">{heading(2)}
        <span className="body-review__chip body-review__chip--pending">表达意图，尚不等于已执行</span>
        <p>{turn.response.text||'这一轮没有准备说话。'}</p><dl className="body-review__facts"><div><dt>屏幕表达倾向</dt><dd>{expressions[turn.response.expression]??turn.response.expression}</dd></div>
          {turn.commands.filter(command=>command.requested_yaw_degrees!==undefined).map(command=><div key={command.command_id}><dt>希望转向</dt><dd>{command.requested_yaw_degrees}° · 单轴左右转动</dd></div>)}
        </dl>{turn.execution_reason?<p>{turn.execution_reason}</p>:null}{turn.unsupported_outputs?.map(output=><p key={output.type}>{output.reason}</p>)}<small>是否显示、播放或转动，以右侧设备回执为准。</small>
      </section>
      <section className="body-review__stage">{heading(3)}
        <span className={`body-review__chip${turn.execution_status==='failed'?' body-review__chip--failed':['queued','awaiting_queue'].includes(turn.execution_status)?' body-review__chip--pending':''}`}>{executionLabels[turn.execution_status]}</span>
        {turn.commands.length?turn.commands.map(command=><article className="body-review__record" key={command.command_id}><h3>{commandNames[command.type]??'表达反馈'}</h3><p>{bodyCommandLabel(command,turn,isolated)}</p><code>{command.type}</code>{command.dispatched_at?<p><small>发送于 {when(command.dispatched_at)}</small></p>:null}{command.acknowledged_at?<p><time dateTime={command.acknowledged_at}>{when(command.acknowledged_at)}</time></p>:null}{command.verification_status?<p><small>{verificationLabels[command.verification_status]}</small></p>:null}{command.error_code?<p className="body-review__chip--failed">{command.error_message??'执行时遇到问题。'} <code>{command.error_code}</code></p>:null}<details><summary>指令引用</summary><code>{command.command_id}</code></details></article>):<p className="body-review__empty">没有已入队的设备指令。</p>}
        <p className="body-review__record"><strong>{isolated?'隔离回合朝向记录':'设备朝向记录'}</strong><br/>{isolated?'模拟回执不能确认实机角度。':body.yaw.feedback_kind==='measured'&&body.yaw.status==='measured'&&body.yaw.actual_degrees!==null?`角度反馈传感器记录 ${body.yaw.actual_degrees}°` :body.yaw.reported_degrees!==null?`设备报告朝向 ${body.yaw.reported_degrees}° · 开环角度未实测。`:'角度未实测，尚无可核验的设备朝向报告。'}</p>
        {simulation?<small>模拟回执不更新实机朝向记录。</small>:null}
      </section>
    </div>
    <details className="body-review__trace"><summary>输入和反馈的引用</summary><dl><dt>本轮</dt><dd><code>{turn.turn_id}</code></dd><dt>输入事件</dt><dd><code>{turn.event_id}</code></dd><dt>有效期至</dt><dd>{when(turn.expires_at)}</dd><dt>身份写入</dt><dd>本轮没有直接改写身份或外壳。</dd></dl></details>
  </>;
}
