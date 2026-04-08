/**
 * Navigation graph: stores screen nodes and action edges.
 * Enables deterministic replay of known paths between screens.
 */

import { readFile, writeFile } from 'node:fs/promises';
import {
  ScreenNode,
  GraphEdge,
  NavigationGraphData,
  ActionDescriptor,
} from './types';

const GRAPH_VERSION = 1;

function actionKey(action: ActionDescriptor): string {
  if (action.type === 'tap' && action.target) {
    const t = action.target;
    return `tap:${t.resourceId || t.text || t.contentDesc || t.index || 'none'}`;
  }
  if (action.type === 'deeplink') {
    return `deeplink:${action.deepLink || 'none'}`;
  }
  if (action.type === 'type') {
    return `type:${action.text || 'none'}`;
  }
  if (action.type === 'scroll') {
    return `scroll:${action.direction || 'down'}`;
  }
  return action.type;
}

function edgeId(from: string, to: string, action: ActionDescriptor): string {
  return `${from}--${actionKey(action)}--${to}`;
}

export class NavigationGraph {
  private nodes: Map<string, ScreenNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private adjacency: Map<string, Set<string>> = new Map();

  constructor(data?: NavigationGraphData) {
    if (data) {
      for (const [fp, node] of Object.entries(data.nodes)) {
        this.nodes.set(fp, node);
      }
      for (const edge of data.edges) {
        this.edges.set(edge.id, edge);
        if (!this.adjacency.has(edge.from)) {
          this.adjacency.set(edge.from, new Set());
        }
        this.adjacency.get(edge.from)!.add(edge.id);
      }
    }
  }

  getOrCreateNode(
    fingerprint: string,
    screenType: string,
    appPackage: string,
    anchors: string[],
    actions: ActionDescriptor[],
  ): ScreenNode {
    const existing = this.nodes.get(fingerprint);
    if (existing) {
      existing.visitCount++;
      existing.lastVisitedAt = Date.now();
      // Merge new actions not already present
      for (const action of actions) {
        const key = actionKey(action);
        if (!existing.availableActions.some(a => actionKey(a) === key)) {
          existing.availableActions.push(action);
        }
      }
      return existing;
    }

    const node: ScreenNode = {
      fingerprint,
      screenType,
      appPackage,
      anchorElements: anchors,
      availableActions: actions,
      visitCount: 1,
      lastVisitedAt: Date.now(),
    };
    this.nodes.set(fingerprint, node);
    return node;
  }

  getNode(fingerprint: string): ScreenNode | undefined {
    return this.nodes.get(fingerprint);
  }

  recordTransition(
    from: string,
    to: string,
    action: ActionDescriptor,
    latencyMs: number,
    success: boolean,
  ): void {
    const eid = edgeId(from, to, action);
    const existing = this.edges.get(eid);

    if (existing) {
      if (success) {
        existing.successCount++;
        // Running average of latency
        const total = existing.avgLatencyMs * (existing.successCount - 1) + latencyMs;
        existing.avgLatencyMs = Math.round(total / existing.successCount);
      } else {
        existing.failCount++;
      }
      existing.lastUsedAt = Date.now();
    } else {
      const edge: GraphEdge = {
        id: eid,
        from,
        to,
        action,
        successCount: success ? 1 : 0,
        failCount: success ? 0 : 1,
        avgLatencyMs: latencyMs,
        lastUsedAt: Date.now(),
      };
      this.edges.set(eid, edge);
      if (!this.adjacency.has(from)) {
        this.adjacency.set(from, new Set());
      }
      this.adjacency.get(from)!.add(eid);
    }
  }

  getAvailableActions(fingerprint: string): ActionDescriptor[] {
    const node = this.nodes.get(fingerprint);
    const actions: ActionDescriptor[] = node ? [...node.availableActions] : [];

    // Add actions from known outgoing edges
    const edgeIds = this.adjacency.get(fingerprint);
    if (edgeIds) {
      for (const eid of edgeIds) {
        const edge = this.edges.get(eid)!;
        const key = actionKey(edge.action);
        if (!actions.some(a => actionKey(a) === key)) {
          actions.push(edge.action);
        }
      }
    }

    return actions;
  }

  /**
   * Find shortest path from source to target using Dijkstra.
   * Edge weight = 1 / successRate (prefers reliable paths).
   */
  findPath(from: string, to: string): ActionDescriptor[] | null {
    if (from === to) return [];
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;

    const dist = new Map<string, number>();
    const prev = new Map<string, { fingerprint: string; action: ActionDescriptor }>();
    const visited = new Set<string>();

    dist.set(from, 0);

    while (true) {
      // Find unvisited node with smallest distance
      let current: string | null = null;
      let minDist = Infinity;
      for (const [fp, d] of dist) {
        if (!visited.has(fp) && d < minDist) {
          minDist = d;
          current = fp;
        }
      }

      if (current === null) return null; // No path
      if (current === to) break; // Found

      visited.add(current);

      const edgeIds = this.adjacency.get(current);
      if (!edgeIds) continue;

      for (const eid of edgeIds) {
        const edge = this.edges.get(eid)!;
        if (visited.has(edge.to)) continue;

        const total = edge.successCount + edge.failCount;
        const successRate = total > 0 ? edge.successCount / total : 0.5;
        const weight = 1 / Math.max(successRate, 0.01); // Avoid division by zero

        const newDist = minDist + weight;
        if (newDist < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, newDist);
          prev.set(edge.to, { fingerprint: current, action: edge.action });
        }
      }
    }

    // Reconstruct path
    const path: ActionDescriptor[] = [];
    let cursor = to;
    while (cursor !== from) {
      const step = prev.get(cursor);
      if (!step) return null;
      path.unshift(step.action);
      cursor = step.fingerprint;
    }

    return path;
  }

  /**
   * Remove nodes not visited within maxAge milliseconds.
   */
  prune(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [fp, node] of this.nodes) {
      if (node.lastVisitedAt < cutoff) {
        this.nodes.delete(fp);
        // Remove edges involving this node
        const outgoing = this.adjacency.get(fp);
        if (outgoing) {
          for (const eid of outgoing) this.edges.delete(eid);
          this.adjacency.delete(fp);
        }
        // Remove incoming edges
        for (const [sourceFp, edgeIds] of this.adjacency) {
          for (const eid of edgeIds) {
            const edge = this.edges.get(eid);
            if (edge && edge.to === fp) {
              this.edges.delete(eid);
              edgeIds.delete(eid);
            }
          }
        }
        removed++;
      }
    }

    return removed;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  toJSON(): NavigationGraphData {
    const nodes: Record<string, ScreenNode> = {};
    for (const [fp, node] of this.nodes) {
      nodes[fp] = node;
    }
    return {
      version: GRAPH_VERSION,
      nodes,
      edges: Array.from(this.edges.values()),
    };
  }

  static fromJSON(data: NavigationGraphData): NavigationGraph {
    return new NavigationGraph(data);
  }

  async save(filePath: string): Promise<void> {
    const json = JSON.stringify(this.toJSON(), null, 2);
    await writeFile(filePath, json, 'utf-8');
  }

  static async load(filePath: string): Promise<NavigationGraph> {
    try {
      const json = await readFile(filePath, 'utf-8');
      const data = JSON.parse(json) as NavigationGraphData;
      return new NavigationGraph(data);
    } catch {
      return new NavigationGraph();
    }
  }
}
