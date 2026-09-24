/** Best-effort synchronous check for WebGL support, used to decide whether to mount the 3D canvas at all. */
export function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}
