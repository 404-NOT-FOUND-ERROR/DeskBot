import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createWeatherConnector,
  weatherConfigFromEnv,
} from '../src/weather-connector.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { once } from 'node:events';

const fixedTime = new Date('2026-09-07T08:00:00.000Z');

function fakeFetch(body, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return async (url, options) => {
    assert.equal(new URL(url).searchParams.get('latitude'), '31.2304');
    assert.equal(new URL(url).searchParams.get('longitude'), '121.4737');
    assert.equal(options.method, 'GET');
    assert.ok(options.signal);
    return { ok, status, async json() { return body; } };
  };
}

test('weather env configuration keeps endpoint and location outside credentials', () => {
  const config = weatherConfigFromEnv({
    DESKBOT_WEATHER_ENABLED: 'true',
    DESKBOT_WEATHER_LATITUDE: '31.2304',
    DESKBOT_WEATHER_LONGITUDE: '121.4737',
    DESKBOT_WEATHER_LOCATION: '上海',
    DESKBOT_WEATHER_PROVIDER: 'open-meteo',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.location, '上海');
  assert.equal(config.latitude, 31.2304);
  assert.equal(config.longitude, 121.4737);
});

test('qweather accepts a bare API host from the provider console', () => {
  const config = weatherConfigFromEnv({
    DESKBOT_WEATHER_ENABLED: 'true',
    DESKBOT_WEATHER_PROVIDER: 'qweather',
    DESKBOT_WEATHER_URL: 'example.re.qweatherapi.com',
    DESKBOT_WEATHER_LATITUDE: '31.2304',
    DESKBOT_WEATHER_LONGITUDE: '121.4737',
  });
  assert.equal(config.endpoint, 'https://example.re.qweatherapi.com/v7/weather/now');
});

test('qweather API key configuration uses X-QW-Api-Key without exposing it in status', async () => {
  const calls = [];
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: {
      enabled: true,
      provider: 'qweather',
      endpoint: 'https://devapi.qweather.com/v7/weather/now',
      token: 'secret-token-for-test',
      location: '上海',
      latitude: 31.2304,
      longitude: 121.4737,
      timezone: 'Asia/Shanghai',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), apiKey: options.headers['X-QW-Api-Key'], authorization: options.headers.authorization });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: '200',
            updateTime: '2026-09-07T16:00+08:00',
            now: {
              obsTime: '2026-09-07T15:40+08:00',
              temp: '26',
              text: '小雨',
              windSpeed: '18',
              humidity: '80',
            },
            refer: { sources: ['https://developer.qweather.com/attribution.html'] },
          };
        },
      };
    },
  });
  const result = await connector.refresh();
  assert.equal(new URL(calls[0].url).searchParams.get('location'), '121.4737,31.2304');
  assert.equal(calls[0].apiKey, 'secret-token-for-test');
  assert.equal(calls[0].authorization, undefined);
  assert.equal(new URL(calls[0].url).searchParams.has('key'), false);
  assert.equal(result.snapshot.condition, '小雨');
  assert.equal(result.snapshot.temperature_c, 26);
  assert.equal(result.snapshot.humidity, 0.8);
  assert.equal(Math.round(result.snapshot.wind_mps * 100) / 100, 5);
  assert.equal(result.snapshot.observed_at, '2026-09-07T07:40:00.000Z');
  assert.equal(result.event.provider, 'qweather');
  assert.equal(result.event.provenance.manually_injected, false);
  assert.equal(connector.status().credential_configured, true);
  assert.equal(connector.status().auth_mode, 'api-key');
  assert.equal(JSON.stringify(connector.status()).includes('secret-token-for-test'), false);
});

test('qweather bearer mode remains available for JWT credentials', async () => {
  let request;
  const connector = createWeatherConnector({
    config: {
      enabled: true,
      provider: 'qweather',
      authMode: 'bearer',
      endpoint: 'https://devapi.qweather.com/v7/weather/now',
      token: 'jwt-token-for-test',
      location: '上海',
      latitude: 31.2304,
      longitude: 121.4737,
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), headers: options.headers };
      return { ok: true, status: 200, async json() { return { code: '200', now: { obsTime: '2026-09-07T15:40+08:00', temp: '26', text: '晴', windSpeed: '18', humidity: '80' } }; } };
    },
  });
  await connector.refresh();
  assert.equal(request.headers.authorization, 'Bearer jwt-token-for-test');
  assert.equal(request.headers['X-QW-Api-Key'], undefined);
  assert.equal(new URL(request.url).searchParams.has('key'), false);
});

