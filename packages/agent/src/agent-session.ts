/**
 * AgentSession: main orchestrator wrapping DeviceService with navigation graph,
 * skeleton fingerprinting, and LLM-optimized state capture.
 *
 * Every action automatically records state transitions into the graph,
 * enabling deterministic replay of known paths.
 */

import { DeviceService, DeviceStateSnapshot } from '@device-stream/core';
import {
  AgentSessionOptions,
  CompactState,
  ActionDescriptor,
  ActionResult,
  ScreenFingerprint,
} from './types';
import { compressTree } from './tree-compressor';
import { serializeToCompactText } from './compact-serializer';
import { classifyZones, extractContext, computeFingerprint } from './skeleton-fingerprint';
import { NavigationGraph } from './navigation-graph';
import { findElement, computeCenter } from './element-actions';

const DEFAULT_STABILITY_DELAY_MS = 500;
const DEFAULT_MAX_ELEMENTS = 50;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AgentSession {
  private deviceService: DeviceService;
  private serial: string;
  private graph: NavigationGraph;
  private graphPath: string;
  private maxElements: number;
  private stabilityDelayMs: number;
  private currentFingerprint: string | null = null;

  constructor(deviceService: DeviceService, options: AgentSessionOptions) {
    this.deviceService = deviceService;
    this.serial = options.serial;
    this.graph = new NavigationGraph();
    this.graphPath = options.graphPath || `nav-graph-${options.serial}.json`;
    this.maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
    this.stabilityDelayMs = options.stabilityDelayMs ?? DEFAULT_STABILITY_DELAY_MS;
  }

  async initialize(): Promise<void> {
    this.graph = await NavigationGraph.load(this.graphPath);
  }

  async getCompactState(): Promise<CompactState> {
    if (!this.deviceService.getDeviceState) {
      throw new Error('DeviceService does not support getDeviceState');
    }

    const snapshot = await this.deviceService.getDeviceState(this.serial);
    return this.buildCompactState(snapshot);
  }

  private buildCompactState(snapshot: DeviceStateSnapshot): CompactState {
    const elements = compressTree(snapshot.tree, this.maxElements);
    const compactTree = serializeToCompactText(elements);
    const classified = classifyZones(elements, snapshot.tree);
    const context = extractContext(snapshot.tree, snapshot.appInfo);
    const fingerprint = computeFingerprint(classified, context);

    this.currentFingerprint = fingerprint.fingerprint;

    const knownScreen = !!this.graph.getNode(fingerprint.fingerprint);
    const suggestedActions = knownScreen
      ? this.graph.getAvailableActions(fingerprint.fingerprint)
      : undefined;

    // Register node in graph
    this.graph.getOrCreateNode(
      fingerprint.fingerprint,
      `${fingerprint.context.appPackage}:${fingerprint.context.toolbarTitle || 'unknown'}`,
      fingerprint.context.appPackage,
      fingerprint.anchorSummary,
      suggestedActions || [],
    );

    return {
      fingerprint,
      compactTree,
      elements,
      appInfo: snapshot.appInfo,
      deviceContext: snapshot.deviceContext,
      knownScreen,
      suggestedActions,
    };
  }

  async performAction(action: ActionDescriptor): Promise<ActionResult> {
    const previousFingerprint = this.currentFingerprint || '';
    const startTime = Date.now();
    let success = true;
    let error: string | undefined;

    try {
      await this.executeAction(action);
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
    }

    await delay(this.stabilityDelayMs);

    const state = await this.getCompactState();
    const newFingerprint = state.fingerprint.fingerprint;
    const latencyMs = Date.now() - startTime;

    if (previousFingerprint) {
      this.graph.recordTransition(
        previousFingerprint,
        newFingerprint,
        action,
        latencyMs,
        success,
      );
      await this.graph.save(this.graphPath);
    }

    return {
      success,
      previousFingerprint,
      newFingerprint,
      transitioned: previousFingerprint !== newFingerprint,
      latencyMs,
      error,
    };
  }

  async navigateTo(targetFingerprint: string): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    if (!this.currentFingerprint) {
      await this.getCompactState();
    }

    if (this.currentFingerprint === targetFingerprint) return results;

    const path = this.graph.findPath(this.currentFingerprint!, targetFingerprint);
    if (!path) {
      throw new Error(
        `No known path from ${this.currentFingerprint} to ${targetFingerprint}`,
      );
    }

    for (const action of path) {
      const result = await this.performAction(action);
      results.push(result);

      if (!result.success) break;

      // If we arrived early, stop
      if (result.newFingerprint === targetFingerprint) break;

      // If we went off-track, try to re-plan
      if (result.transitioned && result.newFingerprint !== targetFingerprint) {
        const newPath = this.graph.findPath(result.newFingerprint, targetFingerprint);
        if (!newPath) break;
        // Continue with the new path in subsequent iterations
        path.splice(0, path.length, ...newPath);
      }
    }

    return results;
  }

  async tapElement(
    selector: { index?: number; text?: string; resourceId?: string; contentDesc?: string; className?: string },
  ): Promise<ActionResult> {
    const state = await this.getCompactState();
    const element = findElement(state.elements, selector);

    if (!element) {
      throw new Error(`Element not found: ${JSON.stringify(selector)}`);
    }

    const center = computeCenter(element);
    const action: ActionDescriptor = {
      type: 'tap',
      target: selector,
    };

    const previousFingerprint = this.currentFingerprint || '';
    const startTime = Date.now();
    let success = true;
    let error: string | undefined;

    try {
      await this.deviceService.tap(this.serial, center.x, center.y);
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
    }

    await delay(this.stabilityDelayMs);

    const newState = await this.getCompactState();
    const newFingerprint = newState.fingerprint.fingerprint;
    const latencyMs = Date.now() - startTime;

    if (previousFingerprint) {
      this.graph.recordTransition(
        previousFingerprint,
        newFingerprint,
        action,
        latencyMs,
        success,
      );
      await this.graph.save(this.graphPath);
    }

    return {
      success,
      previousFingerprint,
      newFingerprint,
      transitioned: previousFingerprint !== newFingerprint,
      latencyMs,
      error,
    };
  }

  getGraph(): NavigationGraph {
    return this.graph;
  }

  getCurrentFingerprint(): string | null {
    return this.currentFingerprint;
  }

  async close(): Promise<void> {
    await this.graph.save(this.graphPath);
  }

  private async executeAction(action: ActionDescriptor): Promise<void> {
    const s = this.serial;

    switch (action.type) {
      case 'tap': {
        if (action.target) {
          if (!this.deviceService.getDeviceState) {
            throw new Error('DeviceService does not support getDeviceState');
          }
          const snapshot = await this.deviceService.getDeviceState(s);
          const elements = compressTree(snapshot.tree, this.maxElements);
          const element = findElement(elements, action.target);
          if (!element) {
            throw new Error(`Element not found: ${JSON.stringify(action.target)}`);
          }
          const center = computeCenter(element);
          await this.deviceService.tap(s, center.x, center.y);
        }
        break;
      }
      case 'back': {
        if (!this.deviceService.back) {
          throw new Error('DeviceService does not support back');
        }
        await this.deviceService.back(s);
        break;
      }
      case 'deeplink': {
        if (!this.deviceService.openDeepLink) {
          throw new Error('DeviceService does not support openDeepLink');
        }
        await this.deviceService.openDeepLink(s, action.deepLink || '');
        break;
      }
      case 'type': {
        await this.deviceService.typeText(s, action.text || '');
        break;
      }
      case 'scroll': {
        if (!this.deviceService.scroll) {
          throw new Error('DeviceService does not support scroll');
        }
        await this.deviceService.scroll(s, action.direction || 'down');
        break;
      }
      case 'longPress': {
        if (!this.deviceService.longPress) {
          throw new Error('DeviceService does not support longPress');
        }
        if (action.target) {
          if (!this.deviceService.getDeviceState) {
            throw new Error('DeviceService does not support getDeviceState');
          }
          const snapshot = await this.deviceService.getDeviceState(s);
          const elements = compressTree(snapshot.tree, this.maxElements);
          const element = findElement(elements, action.target);
          if (!element) {
            throw new Error(`Element not found: ${JSON.stringify(action.target)}`);
          }
          const center = computeCenter(element);
          await this.deviceService.longPress(s, center.x, center.y);
        }
        break;
      }
    }
  }
}
