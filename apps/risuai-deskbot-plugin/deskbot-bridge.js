//@name deskbot_bridge
//@display-name DeskBot Bridge
//@api 3.0
//@version 0.1.0
//@arg service_url string DeskBot Service URL (default: http://127.0.0.1:4311)
//@arg character_id string DeskBot character ID (default: shaping-001; legacy ember-001 is accepted for history)

(async () => {
  const defaultServiceUrl = 'http://127.0.0.1:4311';

  function normalizeServiceUrl(value) {
    const candidate = (value || defaultServiceUrl).trim();
    return candidate.replace(/\/$/, '');
  }

  async function getServiceUrl() {
    return normalizeServiceUrl(await Risuai.getArgument('service_url'));
  }

  async function getCharacterId(fallback = 'shaping-001') {
    const value = await Risuai.getArgument('character_id');
    return (value || fallback).trim();
  }

  async function checkHealth() {
    const serviceUrl = await getServiceUrl();
    const response = await Risuai.nativeFetch(`${serviceUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`DeskBot Service returned HTTP ${response.status}`);
    }

    return response.json();
  }

  function newEventId(prefix) {
    if (globalThis.crypto?.randomUUID) {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function extractRisuEmotion(text) {
    const matches = [...text.matchAll(/\{\{emotion::([^}]+)\}\}|<Emotion="([^"]+)">/gi)];
    const match = matches.at(-1);
    return match ? (match[1] ?? match[2]).trim() : null;
  }

  async function postChat(body) {
    const serviceUrl = await getServiceUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    try {
      const response = await Risuai.nativeFetch(`${serviceUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`DeskBot Service returned HTTP ${response.status}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchStateContext(characterId) {
    const serviceUrl = await getServiceUrl();
    const response = await Risuai.nativeFetch(`${serviceUrl}/api/state/${encodeURIComponent(characterId)}`);
    if (!response.ok) throw new Error(`DeskBot state returned HTTP ${response.status}`);
    return response.json();
  }

  function postChatInBackground(body) {
    void postChat(body).then((result) => {
      console.log(`[DeskBot Bridge] Chat event accepted: ${JSON.stringify(result)}`);
    }).catch((error) => {
      console.warn('[DeskBot Bridge] Chat event deferred:', error.message);
    });
  }

  async function registerChatListeners() {
    const characterId = await getCharacterId();
    let lastInputUpdate = Promise.resolve();

    const inputHandler = (content) => {
      if (typeof content === 'string' && content.trim()) {
        lastInputUpdate = postChat({
          event_id: newEventId('risu-input'),
          character_id: characterId,
          role: 'user',
          source: 'risuai',
          message: content,
        });
        void lastInputUpdate.catch((error) => {
          console.warn('[DeskBot Bridge] Input state update skipped:', error.message);
        });
      }

      return content;
    };

    const outputHandler = ({ chat, messageIndex, characterIndex, chatIndex }) => {
      if (messageIndex < 0) return;

      const message = chat?.message?.[messageIndex];
      const text = message?.data;
      if (typeof text !== 'string' || !text.trim()) return;

      const messageId = message.chatId ?? `index-${characterIndex}-${chatIndex}-${messageIndex}`;
      const risuEmotion = extractRisuEmotion(text);
      postChatInBackground({
        event_id: `risu-output-${messageId}`,
        character_id: characterId,
        role: 'assistant',
        source: 'risuai',
        message: text,
        metadata: {
          message_id: messageId,
          character_index: characterIndex,
          chat_index: chatIndex,
          message_index: messageIndex,
          ...(risuEmotion ? { risuai_emotion: risuEmotion } : {}),
        },
      });
    };

    await Risuai.addRisuScriptHandler('input', inputHandler);
    await Risuai.addRisuReplacer('beforeRequest', async (messages) => {
      try {
        await lastInputUpdate.catch(() => undefined);
        const state = await fetchStateContext(characterId);
        const withoutOldState = messages.filter((message) => !(
          message?.role === 'system'
          && typeof message.content === 'string'
          && message.content.includes('[DESKBOT_STATE]')
        ));
        return [
          ...withoutOldState,
          { role: 'system', content: state.context },
        ];
      } catch (error) {
        console.warn('[DeskBot Bridge] State context unavailable:', error.message);
        return messages;
      }
    });
    await Risuai.addRisuChatListener('output', outputHandler);
  }

  async function registerHealthButton(name) {
    await Risuai.registerButton({
      id: 'deskbot-bridge-health',
      name,
      icon: '♥',
      iconType: 'html',
      location: 'action',
    }, runHealthCheck);
  }

  async function runHealthCheck() {
    await registerHealthButton('DeskBot 检查中...');

    try {
      const health = await checkHealth();
      console.log(`[DeskBot Bridge] Service healthy: ${JSON.stringify(health)}`);
      await registerHealthButton(`DeskBot 已连接 ${health.version}`);
    } catch (error) {
      console.error('[DeskBot Bridge] Health check failed', error);
      await registerHealthButton('DeskBot 连接失败');
    }
  }

  await registerHealthButton('DeskBot 健康检查');
  await registerChatListeners();

  console.log('[DeskBot Bridge] Loaded. RisuAI text is sent to DeskBot input layer; state and hardware remain service-owned.');
})();
