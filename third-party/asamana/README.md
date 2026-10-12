# Asamana reference attribution

Upstream: https://github.com/dreamscroll-lab/asamana

Reviewed revision: e9fc862642369ba8b177595d2f8e3f20c1636da4

License: Apache-2.0; the upstream license is reproduced in LICENSE in this directory. No root NOTICE file was present in the reviewed checkout.

DeskBot's migration is a JavaScript/TypeScript adaptation of design and algorithm ideas from `core/interfaces/trace.py`, `agent/memory_ranking.py`, `agent/memory.py`, `engine/event_seq.py`, and the frontend refresh/playback patterns. The upstream Python engine, assets and example stores run only in the separate local reference checkout; they are not copied into DeskBot's canonical runtime.

Adaptation changes: audit-only runtime contracts and content fingerprints; SQLite-compatible persistence; read-only lexical memory retrieval with DeskBot's fact/interpretation/hearsay boundaries and actor filtering; canonical mutation-sequence feed ordering; refresh-generation guards. See documentation/asamana-review.md for the full source mapping and capabilities left unimplemented.
