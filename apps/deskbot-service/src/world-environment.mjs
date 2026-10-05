// A read-only projection. Weather never changes resource stocks here.
export function getWorldEnvironment(world, { now = new Date() } = {}) {
  const snapshot = world.weather?.snapshot;
  const observed = Date.parse(snapshot?.observed_at ?? '');
  const provenance = world.weather?.provenance;
  const expiry = Date.parse(provenance?.expires_at ?? '');
  const expiresAt = Number.isFinite(expiry) ? expiry : observed + 30 * 60_000;
  const fresh = Number.isFinite(observed) && observed <= now.getTime() + 60_000 && now.getTime() < expiresAt;
  const condition = fresh ? snapshot.condition ?? '' : '';
  const snow = /雪|snow/i.test(condition);
  const rain = !snow && /雨|rain|drizzle|storm/i.test(condition);
  const cloud = /云|阴|雾|cloud|overcast|fog/i.test(condition);
  const minute = world.logical_time?.minute_of_day ?? 720;
  const phase = minute < 330 || minute >= 1140 ? 'night' : minute < 420 ? 'dawn' : minute >= 1050 ? 'dusk' : 'day';
  return {
    schema: 'deskbot.world-environment.v1', projected_at: now.toISOString(),
    time: { mode: world.clock?.mode ?? 'simulation', time_zone: world.clock?.time_zone ?? 'Asia/Shanghai',
      minute_of_day: minute, phase, synced_at: world.clock?.synced_at ?? null,
      lighting_convention: 'fixed-local-dawn-dusk-v1' },
    weather: { status: !snapshot ? 'unavailable' : fresh ? 'fresh' : 'stale',
      location: snapshot?.location ?? null, condition: snapshot?.condition ?? null,
      provider: snapshot?.provider ?? null, observed_at: snapshot?.observed_at ?? null,
      expires_at: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null,
      temperature_c: fresh ? snapshot.temperature_c ?? null : null,
      wind_mps: fresh ? snapshot.wind_mps ?? null : null,
      precipitation: snow ? 'snow' : rain ? 'rain' : 'none',
      cloud_cover: rain || snow ? 0.9 : cloud ? 0.65 : 0,
      intensity: rain || snow ? (/大|强|heavy|storm/i.test(condition) ? 0.95 : /中|moderate/i.test(condition) ? 0.65 : 0.4) : 0,
    },
  };
}
