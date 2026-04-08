/**
 * Type definitions for the @device-stream/agent package.
 * Navigation graphs, skeleton fingerprinting, and LLM-optimized state.
 */

import { AccessibilityNode, DeviceStateSnapshot } from '@device-stream/core';

// ─── Tree Compression ───

/**
 * A compressed, flat UI element — stripped of noise, 1-indexed.
 * Produced by tree compression (port of native TreeCompressor + NodeSerializer).
 */
export interface CompressedNode {
  index: number;
  className: string;
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  clickable: boolean;
  scrollable: boolean;
  focused: boolean;
  enabled: boolean;
  checked?: boolean;
  selected?: boolean;
}

// ─── Zone Classification ───

export type ZoneType = 'ANCHOR' | 'CONTENT';

export interface ClassifiedNode {
  node: CompressedNode;
  zone: ZoneType;
}

// ─── Screen Context & Fingerprinting ───

export interface ScreenContext {
  toolbarTitle?: string;
  selectedTab?: string;
  appPackage: string;
  currentApp: string;
}

export interface ScreenFingerprint {
  skeletonHash: string;
  contextHash: string;
  fingerprint: string;
  context: ScreenContext;
  anchorSummary: string[];
}

// ─── Element Selector ───

export interface ElementSelector {
  index?: number;
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
}

// ─── Actions ───

export interface ActionDescriptor {
  type: 'tap' | 'back' | 'deeplink' | 'type' | 'scroll' | 'longPress';
  target?: ElementSelector;
  deepLink?: string;
  text?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
}

// ─── Navigation Graph ───

export interface ScreenNode {
  fingerprint: string;
  screenType: string;
  appPackage: string;
  anchorElements: string[];
  availableActions: ActionDescriptor[];
  visitCount: number;
  lastVisitedAt: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  action: ActionDescriptor;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  lastUsedAt: number;
}

export interface NavigationGraphData {
  version: number;
  nodes: Record<string, ScreenNode>;
  edges: GraphEdge[];
}

// ─── Agent Session ───

export interface AgentSessionOptions {
  serial: string;
  graphPath?: string;
  maxElements?: number;
  stabilityDelayMs?: number;
}

export interface CompactState {
  fingerprint: ScreenFingerprint;
  compactTree: string;
  elements: CompressedNode[];
  appInfo: DeviceStateSnapshot['appInfo'];
  deviceContext: DeviceStateSnapshot['deviceContext'];
  knownScreen: boolean;
  suggestedActions?: ActionDescriptor[];
}

export interface ActionResult {
  success: boolean;
  previousFingerprint: string;
  newFingerprint: string;
  transitioned: boolean;
  latencyMs: number;
  error?: string;
}

// Re-export core types used by consumers
export type { AccessibilityNode, DeviceStateSnapshot };