test('qweather v1 path is supported and incomplete credentials refuse refresh', async () => {
  let calls = 0;
  const configured = createWeatherConnector({
    config: {
      enabled: true,
      provider: 'qweather',
      endpoint: 'https://api.qweather.com/weather/v1/current',
      token: 'token',
      latitude: 31.23,
      longitude: 121.47,
    },
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(String(url), /\/weather\/v1\/current\/31\.23\/121\.47/);
      return { ok: true, status: 200, async json() { return { condition: { text: '晴' }, temperature: { value: 20 }, humidity: 0.5, wind: { speed: { value: 2 } } }; } };
    },
  });
  const result = await configured.refresh();
  assert.equal(result.snapshot.condition, '晴');
  assert.equal(result.snapshot.humidity, 0.5);
  assert.equal(result.snapshot.wind_mps, 2);
  assert.equal(result.snapshot.observed_at, null);
  assert.equal(calls, 1);
  const missingToken = createWeatherConnector({
    config: { enabled: true, provider: 'qweather', endpoint: 'https://devapi.qweather.com/v7/weather/now', latitude: 31.23, longitude: 121.47 },
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(() => missingToken.refresh(), (error) => error.code === 'weather_connector_not_configured');
  assert.equal(missingToken.status().credential_configured, false);
});

test('weather refresh reuses a fresh observation without another provider request', async () => {
  let calls = 0;
  let clock = new Date('2026-09-07T08:00:00.000Z');
  const connector = createWeatherConnector({
    now: () => clock,
    config: { enabled: true, endpoint: 'https://api.open-meteo.com/v1/forecast', provider: 'open-meteo', location: '上海', latitude: 31.2304, longitude: 121.4737, ttlMs: 1800000 },
    fetchImpl: async (url, options) => {
      calls += 1;
      return fakeFetch({ timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { time: '2026-09-07T16:00', temperature_2m: 26, relative_humidity_2m: 70, weather_code: 1, wind_speed_10m: 3 } })(url, options);
    },
  });
  const first = await connector.refresh();
  clock = new Date('2026-09-07T08:15:00.000Z');
  const second = await connector.refresh();
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.event.event_id, first.event.event_id);
  clock = new Date('2026-09-07T08:31:00.000Z');
  await connector.refresh();
  assert.equal(calls, 2);
});

test('forced weather refresh bypasses the fresh TTL for an explicit user request', async () => {
  let calls = 0;
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: { enabled: true, endpoint: 'https://api.open-meteo.com/v1/forecast', provider: 'open-meteo', location: '上海', latitude: 31.2304, longitude: 121.4737, ttlMs: 1800000 },
    fetchImpl: async (url, options) => {
      calls += 1;
      return fakeFetch({ timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { time: '2026-09-07T16:00', temperature_2m: 26 + calls, relative_humidity_2m: 70, weather_code: 1, wind_speed_10m: 3 } })(url, options);
    },
  });
  const first = await connector.refresh();
  const forced = await connector.refresh({ force: true });
  assert.equal(calls, 2);
  assert.equal(first.cached, false);
  assert.equal(forced.cached, false);
  assert.equal(forced.snapshot.temperature_c, 28);
});

test('weather connector normalizes provider payload into an auditable mutation event', async () => {
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: { enabled: true, endpoint: 'https://api.open-meteo.com/v1/forecast', provider: 'open-meteo', location: '上海', latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' },
    fetchImpl: fakeFetch({ timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { time: '2026-09-07T16:00', temperature_2m: 26.4, relative_humidity_2m: 73, weather_code: 61, wind_speed_10m: 4.2 } }),
  });
  assert.equal(connector.status().status, 'ready');
  const result = await connector.refresh();
  assert.equal(result.snapshot.condition, '小雨');
  assert.equal(result.snapshot.humidity, 0.73);
  assert.equal(result.snapshot.observed_at, '2026-09-07T08:00:00.000Z');
  assert.equal(result.event.layer, 'weather');
  assert.equal(result.event.source_kind, 'external_provider');
  assert.equal(result.event.provenance.manually_injected, false);
  assert.equal(result.event.provenance.fetched_at, fixedTime.toISOString());
  assert.equal(connector.status().last_success_at, fixedTime.toISOString());
});

