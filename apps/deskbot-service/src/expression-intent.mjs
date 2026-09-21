const EXPRESSION_INTENT_SCHEMA = 'deskbot.expression-intent.v1';

const PROFILES = Object.freeze({
  neutral: Object.freeze({ mode: 'companion', intensity: 0.35, pace: 'natural', prosody: 'warm_with_variation', tts_profile: 'miaowu-v1', speed: 1, pitch_semitones: 0, energy: 0.45 }),
  concerned: Object.freeze({ mode: 'supportive', intensity: 0.55, pace: 'slow', prosody: 'soft_low_energy', tts_profile: 'miaowu-gentle-v1', speed: 0.92, pitch_semitones: -0.5, energy: 0.32 }),
  happy: Object.freeze({ mode: 'playful', intensity: 0.75, pace: 'lively', prosody: 'bright_rising', tts_profile: 'miaowu-lively-v1', speed: 1.08, pitch_semitones: 0.6, energy: 0.72 }),
  tired: Object.freeze({ mode: 'reflective', intensity: 0.42, pace: 'slow', prosody: 'soft_low_energy', tts_profile: 'miaowu-gentle-v1', speed: 0.9, pitch_semitones: -0.4, energy: 0.3 }),
  alert: Object.freeze({ mode: 'boundary', intensity: 0.86, pace: 'direct', prosody: 'clear_firm', tts_profile: 'miaowu-clear-v1', speed: 1, pitch_semitones: 0, energy: 0.8 }),
  surprised: Object.freeze({ mode: 'curious', intensity: 0.8, pace: 'quick', prosody: 'bright_rising', tts_profile: 'miaowu-lively-v1', speed: 1.1, pitch_semitones: 0.8, energy: 0.78 }),
});

// These profiles are intentionally shared by a live trial and an accepted
// stage. The trial is temporary evidence; the stage is the durable answer to
// that evidence. Keeping one projection prevents text, screen and voice from
// drifting when a direction is accepted.
const ROLE_TRIAL_PROFILES = Object.freeze({
  wetland_frog: Object.freeze({ mode: 'playful', intensity_floor: 0.62, pace: 'springy', prosody: 'light_bouncy', screen_motif: 'ripple', screen_motion: 'bounce', speed: 1.06, pitch_semitones: 0.4, energy: 0.65 }),
  starry_observer: Object.freeze({ mode: 'curious', intensity_floor: 0.5, pace: 'measured', prosody: 'curious_with_pauses', screen_motif: 'star_glint', screen_motion: 'slow_blink', speed: 0.94, pitch_semitones: 0.1, energy: 0.48 }),
  workshop_maker: Object.freeze({ mode: 'attentive', intensity_floor: 0.6, pace: 'precise', prosody: 'crisp_focused', screen_motif: 'gear_tick', screen_motion: 'focus', speed: 1.02, pitch_semitones: -0.1, energy: 0.62 }),
  dream_cloud: Object.freeze({ mode: 'playful', intensity_floor: 0.58, pace: 'floating', prosody: 'airy_associative', screen_motif: 'cloud_drift', screen_motion: 'float', speed: 0.96, pitch_semitones: 0.35, energy: 0.52 }),
});

const ROLE_STAGE_PROFILES = ROLE_TRIAL_PROFILES;

const clone = (value) => structuredClone(value);

function finiteIntensity(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : fallback;
}

/**
 * Build the one expression object consumed by text, screen and voice routes.
 * It is derived from short interaction state, never from LLM prose.
 */
