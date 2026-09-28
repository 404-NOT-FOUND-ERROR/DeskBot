import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LlmConfigurationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function completionUrl(baseUrl) {
  const normalized = requireText(baseUrl, 'base_url').replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
}

export class LlmConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmConfigurationError';
  }
}

export class LlmProviderError extends Error {
  constructor(code, message, { status = null, retryable = null } = {}) {
    super(message);
    this.name = 'LlmProviderError';
    this.code = code;
    this.status = status;
    this.statusCode = 502;
    this.retryable = retryable ?? (status === null || status === 408 || status === 425 || status === 429 || status >= 500);
  }
}

export function loadLlmConfiguration({ env = process.env, configPath = env.DESKBOT_LLM_CONFIG } = {}) {
  const provider = (env.DESKBOT_LLM_PROVIDER ?? 'fake').trim().toLowerCase();
  if (provider === 'fake') return { provider: 'fake' };
  if (provider !== 'openai-compatible' && provider !== 'deepseek') {
    throw new LlmConfigurationError('DESKBOT_LLM_PROVIDER must be fake, deepseek, or openai-compatible');
  }

  let fileConfig = {};
  if (configPath) {
    const filename = resolve(configPath);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(filename, 'utf8'));
    } catch (error) {
      throw new LlmConfigurationError(`unable to read DESKBOT_LLM_CONFIG: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new LlmConfigurationError('DESKBOT_LLM_CONFIG must contain a JSON object');
    }
    fileConfig = parsed;
  }

  return {
    provider,
    base_url: requireText(env.DESKBOT_LLM_BASE_URL ?? fileConfig.base_url, 'base_url'),
    api_key: requireText(env.DESKBOT_LLM_API_KEY ?? fileConfig.api_key, 'api_key'),
    model: requireText(env.DESKBOT_LLM_MODEL ?? fileConfig.model, 'model'),
  };
}

export function createOpenAiCompatibleLlm({
  base_url: baseUrl,
  api_key: apiKey,
  model,
  temperature = 0.55,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
  emptyResponseRetries = 1,
} = {}) {
  const endpoint = completionUrl(baseUrl);
  const secret = requireText(apiKey, 'api_key');
  const modelId = requireText(model, 'model');
  const samplingTemperature = Number.isFinite(Number(temperature))
    ? Math.min(1, Math.max(0, Number(temperature)))
    : 0.55;
  if (typeof fetchImpl !== 'function') {
    throw new LlmConfigurationError('fetchImpl must be a function');
  }

  return {
    id: 'openai-compatible-v0.1',
    async complete({ prompt }) {
      const promptText = requireText(prompt, 'prompt');
      const attempts = Math.max(0, Number(emptyResponseRetries)) + 1;
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let response;
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${secret}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: 'user', content: promptText }],
              stream: false,
              temperature: samplingTemperature,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          lastError = new LlmProviderError('llm_transport_error', 'LLM request failed before a provider response was received', {
            retryable: true,
          });
          continue;
        }

        if (!response.ok) {
          const error = new LlmProviderError(
            'llm_http_error',
            `LLM endpoint returned HTTP ${response.status}`,
            { status: response.status },
          );
          if (error.retryable && attempt < attempts - 1) {
            lastError = error;
            continue;
          }
          throw error;
        }

        let body;
        try {
          body = await response.json();
        } catch {
          lastError = new LlmProviderError('llm_invalid_response', 'LLM endpoint returned invalid JSON');
          continue;
        }
        const text = body?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || text.trim() === '') {
          lastError = new LlmProviderError('llm_invalid_response', 'LLM endpoint returned no assistant text');
          continue;
        }

        return {
          provider: this.id,
          model: modelId,
          text: text.trim(),
          trace: {
            finish_reason: body.choices[0].finish_reason ?? null,
            usage: body.usage ?? null,
          },
        };
      }
      throw lastError ?? new LlmProviderError('llm_invalid_response', 'LLM endpoint returned no assistant text');
    },
  };
}

export function createConfiguredLlm(options = {}) {
  const configuration = loadLlmConfiguration(options);
  return configuration.provider === 'fake'
    ? createFakeLlm()
    : createOpenAiCompatibleLlm({
      ...configuration,
      temperature: options.temperature ?? process.env.DESKBOT_LLM_TEMPERATURE ?? 0.55,
      fetchImpl: options.fetchImpl,
    });
}

export function createFakeLlm() {
  return {
    id: 'fake-llm-v0.1',
    async complete({ userText, state, worldConditions }) {
      const expression = state.interaction.expression;
      const lateNight = worldConditions.some((condition) => condition.label === 'late-night');
      const workshop = worldConditions.some((condition) => condition.label === 'workshop-context');

      let text = '我听见了。我们可以先把这件事放在这里，再决定下一步。';
      if (expression === 'concerned') {
        text = lateNight
          ? '已经很晚了，先慢一点。我会陪你把今天的事情放下，明天再继续。'
          : '听见了，你不用急着解决。我们可以先慢一点，我会陪着你。';
      } else if (workshop) {
        text = '我们可以把制作拆成一个小步骤，先确认接口和装配，再决定外壳的形态。';
      } else if (expression === 'happy') {
        text = '我也感受到这份开心了。我们把它记下来，再继续往前走。';
      }

      return {
        provider: this.id,
        model: this.id,
        text,
        trace: {
          user_text_length: userText.length,
          selected_expression: expression,
          late_night: lateNight,
          workshop_context: workshop,
        },
      };
    },
  };
}
