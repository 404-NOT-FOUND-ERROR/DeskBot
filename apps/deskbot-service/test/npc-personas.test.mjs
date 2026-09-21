import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  NPC_PERSONAS,
  composeNpcAgentPrompt,
  getNpcPersona,
  npcReplyNeedsGrounding,
  publicNpcProfile,
} from '../src/npc-personas.mjs';

test('authored NPC personas expose desires, boundaries, speech hooks and examples', () => {
  for (const [npcId, persona] of Object.entries(NPC_PERSONAS)) {
    assert.equal(getNpcPersona(npcId), persona);
    assert.ok(persona.desires.length >= 2);
    assert.ok(persona.likes.length >= 2);
    assert.ok(persona.aversions.length >= 2);
    assert.ok(persona.fears.length >= 1);
    assert.ok(persona.speech.catchphrases.length >= 2);
    assert.ok(persona.speech.triggers.length >= 1);
    assert.ok(persona.examples.length >= 1);
    assert.ok(persona.scene_openers.length >= 1);
    assert.ok(persona.dialogue_examples.length >= 1);
    assert.ok(persona.conversation_moves.length >= 1);
    assert.ok(persona.toy_profile?.collection);
    assert.ok(persona.toy_profile?.signature_object);
    assert.ok(persona.toy_profile?.mischief);
    assert.ok(persona.toy_profile?.visual_quirk);
    assert.ok(publicNpcProfile(npcId).display_name);
    assert.ok(publicNpcProfile(npcId).signature);
    assert.ok(publicNpcProfile(npcId).role_label);
  }
  assert.equal(getNpcPersona('missing-npc'), null);
});

test('NPC Persona Markdown cards remain an authoring artifact with required sections', () => {
  const cards = {
    'pathfinder-001': 'research/npcs/pathfinder-001.md',
    'shade-collector-001': 'research/npcs/shade-collector-001.md',
    'echo-postcarrier-001': 'research/npcs/echo-postcarrier-001.md',
  };
  for (const filename of Object.values(cards)) {
    const absolute = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', filename);
    assert.equal(existsSync(absolute), true);
    const markdown = readFileSync(absolute, 'utf8');
    for (const heading of ['身份定位', '欲望与偏好', '爱憎与边界', '说话方式', '场景钩子', '不做什么']) {
      assert.match(markdown, new RegExp(`## ${heading}`));
    }
  }
});

test('NPC prompt keeps character performance separate from canonical world authority', () => {
  const prompt = composeNpcAgentPrompt({
    persona: NPC_PERSONAS['shade-collector-001'],
    npc: { npc_id: 'shade-collector-001', location_id: 'backlit-grove', relationship: { familiarity: 2, trust: 1, encounters: 1 } },
    location: { name: '逆光林地', description: '叶片背面留着旧日光。' },
    scene: { location_id: 'backlit-grove', title: '影栖在收一段迟到的影子', narration: '影子停在叶根旁。', sensory_cue: '叶背一亮', opportunity: '等它自己靠近' },
    relationship: { familiarity: 2, trust: 1, encounters: 1 },
    recentExperiences: [{ summary: '一起等过一段迟到的影子' }],
    intent: 'suggest',
    idea: '让它换一个形状',
  });
  assert.match(prompt, /desires=/);
  assert.match(prompt, /aversions=/);
  assert.match(prompt, /scene_observation=影子停在叶根旁/);
  assert.match(prompt, /只输出这个 NPC 当面会说/);
  assert.match(prompt, /不能把机会说成已经完成/);
  assert.match(prompt, /不能.*改天气.*换外壳.*改变人格/);
  assert.match(prompt, /dialogue_examples=/);
  assert.match(prompt, /toy_collection=/);
  assert.match(prompt, /mischief=/);
  assert.match(prompt, /relationship_stage=初遇/);
  assert.match(prompt, /不要套用“收到、好的/);
  assert.match(prompt, /默认把奇幻对象当作这个角色生活里的普通东西/);
  assert.match(prompt, /60 至 180 个中文字符/);
  assert.match(prompt, /1 至 2 个短段落/);
  assert.match(prompt, /NPC 自己的明确判断/);
});

test('NPC grounding guard rejects setting exposition but keeps concrete character lines', () => {
  assert.equal(npcReplyNeedsGrounding('在聚形域里，光粒漂移，光域凝聚成形，世界规则因此改变。'), true);
  assert.equal(npcReplyNeedsGrounding('收到。'), true);
  assert.equal(npcReplyNeedsGrounding('它今天迟了三步。先别替它决定，我不喜欢别人替一段路催答案。你可以在路标边等十步，也可以先绕过去；十步以后，我们再看它愿不愿意把箭头转回来。'), false);
  assert.equal(npcReplyNeedsGrounding(`你问得很直接，我把缺角地图压在杯子旁边，先看那枚路标会不会转向。我不想替它决定。\n\n${'你可以先等一会儿，也可以跟我走十步再回来。'.repeat(10)}`), true);
  assert.equal(npcReplyNeedsGrounding('你问得很直接，我觉得这件事可以再想一想。你可以先等，也可以离开。'), true);
});
