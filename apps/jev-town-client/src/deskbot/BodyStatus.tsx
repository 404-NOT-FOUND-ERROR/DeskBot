import type {DeskBotBodyPerception} from './bodyTypes.ts';
import './body-status.css';

export function bodyConnectionLabel(body:DeskBotBodyPerception) {
  if(!body.connection)return '设备连接未核验';
  const connected=body.connection.devices.filter(device=>device.connected);
  if(connected.some(device=>!device.simulated))return '设备已连接';
  return connected.length?'仅模拟设备在线':'尚未连接设备';
}
/** A small factual summary for the companion page; development controls stay in body-review. */
export function BodyStatus({body}:{body?:DeskBotBodyPerception|null}) {
  if(!body)return null;
  const sound=body.last_sound_direction,shell=body.shell;
  return <div className="body-status" aria-label="喵呜的身体状态">
    <strong>{bodyConnectionLabel(body)}</strong>
    {body.attention?<span>{body.attention.kind==='head_touch'?'注意到头顶被轻碰':'注意到屏幕被触碰'}</span>:null}
    {sound?<span>{sound.status==='fresh'?sound.coordinate_frame==='calibrated_forward'?`声源相对正前方 ${sound.angle_degrees}°`:'听见声音，方向参考尚未校准':sound.status==='uncertain'?'声源方向不够确定':'上次声源方向已过期'} · 身份未知</span>:null}
    <span>{shell?.status==='recognized'&&shell.shell_id?shell.hardware_verified?`外壳：${shell.label??'已登记的壳'}`:'外壳登记匹配，待实机核验':shell?.status==='stale'?'外壳识别已过期，等待新读数':'外壳仍未确定'}</span>
  </div>;
}