export function createExpressionIntent({
  expression = 'neutral',
  ttsStyle = undefined,
  evidenceRefs = [],
  interruptibility = 'barge_in',
} = {}) {
  const key = Object.prototype.hasOwnProperty.call(PROFILES, expression) ? expression : 'neutral';
  const profile = PROFILES[key];
  const effectiveProfile = ttsStyle === 'gentle' && key === 'neutral'
    ? PROFILES.concerned
    : ttsStyle === 'lively' && key === 'neutral'
      ? PROFILES.happy
      : profile;
  const refs = [...new Set((Array.isArray(evidenceRefs) ? evidenceRefs : []).filter((item) => typeof item === 'string' && item.trim() !== ''))];
  return {
    schema: EXPRESSION_INTENT_SCHEMA,
    version: 'v1',
    mode: effectiveProfile.mode,
    intensity: effectiveProfile.intensity,
    pace: effectiveProfile.pace,
    prosody: effectiveProfile.prosody,
    expression: key,
    interruptibility,
    evidence_refs: refs,
    consumers: {
      text: { expression: key, mode: effectiveProfile.mode },
      screen: { expression: key, intensity: effectiveProfile.intensity },
      tts: {
        profile_id: effectiveProfile.tts_profile,
        speed: effectiveProfile.speed,
        pitch_semitones: effectiveProfile.pitch_semitones,
        energy: effectiveProfile.energy,
        interruptibility,
      },
    },
  };
}

export function normalizeExpressionIntent(value, { evidenceRefs = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createExpressionIntent({ evidenceRefs });
  const base = createExpressionIntent({
    expression: value.expression,
    evidenceRefs: value.evidence_refs ?? evidenceRefs,
    interruptibility: value.interruptibility ?? 'barge_in',
  });
  return {
    ...base,
    mode: typeof value.mode === 'string' && value.mode.trim() ? value.mode : base.mode,
    intensity: finiteIntensity(value.intensity, base.intensity),
    pace: typeof value.pace === 'string' && value.pace.trim() ? value.pace : base.pace,
    prosody: typeof value.prosody === 'string' && value.prosody.trim() ? value.prosody : base.prosody,
  };
}

export function applyRoleTrialExpressionIntent(value, activeTrials = [], currentStages = []) {
  const base = normalizeExpressionIntent(value);
  const trial = Array.isArray(activeTrials) ? activeTrials.find((item) => item?.trial?.status === 'active') : null;
  const stage = !trial && Array.isArray(currentStages)
    ? currentStages.find((item) => item?.schema === 'deskbot.role-state.v1' || item?.direction_id)
    : null;
  const directionId = trial?.direction_id ?? stage?.direction_id ?? null;
  const profile = directionId ? ROLE_STAGE_PROFILES[directionId] : null;
  if (!directionId || !profile) return base;
  const restrained = ['supportive', 'boundary'].includes(base.mode)
    || ['concerned', 'alert', 'tired'].includes(base.expression);
  const roleOverlay = {
    proposal_id: trial?.proposal_id ?? stage?.proposal_id ?? null,
    stage_id: stage?.stage_id ?? null,
    direction_id: directionId,
    label: trial?.label ?? stage?.label ?? null,
    lifecycle: trial ? 'trial' : 'accepted',
    applied: !restrained,
    reason: restrained ? 'short_state_requires_restrained_expression' : trial ? 'active_role_trial' : 'accepted_role_stage',
  };
  if (restrained) return { ...base, role_trial: roleOverlay, role_stage: stage ? roleOverlay : undefined };
  return {
    ...base,
    mode: profile.mode,
    intensity: Math.max(base.intensity, profile.intensity_floor),
    pace: profile.pace,
    prosody: profile.prosody,
    role_trial: trial ? roleOverlay : undefined,
    role_stage: stage ? roleOverlay : undefined,
    consumers: {
      ...base.consumers,
      text: { ...base.consumers.text, mode: profile.mode, ...(trial ? { role_trial_direction: directionId } : { role_stage_direction: directionId }) },
      screen: { ...base.consumers.screen, intensity: Math.max(base.intensity, profile.intensity_floor), motif: profile.screen_motif, motion: profile.screen_motion, ...(trial ? { role_trial_direction: directionId } : { role_stage_direction: directionId }) },
      tts: { ...base.consumers.tts, speed: profile.speed, pitch_semitones: profile.pitch_semitones, energy: profile.energy, ...(trial ? { role_trial_direction: directionId } : { role_stage_direction: directionId }) },
    },
  };
}

export { EXPRESSION_INTENT_SCHEMA, ROLE_STAGE_PROFILES, ROLE_TRIAL_PROFILES };
