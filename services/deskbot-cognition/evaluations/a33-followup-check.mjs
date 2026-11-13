// Offline paired check against the A3.2 window that actually stopped.
// The only authored answer is a single-field repair; it is never applied to the world.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {cognitiveContext,cognitiveActualResult} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {compileFollowupIntent,validateFollowupIntent,FOLLOWUP_INTENT} from '../../../apps/deskbot-service/src/cognitive-followup-intent.mjs';
import {hash} from './r3-fixtures.mjs';

const [input,output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: a33-followup-check.mjs A32_RUN_DIRECTORY OUTPUT_JSON');
const directory = resolve(input);
const capture = JSON.parse(readFileSync(new URL('../../../research/experiments/a32-2026-11-02/followup-shape-counterexample.json',import.meta.url)));
const run = JSON.parse(readFileSync(join(directory,'results.json')));
assert.equal(run.version,capture.version);
const episode = run.results.find(e => e.id === capture.case_id);
assert.equal(episode.failure.cause_code,'followup_intent_invalid');
const zipped = path => JSON.parse(gunzipSync(readFileSync(path)));
const world = zipped(join(directory,'worlds',hash(episode.key)+'.json.gz'));
const before = hash(world);
const records = readdirSync(join(directory,'calls')).filter(n => n.endsWith('.json.gz'))
  .map(n => zipped(join(directory,'calls',n))).filter(c => c.id.includes(':'+capture.case_id+':'+capture.turn+':feedback:'));
const original = records.find(r => r.request.stage==='followup');
const repair = records.find(r => r.request.stage==='followup_repair');
assert.deepEqual(JSON.parse(original.response.content),capture.raw_response);
assert.deepEqual(JSON.parse(repair.response.content),capture.repair_response);
const context = cognitiveContext(world,episode.actor,world.clock.synced_at,'feedback');
context.result = cognitiveActualResult(world,episode.actor,world.clock.synced_at);
context.action = world.cognition.actors[episode.actor].pending.action;
context.mode = 'mock';
const corrected = {...capture.raw_response, unverified_idea:capture.raw_response.unverified_idea.text};
const bridge = createCognitionBridge({workerFile:'life_worker.py',mode:'mock',maxFrames:30,timeoutMs:30000});
const requests = [];
const size = request => request.messages.reduce((total, row)=>total+row.content.length,0);
const used = new Set();
try {
  const proposal = await bridge.session(context, request => {
    requests.push(request);
    const recorded = records.find(r => r.request.stage===request.stage && r.request.scene===request.scene && !used.has(r.id));
    assert.ok(recorded,'unexpected additional stage '+request.stage);
    used.add(recorded.id);
    return request.stage==='followup_repair' ? JSON.stringify(corrected) : recorded.response;
  });
  const prompt = requests.find(r=>r.stage==='followup'), retry = requests.find(r=>r.stage==='followup_repair');
  const view = JSON.parse(prompt.messages.at(-1).content);
  const hint = retry.messages.at(-1).content;
  assert.equal(view.previous_unverified_thought,corrected.unverified_idea);
  assert.equal(view.command_schema.properties.unverified_idea.type,'string');
  assert.deepEqual(view.verified_bases.map(b=>b.id),corrected.basis_ids);
  assert.deepEqual(view.current_issue.bound_target,context.continuation.current.completion_target);
  assert.deepEqual(view.current_issue.resolution_evidence_ids,context.continuation.current.resolution_evidence_ids);
  assert.ok(!JSON.stringify(view).includes(capture.legacy_rule_still_present));
  assert.ok(hint.includes('$.unverified_idea') && hint.includes('"actual":"object"'));
  assert.deepEqual(proposal.followup,compileFollowupIntent(corrected,context));
  const evidence = validateFollowupIntent(proposal,context,context);
  assert.equal(evidence.unverified_idea.epistemic,'unverified');
  assert.equal(hash(world),before);
  const report = {schema:'deskbot.a33-followup-offline-check.v1',source_version:run.version,case_id:episode.id,turn:capture.turn,
    world_hash:before,prompt_version:FOLLOWUP_INTENT.prompt_version,paid_calls:0,
    previous_thought:view.previous_unverified_thought,command_schema:view.command_schema,issue:view.current_issue,
    diagnostic:{path:'$.unverified_idea',rule:'type',expected:'string',actual:'object'},repair_hint:hint,
    comparison:{unit:'UTF-16 code units over all messages',a32_initial:size(original.request),a33_initial:size(prompt),
      a32_repair:size(repair.request),a33_repair:size(retry),a32_stage_calls:records.length,a33_stage_calls:requests.length},
    snapshot:{sha256:hash(view),fields:Object.keys(view),options:view.options.length,verified_bases:view.verified_bases},
    result:{corrected_command:corrected,compiled:proposal.followup,evidence,unchanged_world:true},
    interpretation:'缓存的原始响应由真实模型产生。修复答案是本地单字段探针。输入尺寸以字符计，世界未写入。'};
  mkdirSync(dirname(resolve(output)),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,projection:report.snapshot.sha256,comparison:report.comparison,paid_calls:0}));
} finally { bridge.close(); }
