'use strict';

// Shim for react-reconciler/index.js
// Provides minimal exports needed by @react-three/fiber
export { ConcurrentRoot, LegacyRoot, SyncLane, DefaultLane, IdleLane } from './react-reconciler-constants.js';
export default {
  createContainer: () => ({}),
  updateContainer: () => {},
  getPublicInstance: () => null,
  injectIntoDevTools: () => {},
};
