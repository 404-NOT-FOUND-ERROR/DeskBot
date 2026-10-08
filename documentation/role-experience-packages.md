# Role Experience Packages

`deskbot.role-experience-package.v1` is the authored contract for a role
direction. It keeps a role's identity, everyday choices, world hooks,
expression, voice/screen intent, and virtual appearance together so those
surfaces can evolve as one package.

## Boundaries

- A package is a virtual experience definition, not a skill certificate.
- Applying a package never writes a world fact, grants a resource, changes a
  physical shell, or accepts a user choice.
- The durable individual remains `shaping-001`; `form` and `vocation` are
  independently composable axes.
- Same-axis packages replace the previous package only through the existing
  role proposal/trial/stage state machine.
- Invalid, deprecated, or conflicting packages fall back to
  `miaowu-baseline` and return an audit reason.

## Package fields

`identity` describes the role's premise and first-person anchor. `life` holds
interests, places, actions and the authored activity. `world` contains Scene,
NPC and possible-beat hooks. `expression` holds speech presence, catchphrases,
triggers, TTS and screen hints. `appearance` is a virtual design layer that
keeps the stable DeskBot recognition anchors. `composition` declares fallback,
axis replacement and conflicts.

The registry currently contains the baseline, 荷叶青蛙, 工坊学徒, 灶边厨师,
星空观察者 and 云朵梦境生物. P1 migrates existing runtime modules to read
these authored packages; P2-P5 add complete vertical behavior and new content.

