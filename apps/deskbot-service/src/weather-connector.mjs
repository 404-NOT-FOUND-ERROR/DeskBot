import { randomUUID } from 'node:crypto';

import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';

const DEFAULT_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_QWEATHER_ENDPOINT = 'https://devapi.qweather.com/v7/weather/now';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_PROVIDER = 'open-meteo';
const FORECAST_KINDS = Object.freeze(['minutely', 'hourly', 'daily']);
const DEFAULT_FORECAST_TTLS = Object.freeze({
  minutely: 10 * 60 * 1000,
  hourly: 30 * 60 * 1000,
  daily: 6 * 60 * 60 * 1000,
});
const MINUTELY_TYPE_LABELS = Object.freeze({
  rain: '降雨',
  snow: '降雪',
  sleet: '雨夹雪',
  none: '无降水',
});

const WEATHER_CODE_LABELS = Object.freeze({
  0: '晴',
  1: '大致晴',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '冻雾',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷雨',
  96: '雷雨伴小冰雹',
  99: '雷雨伴大冰雹',
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseCoordinate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${field} must be a finite number`);
  return number;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function offsetString(seconds) {
  if (!Number.isInteger(seconds)) return null;
  const sign = seconds < 0 ? '-' : '+';
  const absolute = Math.abs(seconds);
  const hours = String(Math.floor(absolute / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function providerDateTime(value, utcOffsetSeconds) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  if (!Number.isNaN(Date.parse(text))) {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text).toISOString();
    const offset = offsetString(utcOffsetSeconds);
    if (offset && !Number.isNaN(Date.parse(`${text}:00${offset}`))) {
      return new Date(`${text}:00${offset}`).toISOString();
    }
    // A provider-local time without an offset is not safe to reinterpret as
    // the machine's local timezone. Leave it unknown; the fetch time remains
    // available in provenance and event.observed_at.
  }
  return null;
}

function qweatherDateTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeForecastKinds(value) {
  const values = value === undefined || value === null || value === 'all'
    ? FORECAST_KINDS
    : Array.isArray(value) ? value : [value];
  const kinds = [...new Set(values.map((item) => String(item).trim().toLowerCase()))];
  if (kinds.length === 0 || kinds.some((kind) => !FORECAST_KINDS.includes(kind))) {
    throw new WeatherConnectorError(400, 'weather_forecast_kind_invalid', '天气预报类型必须是 minutely、hourly 或 daily');
  }
  return kinds;
}

function qweatherForecastEndpoint(endpoint, kind) {
  const url = new URL(endpoint);
  const match = url.pathname.match(/^(.*\/v7)\/weather\/[^/]+\/?$/i);
  if (!match) {
    throw new WeatherConnectorError(424, 'weather_forecast_endpoint_unsupported', '当前和风天气 endpoint 不是 v7 天气 Host，暂不能派生预报路径');
  }
  const suffix = kind === 'minutely' ? 'minutely/5m' : `weather/${kind === 'hourly' ? '24h' : '7d'}`;
  url.pathname = `${match[1]}/${suffix}`;
  return url;
}

function forecastExpiry(now, ttlMs) {
  return new Date(now.getTime() + ttlMs).toISOString();
}

function normalizeQWeatherForecast(kind, body, resolved, fetchedAt, expiresAt) {
  if (String(body?.code ?? '') !== '200') {
    throw new WeatherConnectorError(424, 'weather_provider_api_error', `天气预报 provider 返回 code ${String(body?.code ?? 'unknown')}`);
  }
  const base = {
    kind,
    location: resolved.location,
    timezone: resolved.timezone,
    provider: resolved.provider,
    fetched_at: fetchedAt,
    expires_at: expiresAt,
  };
  if (kind === 'minutely') {
    const items = Array.isArray(body.minutely) ? body.minutely : [];
    if (!items.length) throw new WeatherConnectorError(502, 'weather_provider_invalid_payload', '和风天气短临预报缺少 minutely 数据');
    return {
      ...base,
      summary: typeof body.summary === 'string' ? body.summary : null,
      items: items.map((item) => ({
        time: qweatherDateTime(item.fxTime),
        precip_mm: numberOrNull(item.precip),
        type: item.type ?? null,
        description: MINUTELY_TYPE_LABELS[item.type] ?? item.type ?? null,
      })),
    };
  }
  const items = Array.isArray(body[kind === 'hourly' ? 'hourly' : 'daily']) ? body[kind === 'hourly' ? 'hourly' : 'daily'] : [];
  if (!items.length) throw new WeatherConnectorError(502, 'weather_provider_invalid_payload', `和风天气${kind === 'hourly' ? '小时' : '每日'}预报缺少数据`);
  if (kind === 'hourly') {
    return {
      ...base,
      items: items.map((item) => ({
        time: qweatherDateTime(item.fxTime),
        temperature_c: numberOrNull(item.temp),
        condition: item.text ?? null,
        precipitation_probability: numberOrNull(item.pop),
        precip_mm: numberOrNull(item.precip),
        humidity: numberOrNull(item.humidity),
        wind_mps: numberOrNull(item.windSpeed) === null ? null : numberOrNull(item.windSpeed) / 3.6,
      })),
    };
  }
  return {
    ...base,
    items: items.map((item) => ({
      date: item.fxDate ?? null,
      temp_min_c: numberOrNull(item.tempMin),
      temp_max_c: numberOrNull(item.tempMax),
      condition_day: item.textDay ?? null,
      condition_night: item.textNight ?? null,
      precipitation_probability: numberOrNull(item.pop),
      precip_mm: numberOrNull(item.precip),
      humidity: numberOrNull(item.humidity),
    })),
  };
}

function normalizeOpenMeteoForecast(kind, body, resolved, fetchedAt, expiresAt) {
  const base = {
    kind,
    location: resolved.location,
    timezone: body.timezone ?? resolved.timezone,
    provider: resolved.provider,
    fetched_at: fetchedAt,
    expires_at: expiresAt,
  };
  if (kind === 'minutely') {
    const source = body.minutely_15;
    if (!source?.time?.length) throw new WeatherConnectorError(502, 'weather_provider_invalid_payload', 'Open-Meteo 短临预报缺少数据');
    return {
      ...base,
      items: source.time.map((time, index) => ({
        time: providerDateTime(time, body.utc_offset_seconds),
        precip_mm: numberOrNull(source.precipitation?.[index]),
        type: WEATHER_CODE_LABELS[source.weather_code?.[index]] ?? null,
        description: WEATHER_CODE_LABELS[source.weather_code?.[index]] ?? null,
      })),
    };
  }
  if (kind === 'hourly') {
    const source = body.hourly;
    if (!source?.time?.length) throw new WeatherConnectorError(502, 'weather_provider_invalid_payload', 'Open-Meteo 小时预报缺少数据');
    return {
      ...base,
      items: source.time.map((time, index) => ({
        time: providerDateTime(time, body.utc_offset_seconds),
        temperature_c: numberOrNull(source.temperature_2m?.[index]),
        condition: WEATHER_CODE_LABELS[source.weather_code?.[index]] ?? null,
        precipitation_probability: numberOrNull(source.precipitation_probability?.[index]),
        precip_mm: numberOrNull(source.precipitation?.[index]),
        humidity: numberOrNull(source.relative_humidity_2m?.[index]),
        wind_mps: numberOrNull(source.wind_speed_10m?.[index]),
      })),
    };
  }
  const source = body.daily;
  if (!source?.time?.length) throw new WeatherConnectorError(502, 'weather_provider_invalid_payload', 'Open-Meteo 每日预报缺少数据');
  return {
    ...base,
    items: source.time.map((date, index) => ({
      date,
      temp_min_c: numberOrNull(source.temperature_2m_min?.[index]),
      temp_max_c: numberOrNull(source.temperature_2m_max?.[index]),
      condition_day: WEATHER_CODE_LABELS[source.weather_code?.[index]] ?? null,
      condition_night: null,
      precipitation_probability: numberOrNull(source.precipitation_probability_max?.[index]),
      precip_mm: numberOrNull(source.precipitation_sum?.[index]),
      humidity: null,
    })),
  };
}

function safeEndpointLabel(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

function normalizeEndpoint(value, provider) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return provider === 'qweather' ? DEFAULT_QWEATHER_ENDPOINT : DEFAULT_ENDPOINT;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw;
  // QWeather console/API Host values are commonly supplied as a bare host.
  // Accept that form while keeping the actual token server-side.
  if (provider === 'qweather') {
    return `https://${raw.includes('/') ? raw : `${raw}/v7/weather/now`}`;
  }
  return raw;
}

