import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {LifeObservation,type ObservationReport} from '../src/deskbot/LifeObservation.tsx';
import {Conversation,mergeConversation} from '../src/deskbot/Conversation.tsx';
describe('real-life observation and dialogue access',()=>{
 it('exposes the live observation boundary rather than treating a historical result as observed success',()=>{
  const report:ObservationReport={schema:'deskbot.life-observation.v1',started_at:'2026-10-07T13:00:00Z',last_observed_at:'2026-10-07T13:01:00Z',sampled_status:'collecting',protagonist_id:'own',days:[{date:'2026-10-07',online_seconds:60,unobserved_seconds:3600,reconciled_roots:2,samples:2,inputs:{},choices:{},actors:{},results:[],changes:[]}],current:[],historical_24h:{scope:'retained_roots_including_offline_reconciliation',actors:{}}};
  const html=renderToStaticMarkup(<LifeObservation baseUrl="http://local" initial={report}/>);
  expect(html).toContain('真实运行观察');expect(html).toContain('1 小时 0 分钟');expect(html).toContain('尚未形成主要投入');expect(html).toContain('没有自动判定验收通过');expect(html).toContain('还没有采到这一天的实际结果');
 });
 it('keeps a visible conversation entry and composer with or without history, and merges a saved turn with its local response once',()=>{
  const saved=[{id:'a',speaker:'喵呜',text:'已保存的回答'}],local=[{id:'a',speaker:'喵呜',text:'最新回答'},{id:'b',speaker:'你',text:'还想问问'}];
  const lines=mergeConversation(saved,local);expect(lines).toHaveLength(2);expect(lines[0]?.text).toBe('最新回答');
  const html=renderToStaticMarkup(<Conversation lines={lines} expanded onToggle={()=>{}} historyError=""><form><textarea aria-label="和喵呜对话"/><button>发送</button></form></Conversation>);
  expect(html).toContain('和喵呜说话');expect(html).toContain('最新回答');expect(html).toContain('发送');
  const collapsed=renderToStaticMarkup(<Conversation lines={lines} expanded={false} onToggle={()=>{}} historyError=""><form><textarea aria-label="和喵呜对话"/></form></Conversation>);
  expect(collapsed).toContain('展开对话记录');expect(collapsed).toContain('textarea');expect(collapsed).not.toContain('最新回答');
 });
});
