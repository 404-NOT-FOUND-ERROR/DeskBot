const DEFAULT_TIMEZONE = 'Asia/Shanghai';

function readPart(parts, type) {
  return parts.find((part) => part.type === type)?.value ?? null;
}

function formatClock(now, timezone) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.valueOf())) throw new TypeError('now must resolve to a valid Date');

  const parts = new Intl.DateTimeFormat('zh-CN-u-ca-gregory', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const year = readPart(parts, 'year');
  const month = readPart(parts, 'month');
  const day = readPart(parts, 'day');
  const weekday = readPart(parts, 'weekday');
  const hour = readPart(parts, 'hour');
  const minute = readPart(parts, 'minute');
  const second = readPart(parts, 'second');

  return {
    source_id: 'clock',
    status: 'active',
    freshness: 'live',
    timezone,
    iso_utc: date.toISOString(),
    local_date: `${year}-${month}-${day}`,
    local_time: `${hour}:${minute}:${second}`,
    weekday,
    display: `${year}年${month}月${day}日 ${weekday} ${hour}:${minute}`,
  };
}

function plannedSource({ sourceId, displayName, kind, contribution }) {
  return {
    source_id: sourceId,
    display_name: displayName,
    kind,
    enabled: false,
    status: 'not_configured',
    connection: 'not_configured',
    last_success_at: null,
    freshness: 'unavailable',
    contribution,
    credential_policy: '配置只引用服务器环境变量名；不在网页、事件或日志中保存密钥。',
  };
}

export function createContextSourceRegistry({
  now = () => new Date(),
  timezone = DEFAULT_TIMEZONE,
  weatherConnector = null,
} = {}) {
  function snapshot() {
    const clock = formatClock(now(), timezone);
    const weatherStatus = weatherConnector?.status?.() ?? null;
    const weatherForecast = weatherConnector?.forecastSnapshot?.() ?? null;
    return {
      schema: 'foundry.runtime-context.v0.1',
      generated_at: clock.iso_utc,
      real_time: clock,
      weather_forecast: weatherForecast,
      sources: [
        {
          source_id: 'clock',
          display_name: '本地时钟',
          kind: 'built_in',
          enabled: true,
          status: 'active',
          connection: 'server_local_clock',
          last_success_at: clock.iso_utc,
          freshness: 'live',
          contribution: '当前真实日期、时间和时区',
          timezone,
        },
        {
          ...plannedSource({
          sourceId: 'weather',
          displayName: '天气',
          kind: 'external_provider',
          contribution: '经配置和刷新后的环境天气；不会从角色语气中推断。',
          }),
          ...(weatherStatus ? {
            enabled: weatherStatus.enabled === true,
            status: weatherStatus.status ?? 'not_configured',
            connection: weatherStatus.connection ?? 'not_configured',
            last_success_at: weatherStatus.last_success_at ?? null,
            freshness: weatherStatus.freshness ?? 'unavailable',
            provider: weatherStatus.provider ?? null,
            location: weatherStatus.location ?? null,
            forecast: weatherStatus.forecast ?? null,
            last_error: weatherStatus.last_error ?? null,
          } : {}),
        },
        plannedSource({
          sourceId: 'news',
          displayName: '外部事件',
          kind: 'external_provider',
          contribution: '经来源和时间戳标注的外部新闻或大事件。',
        }),
        plannedSource({
          sourceId: 'custom',
          displayName: '自定义连接',
          kind: 'plugin_slot',
          contribution: '后续可接入日历、习惯或设备以外的指定数据源。',
        }),
      ],
    };
  }

  return { snapshot };
}

export { DEFAULT_TIMEZONE };