export class WeatherConnectorError extends Error {
  constructor(statusCode, code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'WeatherConnectorError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

export function weatherConfigFromEnv(env = process.env) {
  const provider = env.DESKBOT_WEATHER_PROVIDER?.trim() || DEFAULT_PROVIDER;
  return {
    enabled: parseBoolean(env.DESKBOT_WEATHER_ENABLED, false),
    endpoint: normalizeEndpoint(env.DESKBOT_WEATHER_URL, provider),
    provider,
    token: env.DESKBOT_WEATHER_TOKEN?.trim() || null,
    authMode: env.DESKBOT_WEATHER_AUTH_MODE?.trim().toLowerCase() || 'api-key',
    location: env.DESKBOT_WEATHER_LOCATION?.trim() || null,
    latitude: parseCoordinate(env.DESKBOT_WEATHER_LATITUDE, 'DESKBOT_WEATHER_LATITUDE'),
    longitude: parseCoordinate(env.DESKBOT_WEATHER_LONGITUDE, 'DESKBOT_WEATHER_LONGITUDE'),
    timezone: env.DESKBOT_WEATHER_TIMEZONE?.trim() || DEFAULT_TIMEZONE,
    timeoutMs: Math.min(Math.max(Number.parseInt(env.DESKBOT_WEATHER_TIMEOUT_MS ?? '8000', 10) || 8000, 250), 120000),
    ttlMs: Math.min(Math.max(Number.parseInt(env.DESKBOT_WEATHER_TTL_MS ?? '1800000', 10) || 1800000, 60000), 24 * 60 * 60 * 1000),
    forecastTtlMs: {
      minutely: Math.min(Math.max(Number.parseInt(env.DESKBOT_WEATHER_MINUTELY_TTL_MS ?? String(DEFAULT_FORECAST_TTLS.minutely), 10) || DEFAULT_FORECAST_TTLS.minutely, 60000), 24 * 60 * 60 * 1000),
      hourly: Math.min(Math.max(Number.parseInt(env.DESKBOT_WEATHER_HOURLY_TTL_MS ?? String(DEFAULT_FORECAST_TTLS.hourly), 10) || DEFAULT_FORECAST_TTLS.hourly, 60000), 24 * 60 * 60 * 1000),
      daily: Math.min(Math.max(Number.parseInt(env.DESKBOT_WEATHER_DAILY_TTL_MS ?? String(DEFAULT_FORECAST_TTLS.daily), 10) || DEFAULT_FORECAST_TTLS.daily, 60000), 7 * 24 * 60 * 60 * 1000),
    },
    confidence: env.DESKBOT_WEATHER_CONFIDENCE === undefined ? 0.9 : Number(env.DESKBOT_WEATHER_CONFIDENCE),
  };
}

export function createWeatherConnector({
  now = () => new Date(),
  fetchImpl = globalThis.fetch,
  config = weatherConfigFromEnv(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  const resolved = {
    enabled: config.enabled === true,
    provider: config.provider || DEFAULT_PROVIDER,
    endpoint: normalizeEndpoint(config.endpoint, config.provider || DEFAULT_PROVIDER),
    token: config.token?.trim() || null,
    authMode: config.authMode?.trim().toLowerCase() || 'api-key',
    location: config.location || null,
    latitude: parseCoordinate(config.latitude, 'latitude'),
    longitude: parseCoordinate(config.longitude, 'longitude'),
    timezone: config.timezone || DEFAULT_TIMEZONE,
    timeoutMs: Math.min(Math.max(Number.parseInt(config.timeoutMs, 10) || 8000, 250), 120000),
    ttlMs: Math.min(Math.max(Number.parseInt(config.ttlMs, 10) || 1800000, 60000), 24 * 60 * 60 * 1000),
    forecastTtlMs: {
      minutely: Math.min(Math.max(Number.parseInt(config.forecastTtlMs?.minutely, 10) || DEFAULT_FORECAST_TTLS.minutely, 60000), 24 * 60 * 60 * 1000),
      hourly: Math.min(Math.max(Number.parseInt(config.forecastTtlMs?.hourly, 10) || DEFAULT_FORECAST_TTLS.hourly, 60000), 24 * 60 * 60 * 1000),
      daily: Math.min(Math.max(Number.parseInt(config.forecastTtlMs?.daily, 10) || DEFAULT_FORECAST_TTLS.daily, 60000), 7 * 24 * 60 * 60 * 1000),
    },
    confidence: Number.isFinite(config.confidence) && config.confidence >= 0 && config.confidence <= 1 ? config.confidence : 0.9,
  };
  let lastAttemptAt = null;
  let lastSuccessAt = null;
  let lastError = null;
  let lastResult = null;
  const forecastCache = new Map();
  const forecastErrors = new Map();

  function forecastStatus() {
    return Object.fromEntries(FORECAST_KINDS.map((kind) => {
      const cached = forecastCache.get(kind);
      const expiresAt = cached?.expires_at ?? null;
      const fresh = expiresAt ? now().getTime() < Date.parse(expiresAt) : false;
      return [kind, {
        kind,
        status: fresh ? 'fresh' : cached ? 'stale' : 'unavailable',
        last_success_at: cached?.fetched_at ?? null,
        freshness: fresh ? 'fresh' : cached ? 'stale' : 'unavailable',
        ttl_ms: resolved.forecastTtlMs[kind],
        expires_at: expiresAt,
        endpoint: safeEndpointLabel(resolved.provider === 'qweather' ? (() => {
          try { return qweatherForecastEndpoint(resolved.endpoint, kind); } catch { return null; }
        })() : resolved.endpoint),
        last_error: forecastErrors.get(kind) ?? null,
      }];
    }));
  }

  function forecastSnapshot() {
    return Object.fromEntries(FORECAST_KINDS.map((kind) => [kind, forecastCache.get(kind)?.data ?? null]));
  }

  function configured() {
    return resolved.enabled
      && resolved.latitude !== null
      && resolved.longitude !== null
      && Boolean(safeEndpointLabel(resolved.endpoint))
      && (resolved.provider !== 'qweather' || Boolean(resolved.token));
  }

  function status() {
    const expiresAt = lastSuccessAt
      ? new Date(Date.parse(lastSuccessAt) + resolved.ttlMs).toISOString()
      : null;
    const freshness = !lastSuccessAt
      ? 'unavailable'
      : now().getTime() < Date.parse(expiresAt)
        ? 'fresh'
        : 'stale';
    return {
      schema: 'foundry.weather-connector-status.v0.1',
      source_id: 'weather',
      kind: 'external_provider',
      enabled: resolved.enabled,
      configured: configured(),
      status: configured() ? (lastError ? 'error' : (lastSuccessAt ? 'fresh' : 'ready')) : (resolved.enabled ? 'not_configured' : 'disabled'),
      connection: configured() ? (lastError ? 'failed' : 'ready_for_refresh') : 'not_configured',
      provider: resolved.provider,
      auth_mode: resolved.provider === 'qweather' ? resolved.authMode : null,
      endpoint: safeEndpointLabel(resolved.endpoint),
      location: resolved.location,
      coordinates: resolved.latitude === null || resolved.longitude === null
        ? null
        : { latitude: resolved.latitude, longitude: resolved.longitude },
      timezone: resolved.timezone,
      credential_configured: resolved.provider === 'qweather' ? Boolean(resolved.token) : null,
      last_attempt_at: lastAttemptAt,
      last_success_at: lastSuccessAt,
      freshness,
      ttl_ms: resolved.ttlMs,
      expires_at: expiresAt,
      last_error: lastError,
      forecast: forecastStatus(),
      credential_policy: resolved.provider === 'qweather'
        ? '和风天气 token 只从服务器环境变量 DESKBOT_WEATHER_TOKEN 读取，不进入网页、事件或日志。'
        : '该 connector 使用公开天气端点；若替换为需认证 provider，密钥只从服务器环境变量读取，不进入网页、事件或日志。',
    };
  }

  async function refresh({ force = false } = {}) {
    if (!configured()) {
      throw new WeatherConnectorError(503, 'weather_connector_not_configured', '天气 connector 未配置；需要启用开关、经纬度和有效端点');
    }
    if (!force && lastResult && lastSuccessAt) {
      const expiresAt = Date.parse(lastSuccessAt) + resolved.ttlMs;
      if (now().getTime() < expiresAt) {
        return {
          ...lastResult,
          cached: true,
          connector: status(),
        };
      }
    }
    const attemptedAt = now().toISOString();
    lastAttemptAt = attemptedAt;
    lastError = null;
    const url = new URL(resolved.endpoint);
    const qweatherV1 = resolved.provider === 'qweather' && /\/weather\/v1\/current\/?$/i.test(url.pathname);
    if (resolved.provider === 'qweather' && qweatherV1) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${resolved.latitude}/${resolved.longitude}`;
      url.searchParams.set('localTime', 'true');
    } else if (resolved.provider === 'qweather') {
      // QWeather Web API v7 accepts longitude,latitude in `location`.
      url.searchParams.set('location', `${resolved.longitude},${resolved.latitude}`);
      url.searchParams.set('lang', 'zh');
    } else {
      url.searchParams.set('latitude', String(resolved.latitude));
      url.searchParams.set('longitude', String(resolved.longitude));
      url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m');
      url.searchParams.set('timezone', resolved.timezone);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);
    let response;
    try {
      const qweatherHeaders = resolved.provider === 'qweather'
        ? resolved.authMode === 'bearer'
          ? { authorization: `Bearer ${resolved.token}` }
          : resolved.authMode === 'query'
            ? {}
            : { 'X-QW-Api-Key': resolved.token }
        : {};
      if (resolved.provider === 'qweather' && resolved.authMode === 'query') {
        url.searchParams.set('key', resolved.token);
      }
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...qweatherHeaders,
        },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      lastError = { code: aborted ? 'weather_connector_timeout' : 'weather_connector_transport_error', message: aborted ? '天气 provider 请求超时' : '天气 provider 请求失败', retryable: true };
      throw new WeatherConnectorError(504, lastError.code, lastError.message, { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
    if (!response || !response.ok) {
      const statusCode = Number.isInteger(response?.status) ? response.status : 502;
      lastError = { code: 'weather_provider_http_error', message: `天气 provider 返回 HTTP ${statusCode}`, retryable: statusCode >= 500 || statusCode === 429 };
      throw new WeatherConnectorError(statusCode >= 500 || statusCode === 429 ? 502 : 424, lastError.code, lastError.message, { retryable: lastError.retryable });
    }
    let body;
    try {
      body = await response.json();
    } catch {
      lastError = { code: 'weather_provider_invalid_json', message: '天气 provider 返回的不是有效 JSON', retryable: false };
      throw new WeatherConnectorError(502, lastError.code, lastError.message);
    }
    if (resolved.provider === 'qweather') {
      // v7 uses a top-level `code`; v1 success payloads expose the
      // observation fields directly and may omit that legacy field.
      const hasV1Payload = qweatherV1
        && body?.condition
        && body?.temperature
        && body?.humidity !== undefined
        && body?.wind;
      if ((!qweatherV1 && String(body?.code ?? '') !== '200') || (qweatherV1 && !hasV1Payload && String(body?.code ?? '') !== '200')) {
        lastError = { code: 'weather_provider_api_error', message: `天气 provider 返回 code ${String(body?.code ?? 'unknown')}`, retryable: String(body?.code ?? '').startsWith('5') };
        throw new WeatherConnectorError(lastError.retryable ? 502 : 424, lastError.code, lastError.message, { retryable: lastError.retryable });
      }
      const current = qweatherV1 ? body : body?.now;
      if (!current || typeof current !== 'object') {
        lastError = { code: 'weather_provider_invalid_payload', message: qweatherV1 ? '和风天气 v1 provider 缺少实时天气对象' : '和风天气 provider 缺少 now 观测对象', retryable: false };
        throw new WeatherConnectorError(502, lastError.code, lastError.message);
      }
      const temperature = Number(qweatherV1 ? current.temperature?.value : current.temp);
      const humidity = Number(current.humidity);
      const wind = qweatherV1 ? Number(current.wind?.speed?.value) : Number(current.windSpeed) / 3.6;
      const condition = qweatherV1 ? current.condition?.text : current.text;
      if (![temperature, humidity, wind].every(Number.isFinite) || typeof condition !== 'string' || condition.trim() === '') {
        lastError = { code: 'weather_provider_invalid_payload', message: qweatherV1 ? '和风天气 v1 provider 的实时天气字段不完整' : '和风天气 provider 的 now 字段不完整', retryable: false };
        throw new WeatherConnectorError(502, lastError.code, lastError.message);
      }
      const fetchedAt = now().toISOString();
      const expiresAt = new Date(now().getTime() + resolved.ttlMs).toISOString();
      const observedAt = qweatherDateTime(qweatherV1 ? null : current.obsTime);
      const snapshot = {
        location: resolved.location,
        condition: condition.trim(),
        temperature_c: temperature,
        humidity: qweatherV1 ? humidity : humidity / 100,
        wind_mps: wind,
        observed_at: observedAt,
        provider: resolved.provider,
      };
      lastSuccessAt = fetchedAt;
      lastError = null;
      const event = {
        event_id: `connector-weather-${Date.now()}-${randomUUID().slice(0, 8)}`,
        type: 'world.mutation',
        source: 'deskbot-weather-connector',
        character_id: DEFAULT_CHARACTER_ID,
        layer: 'weather',
        source_kind: 'external_provider',
        confidence: resolved.confidence,
        occurred_at: fetchedAt,
        observed_at: observedAt || fetchedAt,
        provider: resolved.provider,
        provenance: {
          connector: 'weather',
          provider: resolved.provider,
          endpoint: safeEndpointLabel(resolved.endpoint),
          manually_injected: false,
          fetched_at: fetchedAt,
          ttl_ms: resolved.ttlMs,
          expires_at: expiresAt,
          provider_observed_at: qweatherV1 ? null : current.obsTime ?? null,
          timezone: resolved.timezone,
          qweather_code: body.code === undefined ? null : String(body.code),
        },
        payload: { action: 'update_weather', snapshot },
      };
      lastResult = { event, snapshot };
      return { connector: status(), event, snapshot, cached: false };
    }

    const current = body?.current;
    if (!current || typeof current !== 'object') {
      lastError = { code: 'weather_provider_invalid_payload', message: '天气 provider 缺少 current 观测对象', retryable: false };
      throw new WeatherConnectorError(502, lastError.code, lastError.message);
    }
    const temperature = finiteNumber(current.temperature_2m);
    const humidity = finiteNumber(current.relative_humidity_2m);
    const wind = finiteNumber(current.wind_speed_10m);
    const code = Number.isInteger(current.weather_code) ? current.weather_code : null;
    if (temperature === null || humidity === null || wind === null || code === null) {
      lastError = { code: 'weather_provider_invalid_payload', message: '天气 provider 的 current 字段不完整', retryable: false };
      throw new WeatherConnectorError(502, lastError.code, lastError.message);
    }
    const fetchedAt = now().toISOString();
    const expiresAt = new Date(now().getTime() + resolved.ttlMs).toISOString();
    const observedAt = providerDateTime(current.time, body.utc_offset_seconds);
    const snapshot = {
      location: resolved.location,
      condition: WEATHER_CODE_LABELS[code] || `天气代码 ${code}`,
      temperature_c: temperature,
      humidity: humidity / 100,
      wind_mps: wind,
      observed_at: observedAt,
      provider: resolved.provider,
    };
    lastSuccessAt = fetchedAt;
    lastError = null;
    const event = {
      event_id: `connector-weather-${Date.now()}-${randomUUID().slice(0, 8)}`,
      type: 'world.mutation',
      source: 'deskbot-weather-connector',
      character_id: DEFAULT_CHARACTER_ID,
      layer: 'weather',
      source_kind: 'external_provider',
      confidence: resolved.confidence,
      occurred_at: fetchedAt,
      observed_at: observedAt || fetchedAt,
      provider: resolved.provider,
      provenance: {
        connector: 'weather',
        provider: resolved.provider,
        endpoint: safeEndpointLabel(resolved.endpoint),
        manually_injected: false,
        fetched_at: fetchedAt,
        ttl_ms: resolved.ttlMs,
        expires_at: expiresAt,
        provider_observed_at: current.time ?? null,
        timezone: body.timezone ?? resolved.timezone,
        weather_code: code,
      },
      payload: { action: 'update_weather', snapshot },
    };
    lastResult = { event, snapshot };
    return { connector: status(), event, snapshot, cached: false };
  }

  async function fetchForecastKind(kind) {
    let url;
    try {
      url = resolved.provider === 'qweather'
        ? qweatherForecastEndpoint(resolved.endpoint, kind)
        : new URL(resolved.endpoint);
    } catch (error) {
      const expected = error instanceof WeatherConnectorError;
      const detail = { code: expected ? error.code : 'weather_forecast_endpoint_invalid', message: expected ? error.message : '天气预报 endpoint 无效', retryable: false };
      forecastErrors.set(kind, detail);
      throw error;
    }
    if (resolved.provider === 'qweather') {
      url.searchParams.set('location', `${resolved.longitude},${resolved.latitude}`);
      url.searchParams.set('lang', 'zh');
    } else {
      url.searchParams.set('latitude', String(resolved.latitude));
      url.searchParams.set('longitude', String(resolved.longitude));
      url.searchParams.set('timezone', resolved.timezone);
      if (kind === 'minutely') {
        url.searchParams.set('minutely_15', 'precipitation,weather_code');
      } else if (kind === 'hourly') {
        url.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m');
      } else {
        url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum');
      }
      url.searchParams.set('forecast_days', kind === 'daily' ? '7' : '2');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);
    let response;
    try {
      const qweatherHeaders = resolved.provider === 'qweather'
        ? resolved.authMode === 'bearer'
          ? { authorization: `Bearer ${resolved.token}` }
          : resolved.authMode === 'query'
            ? {}
            : { 'X-QW-Api-Key': resolved.token }
        : {};
      if (resolved.provider === 'qweather' && resolved.authMode === 'query') url.searchParams.set('key', resolved.token);
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...qweatherHeaders },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      const detail = { code: aborted ? 'weather_forecast_timeout' : 'weather_forecast_transport_error', message: aborted ? '天气预报 provider 请求超时' : '天气预报 provider 请求失败', retryable: true };
      forecastErrors.set(kind, detail);
      throw new WeatherConnectorError(504, detail.code, detail.message, { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
    if (!response || !response.ok) {
      const statusCode = Number.isInteger(response?.status) ? response.status : 502;
      const detail = { code: 'weather_forecast_provider_http_error', message: `天气预报 provider 返回 HTTP ${statusCode}`, retryable: statusCode >= 500 || statusCode === 429 };
      forecastErrors.set(kind, detail);
      throw new WeatherConnectorError(detail.retryable ? 502 : 424, detail.code, detail.message, { retryable: detail.retryable });
    }
    let body;
    try {
      body = await response.json();
    } catch {
      const detail = { code: 'weather_forecast_invalid_json', message: '天气预报 provider 返回的不是有效 JSON', retryable: false };
      forecastErrors.set(kind, detail);
      throw new WeatherConnectorError(502, detail.code, detail.message);
    }
    const fetchedAt = now().toISOString();
    const expiresAt = forecastExpiry(now(), resolved.forecastTtlMs[kind]);
    let data;
    try {
      data = resolved.provider === 'qweather'
        ? normalizeQWeatherForecast(kind, body, resolved, fetchedAt, expiresAt)
        : normalizeOpenMeteoForecast(kind, body, resolved, fetchedAt, expiresAt);
    } catch (error) {
      const detail = {
        code: error.code ?? 'weather_forecast_invalid_payload',
        message: error.message ?? '天气预报 provider 数据不完整',
        retryable: error.retryable === true,
      };
      forecastErrors.set(kind, detail);
      throw error instanceof WeatherConnectorError ? error : new WeatherConnectorError(502, detail.code, detail.message);
    }
    forecastCache.set(kind, { data, fetched_at: fetchedAt, expires_at: expiresAt });
    forecastErrors.delete(kind);
    return data;
  }

  async function forecast({ kind = 'all', kinds = undefined, force = false } = {}) {
    if (!configured()) {
      throw new WeatherConnectorError(503, 'weather_connector_not_configured', '天气 connector 未配置；需要启用开关、经纬度和有效端点');
    }
    const requestedKinds = normalizeForecastKinds(kinds ?? kind);
    const result = {};
    const cached = {};
    for (const forecastKind of requestedKinds) {
      const existing = forecastCache.get(forecastKind);
      const fresh = existing?.expires_at && now().getTime() < Date.parse(existing.expires_at);
      if (!force && fresh) {
        result[forecastKind] = existing.data;
        cached[forecastKind] = true;
      } else {
        result[forecastKind] = await fetchForecastKind(forecastKind);
        cached[forecastKind] = false;
      }
    }
    return {
      forecast: result,
      cached,
      requested_kinds: requestedKinds,
      connector: status(),
    };
  }

  return { refresh, status, forecast, forecastStatus, forecastSnapshot };
}

export { DEFAULT_ENDPOINT, DEFAULT_QWEATHER_ENDPOINT, DEFAULT_PROVIDER, DEFAULT_FORECAST_TTLS, FORECAST_KINDS, WEATHER_CODE_LABELS };
