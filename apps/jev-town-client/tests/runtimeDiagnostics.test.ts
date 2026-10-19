import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UsageSummary,RuntimeDiagnostics,type UsageReport} from '../src/deskbot/RuntimeDiagnostics.tsx';
const distribution={samples:0,p50:null,p95:null,max:null};
const totals={attempts:1,usage_unknown:1,estimated_upper_cny:0,cost_known_attempts:0,calling:0,failed:1,fixture_attempts:0,input_tokens:0,output_tokens:0,attempt_latency_ms:distribution,request_latency_ms:distribution,queue_latency_ms:distribution};
describe('runtime usage evidence',()=>{
 it('shows unknown cost and absent latency samples without calling them free or instantaneous',()=>{
  const report:UsageReport={schema:'deskbot.model-usage.v2',scope:'live',note:'估算不是账户账单',pricing:{checked_at:'2026-10-11'},totals,categories:{chat:totals}};
  const html=renderToStaticMarkup(createElement(UsageSummary,{report}));expect(html).toContain('用量未知');expect(html).toContain('尚无样本');expect(html).toContain('估算不是账户账单');expect(html).not.toContain('免费');
 });
 it('requires an explicit scope read and has no replay, inference or clock controls',()=>{
  const html=renderToStaticMarkup(createElement(RuntimeDiagnostics,{baseUrl:'http://127.0.0.1:4311'}));expect(html).toContain('正式生活');expect(html).toContain('隔离实验');expect(html).toContain('读取本身不调用模型');expect(html).not.toContain('估算 ¥');
 });
});
