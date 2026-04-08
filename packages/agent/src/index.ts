/**
 * @device-stream/agent
 *
 * Navigation graphs, skeleton fingerprinting, and LLM-optimized device control.
 */

// Types
export {
  CompressedNode,
  ZoneType,
  ClassifiedNode,
  ScreenContext,
  ScreenFingerprint,
  ElementSelector,
  ActionDescriptor,
  ScreenNode,
  GraphEdge,
  NavigationGraphData,
  AgentSessionOptions,
  CompactState,
  ActionResult,
} from './types';

// Tree compression
export { compressTree } from './tree-compressor';

// Compact serialization
export { serializeToCompactText } from './compact-serializer';

// Skeleton fingerprinting
export { classifyZones, extractContext, computeFingerprint } from './skeleton-fingerprint';

// Navigation graph
export { NavigationGraph } from './navigation-graph';

// Element actions
export { findElement, computeCenter } from './element-actions';

// Agent session
export { AgentSession } from './agent-session';
