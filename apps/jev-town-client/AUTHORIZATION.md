# Jev Town derivative authorization record

## Scope

On 2026-09-24, the DeskBot project owner reported receiving direct confirmation from the repository's developer that this project may be modified and redistributed, including the source code and the bundled art assets: 3D models, textures, fonts, icons, music, and other third-party materials included with the project. The intended use is a DeskBot derivative and public deployment through the DeskBot GitHub repository.

This document records the project owner's report of that confirmation; it is not itself the developer's license grant. It is not a substitute for a signed license, a copyright assignment, or the original authors' notices. Before a public release, preserve the developer's written confirmation or a link to a verifiable authorization record, attach the original attribution and notices, and audit every dependency and asset for its own license terms.

## Integration boundary

The current work is a formal DeskBot integration of the Jev Town client. Jev Town supplies the 3D scene and projection UI; DeskBot remains the canonical world state, event validator, persistence layer, and mutation ledger. This repository must not silently relicense DeskBot, Jev Town, or any third-party dependency.

## Release checklist

- [ ] Add the developer's written authorization or a verifiable reference before publishing the derivative.
- [ ] Preserve upstream copyright and attribution notices.
- [ ] Generate a dependency and asset inventory for the release commit.
- [ ] Confirm the final GitHub repository's license text matches the authorization actually granted.
- [ ] Keep API keys, user data, and local DeskBot databases out of the repository.
