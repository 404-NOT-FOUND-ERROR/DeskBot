# Role Experience Package Roadmap v1

This branch implements the role-package pipeline through P5. Each stage is
kept in a separate commit so the public GitHub branch can be tested between
milestones.

| Stage | Delivered result | Verification |
|---|---|---|
| P0 | Versioned package contract, validation, composition, same-axis replacement, conflict rejection and baseline fallback | `role-experience-packages.test.mjs` |
| P1 | Existing role proposal, stage, prompt, life and expression modules read package-owned data | `role-experience-runtime.test.mjs`, role-stage regressions |
| P2 | 灶边厨师 vertical slice: life actions, Scene/NPC hooks, prompt, appearance and output consumers | `role-experience-world-life.test.mjs`, world-life regressions |
| P3 | Package-owned speech cues and catchphrases reach the prompt; one expression intent remains the output contract | `role-package-prompt-expression.test.mjs`, chat regressions |
| P4 | Unified virtual appearance, screen and TTS read model; physical shell remains explicitly unchanged | `role-experience-performance.test.mjs` |
| P5 | 潮痕探险家 package, legal `scout-route` activity, explore evidence and route hooks | `role-explorer.test.mjs`, practical-trial and development regressions |

## Public inspection

With the service running, read:

```text
GET http://127.0.0.1:4311/api/roles/experience-packages
GET http://127.0.0.1:4311/api/roles/experience-packages?direction_id=wetland_frog&direction_id=chef
```

The endpoint is read-only. It returns authored packages and a performance
projection; it cannot accept a role, alter the world, grant resources, or
change a physical shell.

## Boundary before P6

P0-P5 do not implement multi-source-driven automatic stage acceptance, real
TTS hardware, screen/firmware ACK, CAD, or mechanical shell replacement.
Those remain P6/P7 gates and must continue through the existing proposal,
trial, stage, canonical-world and device contracts.

