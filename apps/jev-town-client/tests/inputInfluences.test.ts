import {createElement} from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {InputInfluences} from '../src/deskbot/InputInfluences.tsx';
import {suggestLifeIdea} from '../src/deskbot/bridge.ts';
import type {DeskBotRefraction} from '../src/deskbot/types.ts';
const inputs:DeskBotRefraction={schema:'test',policy:'bounded',revision:1,suggestions:[{id:'tend',title:'有空整理苗床'}],source_status:[{id:'body',name:'设备感受',status:'awaiting_device'}],records:[{id:'idea',category:'dialogue',source_label:'用户建议',source_url:null,observed_at:'2026-10-05T04:00:00Z',expires_at:'2026-10-06T04:00:00Z',attested:true,meaning:'suggestion',text:'有空整理苗床',summary:'收到建议',suggestion:'tend',status:'pending',last_note:'等手头的事结束，再结合状态考虑。',origin_id:'idea',decisions:[]}]};
afterEach(()=>vi.unstubAllGlobals());
describe('input reference UI',()=>{
 it('shows news, air data and the model connection beside weather with publisher dates',()=>{
   const state=structuredClone(inputs);
   state.source_status.push({id:'model',name:'deepseek-flash · 对话',status:'connected'});
   state.records.push({...state.records[0]!,id:'news',category:'external',meaning:'sourced_report',suggestion:null,status:'observed',text:'森林与天空',original_text:'Forest and sky',published_at:'2026-10-04T04:00:00Z',source_label:'NASA Science',source_url:'https://science.nasa.gov/story'});
   state.records.push({...state.records[0]!,id:'air',category:'external',meaning:'environment_reference',suggestion:null,status:'observed',last_note:'PM2.5 45 μg/m³，美国 AQI 160',source_label:'上海空气'});
   state.records.push({...state.records[0]!,id:'weather',category:'weather',suggestion:null,status:'observed',source_label:'上海天气'});
   const html=renderToStaticMarkup(createElement(InputInfluences,{inputs:state}));
   for(const text of ['森林与天空','Forest and sky','发布','上海空气','上海天气','deepseek-flash','已接通','区域模型数据','先记下'])expect(html).toContain(text);
 });
 it('keeps an older pending suggestion visible beside newer weather and does not claim completion',()=>{
   const state=structuredClone(inputs);for(let i=0;i<4;i++)state.records.push({...state.records[0]!,id:'weather'+i,category:'weather',meaning:'environment_opportunity',suggestion:null,status:'observed',source_label:'上海天气',last_note:'天气观测已接收'});
   const html=renderToStaticMarkup(createElement(InputInfluences,{inputs:state}));expect(html).toContain('先记下');expect(html).toContain('等手头的事结束');expect(html).toContain('上海天气');expect(html).not.toContain('安排已完成');expect(html).toContain('等待设备上报');
 });
 it('replay offers no live suggestion controls and escapes untrusted source text',()=>{
   const state=structuredClone(inputs);state.records[0]!.text='<script>changeIdentity()</script>';state.records[0]!.source_url='javascript:alert(1)';const html=renderToStaticMarkup(createElement(InputInfluences,{inputs:state,replay:true,onSuggest:()=>{}}));expect(html).not.toContain('给喵呜一个生活建议');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('javascript:');
 });
 it('sends a stable suggestion id through the suggestion endpoint without starting a task',async()=>{
   const mock=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({accepted:true}),{status:202}));vi.stubGlobal('fetch',mock);await suggestLifeIdea('tend','retry-id','http://localhost:4311');await suggestLifeIdea('tend','retry-id','http://localhost:4311');expect(mock).toHaveBeenCalledTimes(2);const [url,options]=mock.mock.calls[0]!;expect(url).toBe('http://localhost:4311/api/life/inputs');expect(JSON.parse(options!.body as string)).toEqual({suggestion:'tend',event_id:'retry-id'});expect(mock.mock.calls[1]![1]!.body).toBe(options!.body);
 });
});
