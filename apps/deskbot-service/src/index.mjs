import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeskBotServer } from './app.mjs';
import { createConfiguredLlm } from './llm.mjs';
import { createSqlitePersistence } from './persistence.mjs';
import { createVoiceSidecarClient } from './voice-sidecar-client.mjs';
import { createWeatherConnector } from './weather-connector.mjs';

const host = process.env.DESKBOT_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.DESKBOT_PORT ?? '4311', 10);
const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = process.env.DESKBOT_DB_PATH ?? resolve(serviceRoot, 'data', 'deskbot.sqlite');
const voiceSidecarUrl = process.env.DESKBOT_VOICE_SIDECAR_URL?.trim() || null;
const websocketPath = process.env.DESKBOT_WS_PATH?.trim() || '/ws';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('DESKBOT_PORT must be an integer between 1 and 65535');
}

const persistence = createSqlitePersistence({ filename: databasePath });
const llm = createConfiguredLlm();
const voiceClient = voiceSidecarUrl
  ? createVoiceSidecarClient({
    baseUrl: voiceSidecarUrl,
    timeoutMs: Number.parseInt(process.env.DESKBOT_VOICE_TIMEOUT_MS ?? '15000', 10),
    asrPath: process.env.DESKBOT_VOICE_ASR_PATH ?? '/v1/asr',
    ttsPath: process.env.DESKBOT_VOICE_TTS_PATH ?? '/v1/tts',
  })
  : null;
const weatherConnector = createWeatherConnector();
const server = createDeskBotServer({ persistence, llm, voiceClient, weatherConnector, websocketPath });

server.listen(port, host, () => {
  console.log(`DeskBot Service v0.1.0 listening on http://${host}:${port}`);
  console.log(`Persistent world: ${persistence.filename}`);
  console.log(`LLM provider: ${llm.id}`);
  console.log(`Voice sidecar: ${voiceClient ? voiceSidecarUrl : 'disabled'}`);
});

server.once('close', () => persistence.close());

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
