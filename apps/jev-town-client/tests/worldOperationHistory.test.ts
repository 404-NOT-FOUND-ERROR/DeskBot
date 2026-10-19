import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorldOperationHistory,traceDescription} from '../src/deskbot/WorldOperationHistory.tsx';

describe('life trace evidence presentation',()=>{
  it('distinguishes net inventory receipts, real waiting conditions and superseded waiting',()=>{
    expect(traceDescription({trace_id:'a',kind:'stock_changed',resource:'rations',before:3,after:2})).toBe('饭食：3 → 2（本次净变化）');
    expect(traceDescription({trace_id:'b',kind:'meal_wait',wait_context:{reason:'厨房有人正在备餐',available_portions:0,free_seats:6}})).toContain('厨房有人正在备餐 · 当前 0 份饭，6 个空位');
    expect(traceDescription({trace_id:'c',kind:'task_cancelled',title:'等饭',wakeup:{reason:'portion_and_seat_available'}})).toContain('提前结束等待');
    expect(traceDescription({trace_id:'d',kind:'reservation_returned',inputs:[{container:'bag:a',resource:'light_fruit',count:2}]})).toBe('光果 × 2');
  });
  it('starts as explicit read-only inspection with no automatic replay or change of current world',()=>{
    const html=renderToStaticMarkup(createElement(WorldOperationHistory,{baseUrl:'http://127.0.0.1:4311',actors:[]}));
    expect(html).toContain('这里读取历史，当前生活照常继续');expect(html).toContain('查看最近记录');
    expect(html).not.toContain('已从记录');expect(html).not.toContain('form');
  });
});
