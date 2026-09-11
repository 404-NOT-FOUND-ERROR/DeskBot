"""Compatibility launcher for ``python server.py``.

The implementation lives in the importable ``voice_sidecar`` package; this
thin wrapper keeps the common direct-script workflow working as well.
"""

from voice_sidecar.server import VoiceHTTPServer, VoiceSidecar, create_server, main

__all__ = ["VoiceHTTPServer", "VoiceSidecar", "create_server", "main"]


if __name__ == "__main__":
    raise SystemExit(main())

