// A real process interrupted after Python returns, before the Node commit.
import { writeFileSync } from 'node:fs';
import { createCognitionStage1 } from '../apps/deskbot-service/src/cognition-stage1.mjs';
const [filename, marker] = process.argv.slice(2);
const timer = setInterval(() => {}, 1000);
const lab = createCognitionStage1({ filename, beforeCommit: async () => {
  writeFileSync(marker, 'before-authoritative-commit');
  await new Promise(() => {});
} });
await lab.run({ run_id: 'actual-crash' });
clearInterval(timer);
await lab.close();
