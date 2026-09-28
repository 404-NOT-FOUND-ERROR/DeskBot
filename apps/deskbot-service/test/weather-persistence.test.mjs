import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createSqlitePersistence } from '../src/persistence.mjs';
import { createWeatherConnector } from '../src/weather-connector.mjs';

test('weather current and forecast caches survive connector recreation without credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-weather-persistence-'));
  const filename = join(directory, 'weather.sqlite');
  const fixedTime = new Date('2026-09-28T00:00:00.000Z');
  let calls = 0;
  const config = {
    enabled: true,
    provider: 'qweather',
    endpoint: 'https://example.re.qweatherapi.com/v7/weather/now',
    token: 'secret-that-must-not-persist',
    location: '上海',
    latitude: 31.2304,
    longitude: 121.4737,
    ttlMs: 1_800_000,
    forecastTtlMs: { minutely: 600_000, hourly: 1_800_000, daily: 21_600_000 },
  };
  const response = async (url) => {
    calls += 1;
    const path = new URL(url).pathname;
    if (path.endsWith('/weather/now')) return { ok: true, status: 200, async json() { return { code: '200', now: { obsTime: '2026-09-28T08:00+08:00', temp: '27', text: '多云', windSpeed: '18', humidity: '54' } }; } };
    if (path.endsWith('/weather/24h')) return { ok: true, status: 200, async json() { return { code: '200', hourly: [{ fxTime: '2026-09-28T09:00+08:00', temp: '28', text: '多云', pop: '10', precip: '0', humidity: '55', windSpeed: '18' }] }; } };
    if (path.endsWith('/weather/7d')) return { ok: true, status: 200, async json() { return { code: '200', daily: [{ fxDate: '2026-09-28', tempMin: '23', tempMax: '29', textDay: '多云', textNight: '晴', pop: '10', precip: '0', humidity: '55' }] }; } };
    if (path.endsWith('/minutely/5m')) return { ok: true, status: 200, async json() { return { code: '200', summary: '无降水', minutely: [{ fxTime: '2026-09-28T08:05+08:00', precip: '0', type: 'none' }] }; } };
    throw new Error(`unexpected path ${path}`);
  };
  const firstPersistence = createSqlitePersistence({ filename, now: () => fixedTime });
  const first = createWeatherConnector({ now: () => fixedTime, persistence: firstPersistence, config, fetchImpl: response });
  const current = await first.refresh({ force: true });
  const forecast = await first.forecast({ kinds: ['hourly', 'daily'], force: true });
  assert.equal(current.snapshot.temperature_c, 27);
  assert.equal(forecast.forecast.hourly.items[0].condition, '多云');
  assert.equal(calls, 3);
  firstPersistence.close();

  const secondPersistence = createSqlitePersistence({ filename, now: () => fixedTime });
  let restartedCalls = 0;
  const second = createWeatherConnector({
    now: () => fixedTime,
    persistence: secondPersistence,
    config,
    fetchImpl: async () => { restartedCalls += 1; throw new Error('must use durable cache'); },
  });
  const cachedCurrent = await second.refresh();
  const cachedForecast = await second.forecast({ kinds: ['hourly', 'daily'] });
  assert.equal(cachedCurrent.cached, true);
  assert.equal(cachedCurrent.snapshot.condition, '多云');
  assert.equal(cachedForecast.cached.hourly, true);
  assert.equal(cachedForecast.forecast.daily.items[0].temp_max_c, 29);
  assert.equal(restartedCalls, 0);
  assert.equal(JSON.stringify(second.status()).includes('secret-that-must-not-persist'), false);
  secondPersistence.close();
  rmSync(directory, { recursive: true, force: true });
});
