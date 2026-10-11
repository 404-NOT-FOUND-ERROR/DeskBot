import { digest, fail } from './cognition-contracts.mjs';

export const MODEL_PRIORITIES = { user_dialogue: 100, cognition: 30, reflection: 20, embedding: 10 };
export function createCognitionBroker({ store, now = () => new Date(), maxCalls = 60, maxConcurrent = 1 } = {}) {
  const waiting = [];
  let active = 0, stopped = false, sequence = 0;
  for (const record of store.list('calls').filter(c => ['reserved', 'calling'].includes(c.status)))
    store.put('calls', record.call_id, { ...record, status: 'interrupted', finished_at: now().toISOString(), retry_policy: 'manual_new_request_only' });
  function drain() {
    while (!stopped && active < maxConcurrent && waiting.length) {
      waiting.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      const item = waiting.shift(); active++;
      void (async () => {
        const start = performance.now();
        const record = store.get('calls', item.callId);
        store.put('calls', item.callId, { ...record, status: 'calling', started_at: now().toISOString() });
        try {
          const result = await item.execute();
          if (stopped) fail('broker_stopped');
          store.put('calls', item.callId, { ...store.get('calls', item.callId), status: 'completed', finished_at: now().toISOString(), latency_ms: Math.round(performance.now() - start), result });
          item.resolve(result);
        } catch (error) {
          store.put('calls', item.callId, { ...store.get('calls', item.callId), status: 'failed', finished_at: now().toISOString(), error_code: error.code ?? 'mock_failure' });
          item.reject(error);
        } finally { active--; drain(); }
      })();
    }
  }
  function request({ callId, purpose, mode = 'mock', payload, execute }) {
    if (stopped) return Promise.reject(Object.assign(new Error('broker stopped'), { code: 'broker_stopped' }));
    if (mode !== 'mock') return Promise.reject(Object.assign(new Error('Stage 1 paid provider is disabled'), { code: 'paid_provider_disabled' }));
    if (!(purpose in MODEL_PRIORITIES)) fail('unknown_model_purpose');
    if (waiting.length >= 12) fail('queue_full');
    const payloadHash = digest(payload);
    const existing = store.get('calls', callId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) fail('call_id_conflict');
      if (existing.status === 'completed') return Promise.resolve(existing.result);
      fail('call_already_reserved', '已有预留或中断记录；不会自动重发。');
    }
    store.transaction(() => {
      const today = now().toISOString().slice(0, 10);
      if (store.list('calls').filter(c => c.day === today).length >= maxCalls) fail('mock_call_budget_exhausted');
      store.insert('calls', callId, { call_id: callId, purpose, priority: MODEL_PRIORITIES[purpose], mode, status: 'reserved', day: today, payload_hash: payloadHash,
        reserved_at: now().toISOString(), reserved_cost: 0, actual_cost: 0, currency: 'CNY', provider: 'stage1-mock', usage_source: 'mock_no_billing',
        input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, estimated_input_chars: JSON.stringify(payload).length,
        pricing_version: 'mock-zero-v1', retry_policy: 'manual_new_request_only' });
    });
    return new Promise((resolve, reject) => { waiting.push({ callId, execute, resolve, reject, priority: MODEL_PRIORITIES[purpose], sequence: sequence++ }); drain(); });
  }
  return {
    complete: options => request({ ...options, purpose: options.purpose ?? 'cognition' }),
    embed: ({ callId, text }) => request({ callId, purpose: 'embedding', payload: { text }, execute: () => {
      const hash = digest(text);
      return { provider: 'mock-hash-v1', semantic: false, vector: Array.from({ length: 16 }, (_, i) => parseInt(hash.slice(i * 2, i * 2 + 2), 16) / 255) };
    } }),
    status: () => ({ provider_mode: 'mock', paid_provider_enabled: false, max_calls_per_utc_day: maxCalls, max_concurrent: maxConcurrent, queue_length: waiting.length, active,
      paid_configuration_pending: ['model confirmation', 'embedding/retrieval choice', 'price and currency version', 'explicit spending cap'], calls: store.list('calls') }),
    close: () => { stopped = true; for (const item of waiting.splice(0)) {
      store.put('calls', item.callId, { ...store.get('calls', item.callId), status: 'interrupted', finished_at: now().toISOString() });
      item.reject(Object.assign(new Error('broker stopped'), { code: 'broker_stopped' }));
    } },
  };
}
