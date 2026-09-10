// Compatibility entry point for callers that use the contract's generic
// "device-bridge" name. The implementation lives in websocket-bridge.mjs so
// there is one transport/parser and one focused test suite.
export * from './websocket-bridge.mjs';

export { createWebSocketBridge as createDeviceBridge } from './websocket-bridge.mjs';
export { createWebSocketBridge as attachDeviceBridge } from './websocket-bridge.mjs';

