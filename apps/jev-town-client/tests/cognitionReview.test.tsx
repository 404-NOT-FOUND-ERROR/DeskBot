import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CognitionReview,type CognitionReport} from '../src/deskbot/CognitionReview';

const report:CognitionReport={schema:'deskbot.cognition.stage1.v1',scope:'isolated_mock',upstream:{commit:'e9fc862642369ba8b177595d2f8e3f20c1636da4',license:'Apache-2.0',files:24,invoked:[]},runtime:{transport:'stdio_ndjson',active_sessions:0},actors:[{actor_id:'shaping-001',name:'喵呜',role:'伴生个体',version:0,cognition_sequence:0,practice:0}],requests:[],memories:[],index_count:0,runs:[],broker:{calls:[],max_calls_per_utc_day:60,paid_provider_enabled:false,queue_length:0,active:0}};
describe('cognition review boundary and dialogue continuity',()=>{
 it('makes mock, unsupported quality claims and paid configuration boundaries visible',()=>{
  const html=renderToStaticMarkup(<CognitionReview initialReport={report}/>);
  expect(html).toContain('隔离 mock');expect(html).toContain('尚未验证模型叙事质量');expect(html).toContain('付费调用禁用');expect(html).toContain('完整认知循环留待第二阶段');expect(html).toContain('尚未运行');
 });
 it('keeps a usable return path to the current dialogue rather than substituting a sample for life',()=>{
  const html=renderToStaticMarkup(<CognitionReview baseUrl="http://127.0.0.1:4999" initialReport={report}/>);
  expect(html).toContain('和喵呜说话');expect(html).toContain('deskbotUrl=http%3A%2F%2F127.0.0.1%3A4999');expect(html).toContain('view=journal');expect(html).toContain('原文 / 可重建示例索引');
 });
});
