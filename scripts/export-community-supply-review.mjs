import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { getWorldMap } from '../apps/deskbot-service/src/persistent-world.mjs';

// Only the explicitly isolated, credential-free experiment may become a public
// sample. Never read the installed SQLite world or a real user's memories here.
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(report.schema,'deskbot.population-supply-experiment.v1');
assert.equal(report.kind,'accelerated_rules_experiment');
assert.equal(report.steady.simulated_days,14);
assert.equal(report.shortage.simulated_hours,72);
const frames={};
for(const frame of report.frames) {
  assert.equal(Object.keys(frame.world.autonomy.actors).length,13);
  assert.ok(!frame.world.memory?.episodes?.length,'private memory cannot become public review material');
  const key=frame.key==='shortage'?'begin':frame.key;
  frames[key]={label:frame.label,map:getWorldMap(frame.world),elapsed_hours:frame.elapsed_hours};
}
for(const key of ['begin','gathering','cooking','distributed','recovered'])assert.ok(frames[key]);
const document={schema:'deskbot.community-supply-review.v1',simulated:true,
  description:'十三人从食材耗尽开始，按实际路线、有限资源和任务期限继续生活。独立规则回放，不改正式存档。',
  experiment:{steady:report.steady,shortage:report.shortage},frames};
writeFileSync(new URL('../apps/jev-town-client/public/supply-review-fixtures.json',import.meta.url),JSON.stringify(document,null,2));
console.log(JSON.stringify({frames:Object.keys(frames),simulated:true,steady:report.steady,shortage:report.shortage}));