test('weather connector exposes safe failure state without response body or credentials', async () => {
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: { enabled: true, endpoint: 'https://api.open-meteo.com/v1/forecast', provider: 'open-meteo', location: '上海', latitude: 31.2304, longitude: 121.4737 },
    fetchImpl: fakeFetch({}, { status: 503, ok: false }),
  });
  await assert.rejects(() => connector.refresh(), (error) => error.code === 'weather_provider_http_error');
  const status = connector.status();
  assert.equal(status.last_error.code, 'weather_provider_http_error');
  assert.match(status.last_error.message, /HTTP 503/);
  assert.equal(status.last_error.body, undefined);
});

test('disabled or incomplete weather connector refuses refresh without network access', async () => {
  let calls = 0;
  const connector = createWeatherConnector({ config: { enabled: false }, fetchImpl: async () => { calls += 1; } });
  await assert.rejects(() => connector.refresh(), (error) => error.code === 'weather_connector_not_configured');
  assert.equal(calls, 0);
  assert.equal(connector.status().status, 'disabled');
});

test('weather refresh endpoint commits connector event through canonical world and policy', async (t) => {
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: { enabled: true, endpoint: 'https://api.open-meteo.com/v1/forecast', provider: 'open-meteo', location: '上海', latitude: 31.2304, longitude: 121.4737 },
    fetchImpl: fakeFetch({ timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { time: '2026-09-07T16:00', temperature_2m: 29, relative_humidity_2m: 80, weather_code: 95, wind_speed_10m: 5 } }),
  });
  const server = createDeskBotServer({ now: () => fixedTime, websocket: false, weatherConnector: connector });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/connectors/weather/refresh`, { method: 'POST' });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.accepted, true);
  assert.equal(body.snapshot.condition, '雷雨');
  assert.equal(body.world_mutation.mutation.action, 'update_weather');
  assert.equal(body.interaction_decision.route, 'proactive_candidate');
  assert.equal(body.event.provenance.manually_injected, false);
  const world = await (await fetch(`${origin}/api/world`)).json();
  assert.equal(world.world.weather.snapshot.condition, '雷雨');
  const context = await (await fetch(`${origin}/api/context`)).json();
  const weatherSource = context.sources.find((source) => source.source_id === 'weather');
  assert.equal(weatherSource.status, 'fresh');
  assert.equal(weatherSource.provider, 'open-meteo');
});

test('chat latest-weather request performs a forced refresh before the real reply', async (t) => {
  let providerCalls = 0;
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: { enabled: true, endpoint: 'https://api.open-meteo.com/v1/forecast', provider: 'open-meteo', location: '上海', latitude: 31.2304, longitude: 121.4737 },
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      return fakeFetch({ timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { time: '2026-09-07T16:00', temperature_2m: 27, relative_humidity_2m: 60, weather_code: 2, wind_speed_10m: 2.5 } })(url, options);
    },
  });
  const server = createDeskBotServer({
    now: () => fixedTime,
    websocket: false,
    weatherConnector: connector,
    llm: { async complete() { return { provider: 'test', model: 'test', text: '已经查到上海现在的天气了。', trace: {} }; } },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: 'chat-weather-refresh-001', character_id: 'shaping-001', message: '请帮我请求最新天气。' }),
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(providerCalls, 1);
  assert.equal(body.turn.weather_refresh.status, 'refreshed');
  assert.equal(body.turn.canonical_world.snapshot.weather.snapshot.condition, '局部多云');
});

test('qweather forecast connector normalizes short-term, hourly, and daily data with per-kind cache', async () => {
  let calls = 0;
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: {
      enabled: true,
      provider: 'qweather',
      endpoint: 'https://example.re.qweatherapi.com/v7/weather/now',
      token: 'forecast-secret-for-test',
      location: '上海',
      latitude: 31.2304,
      longitude: 121.4737,
      forecastTtlMs: { minutely: 600000, hourly: 1800000, daily: 21600000 },
    },
    fetchImpl: async (url, options) => {
      calls += 1;
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('location'), '121.4737,31.2304');
      assert.equal(parsed.searchParams.has('key'), false);
      assert.equal(options.headers['X-QW-Api-Key'], 'forecast-secret-for-test');
      if (parsed.pathname.endsWith('/minutely/5m')) {
        return { ok: true, status: 200, async json() { return { code: '200', summary: '未来一小时无降水', minutely: [{ fxTime: '2026-09-07T16:05+08:00', precip: '0.0', type: 'none' }] }; } };
      }
      if (parsed.pathname.endsWith('/weather/24h')) {
        return { ok: true, status: 200, async json() { return { code: '200', hourly: [{ fxTime: '2026-09-07T17:00+08:00', temp: '27', text: '多云', pop: '20', precip: '0.1', humidity: '70', windSpeed: '18' }] }; } };
      }
      return { ok: true, status: 200, async json() { return { code: '200', daily: [{ fxDate: '2026-09-08', tempMin: '23', tempMax: '29', textDay: '小雨', textNight: '阴', pop: '60', precip: '3.2', humidity: '78' }] }; } };
    },
  });
  const first = await connector.forecast({ kinds: ['minutely', 'hourly', 'daily'] });
  assert.equal(calls, 3);
  assert.equal(first.forecast.minutely.items[0].description, '无降水');
  assert.equal(first.forecast.hourly.items[0].temperature_c, 27);
  assert.equal(Math.round(first.forecast.hourly.items[0].wind_mps * 100) / 100, 5);
  assert.equal(first.forecast.daily.items[0].temp_max_c, 29);
  const second = await connector.forecast({ kinds: ['minutely', 'hourly', 'daily'] });
  assert.deepEqual(second.cached, { minutely: true, hourly: true, daily: true });
  assert.equal(calls, 3);
  assert.equal(connector.status().forecast.hourly.status, 'fresh');
  assert.equal(JSON.stringify(connector.status()).includes('forecast-secret-for-test'), false);
});

test('forecast HTTP endpoint supports explicit kinds and keeps forecast out of canonical current-weather mutations', async (t) => {
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: {
      enabled: true,
      provider: 'qweather',
      endpoint: 'https://example.re.qweatherapi.com/v7/weather/now',
      token: 'forecast-route-secret',
      location: '上海',
      latitude: 31.2304,
      longitude: 121.4737,
    },
    fetchImpl: async (url) => {
      assert.match(String(url), /\/weather\/24h/);
      return { ok: true, status: 200, async json() { return { code: '200', hourly: [{ fxTime: '2026-09-07T17:00+08:00', temp: '27', text: '多云', pop: '20', precip: '0', humidity: '70', windSpeed: '18' }] }; } };
    },
  });
  const server = createDeskBotServer({ now: () => fixedTime, websocket: false, weatherConnector: connector });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/connectors/weather/forecast/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kinds: ['hourly'], force: true }),
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.accepted, true);
  assert.equal(body.requested_kinds[0], 'hourly');
  assert.equal(body.forecast.hourly.items[0].condition, '多云');
  const world = await (await fetch(`${origin}/api/world`)).json();
  assert.equal(world.world.weather.snapshot, null);
  const status = await (await fetch(`${origin}/api/connectors/weather/forecast`)).json();
  assert.equal(status.forecast.hourly.items[0].condition, '多云');
});

test('chat forecast request refreshes the matching kind before the character reply', async (t) => {
  const connector = createWeatherConnector({
    now: () => fixedTime,
    config: {
      enabled: true,
      provider: 'qweather',
      endpoint: 'https://example.re.qweatherapi.com/v7/weather/now',
      token: 'forecast-chat-secret',
      location: '上海',
      latitude: 31.2304,
      longitude: 121.4737,
    },
    fetchImpl: async (url) => {
      assert.match(String(url), /\/weather\/7d/);
      return { ok: true, status: 200, async json() { return { code: '200', daily: [{ fxDate: '2026-09-08', tempMin: '23', tempMax: '29', textDay: '小雨', textNight: '阴', pop: '60', precip: '3.2', humidity: '78' }] }; } };
    },
  });
  const server = createDeskBotServer({
    now: () => fixedTime,
    websocket: false,
    weatherConnector: connector,
    llm: { async complete() { return { provider: 'test', model: 'test', text: '明天有一场小雨概率。', trace: {} }; } },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: 'chat-weather-forecast-001', character_id: 'shaping-001', message: '明天天气预报怎么样？' }),
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.turn.weather_refresh.status, 'forecast_refreshed');
  assert.equal(body.turn.weather_refresh.kind, 'daily');
  assert.equal(body.turn.weather_refresh.forecast.items[0].condition_day, '小雨');
});
