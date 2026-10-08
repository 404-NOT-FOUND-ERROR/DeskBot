import { composeRoleExperiencePackages } from './role-experience-packages.mjs';

export const ROLE_EXPERIENCE_PERFORMANCE_SCHEMA = 'deskbot.role-experience-performance.v1';

/**
 * Read-only projection for UI, prompt, screen and future TTS consumers.
 * Virtual appearance is deliberately separate from the physical-shell flag.
 */
export function roleExperiencePerformance(directionIds = []) {
  const composed = composeRoleExperiencePackages(directionIds);
  const packages = composed.packages;
  const vocation = packages.find(item => item.axis === 'vocation');
  const form = packages.find(item => item.axis === 'form');
  const expression = packages.map(item => item.expression);
  const screen = packages.reduce((value, item) => ({ ...value, ...item.expression.screen }), {});
  const tts = packages.reduce((value, item) => ({ ...value, ...item.expression.tts }), {});
  return {
    schema: ROLE_EXPERIENCE_PERFORMANCE_SCHEMA,
    rule_version: composed.rule_version,
    package_ids: packages.map(item => item.package_id),
    identity: { labels: packages.map(item => item.identity.label), physical_shell_changed: false, identity_changed: false },
    virtual_appearance: {
      form: form ? { direction_id: form.direction_id, figure_form: form.appearance.figure_form, accessories: [...form.appearance.accessories], palette: { ...form.appearance.palette } } : null,
      vocation: vocation ? { direction_id: vocation.direction_id, figure_vocation: vocation.appearance.figure_vocation, accessories: [...vocation.appearance.accessories], palette: { ...vocation.appearance.palette } } : null,
      stable_anchors: ['seed-eyes', 'pear-shell', 'chest-pearl', 'stubby-feet', 'light-grains'],
      physical_shell_changed: false,
    },
    expression: {
      presence: expression.map(item => item.presence).filter(Boolean).join('；'),
      speech: expression.map(item => item.speech).filter(Boolean).join('；'),
      catchphrases: [...new Set(expression.flatMap(item => item.catchphrases ?? []))],
      triggers: expression.flatMap(item => item.triggers ?? []),
    },
    consumers: { screen, tts },
    fallback_used: composed.fallback_used,
    rejected: composed.rejected,
  };
}

