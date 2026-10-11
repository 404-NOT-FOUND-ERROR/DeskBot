import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CognitiveInputEvidence} from '../src/deskbot/CognitiveInputEvidence';
import evidence from '../src/deskbot/cognitive-source-evidence.json';
describe('source experiment evidence boundaries',()=>{
 it('keeps original failures and exposes the paired change without claiming completed or natural life',()=>{
  expect(evidence.pair_first_pass).toBeLessThan(evidence.pair_total_runs);
  expect(evidence.pairs.filter(p=>p.after.retested)).toHaveLength(1);
  const html=renderToStaticMarkup(<CognitiveInputEvidence/>);
  expect(html).toContain('虚构输入和真实 DeepSeek');expect(html).toContain('此处尚不表示完成');
  expect(html).toContain('没有这条输入');expect(html).toContain('收到这条输入');expect(html).toContain('一处建议／邀请混淆');
 });
});
