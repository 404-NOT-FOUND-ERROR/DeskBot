import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CognitiveContinuityReview} from '../src/deskbot/CognitiveContinuityReview';
describe('continuity review separates rules, actual tasks and remaining narrative errors',()=>{
 it('shows actual timing, narrative limits and the unimplemented world boundary',()=>{
  const html=renderToStaticMarkup(<CognitiveContinuityReview/>);
  expect(html).toContain('昨天留下的事，今天怎样接着做');
  expect(html).toContain('不是严格随机 A/B');expect(html).toContain('分类错误仍然保留');
  expect(html).toContain('尚不能进入新区域');expect(html).toContain('不是模型自然跨日记录');
  expect(html).toContain('复查是再次决定');
 });
 it('preserves the unanswered-message problem through repeated reviews',()=>{
  const html=renderToStaticMarkup(<CognitiveContinuityReview initialTrace="unanswered-message"/>);
  expect(html).toContain('等待期限到了，仍未收到关联回复');expect(html).toContain('暂缓不扣兴趣');
  expect(html).toContain('等待起点保持不变');expect(html).not.toContain('对方已接受');
 });
});
