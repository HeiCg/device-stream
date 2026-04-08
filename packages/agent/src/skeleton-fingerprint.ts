/**
 * Skeleton fingerprinting: identify screen "type" by hashing structural anchors only.
 * Ignores dynamic content inside scroll containers (feeds, lists, etc.).
 *
 * This allows agents to recognize "same screen, different content" — e.g.,
 * Instagram feed scrolled to different positions still fingerprints the same.
 */

import { createHash } from 'node:crypto';
import { AccessibilityNode, DeviceStateSnapshot } from '@device-stream/core';
import { CompressedNode, ClassifiedNode, ZoneType, ScreenContext, ScreenFingerprint } from './types';

// Scroll container classNames whose descendants are CONTENT zone
const SCROLL_CONTAINERS = new Set([
  // Android
  'RecyclerView', 'ListView', 'ScrollView', 'ViewPager', 'ViewPager2',
  'NestedScrollView', 'HorizontalScrollView',
  // iOS
  'UICollectionView', 'UITableView', 'UIScrollView',
  // Short names (from compressTree)
  'XCUIElementTypeScrollView', 'XCUIElementTypeTable', 'XCUIElementTypeCollectionView',
]);

// ResourceId patterns that indicate ANCHOR elements (even inside scroll containers)
const ANCHOR_RESOURCE_PATTERNS = [
  'toolbar', 'action_bar', 'tab_', 'nav_', 'bottom_nav', 'bottom_bar',
  'floating_action', 'app_bar', 'top_bar', 'header',
];

// ClassNames that are always ANCHOR
const ANCHOR_CLASS_NAMES = new Set([
  'TabLayout', 'TabBar', 'UISegmentedControl', 'Toolbar', 'ActionBar',
  'BottomNavigationView', 'NavigationBarView', 'UITabBar', 'UINavigationBar',
]);

// ClassNames that indicate a text label (for context extraction)
const TEXT_CLASS_NAMES = new Set([
  'TextView', 'XCUIElementTypeStaticText', 'StaticText',
  'UILabel', 'AppCompatTextView', 'MaterialTextView',
]);

function shortClassName(fullName: string): string {
  const lastDot = fullName.lastIndexOf('.');
  return lastDot >= 0 ? fullName.substring(lastDot + 1) : fullName;
}

function sha256Hex(input: string, length: number): string {
  return createHash('sha256').update(input).digest('hex').substring(0, length);
}

function isScrollContainer(node: AccessibilityNode): boolean {
  if (node.scrollable) return true;
  const name = shortClassName(node.className);
  return SCROLL_CONTAINERS.has(name);
}

function isAnchorByResourceId(resourceId?: string): boolean {
  if (!resourceId) return false;
  const lower = resourceId.toLowerCase();
  return ANCHOR_RESOURCE_PATTERNS.some(p => lower.includes(p));
}

function isAnchorByClassName(className: string): boolean {
  return ANCHOR_CLASS_NAMES.has(shortClassName(className));
}

/**
 * Build a set of node indices that are inside scroll containers (CONTENT zone).
 * Walks the original tree with children to find scroll boundaries.
 */
function findContentIndices(
  nodes: AccessibilityNode[],
  compressedNodes: CompressedNode[]
): Set<number> {
  const contentBounds: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  // Find scroll container bounds in the original tree
  function walkForScrollers(node: AccessibilityNode): void {
    if (isScrollContainer(node)) {
      contentBounds.push(node.bounds);
    }
    if (node.children) {
      for (const child of node.children) {
        walkForScrollers(child);
      }
    }
  }

  for (const root of nodes) {
    walkForScrollers(root);
  }

  // A compressed node is CONTENT if its center is inside a scroll container's bounds
  // AND it's not the scroll container itself
  const contentIndices = new Set<number>();
  for (const cn of compressedNodes) {
    if (cn.scrollable) continue; // The container itself is ANCHOR
    const cx = (cn.bounds.x1 + cn.bounds.x2) / 2;
    const cy = (cn.bounds.y1 + cn.bounds.y2) / 2;
    for (const sb of contentBounds) {
      if (cx >= sb.x1 && cx <= sb.x2 && cy >= sb.y1 && cy <= sb.y2) {
        contentIndices.add(cn.index);
        break;
      }
    }
  }

  return contentIndices;
}

/**
 * Classify compressed nodes into ANCHOR or CONTENT zones.
 */
export function classifyZones(
  compressedNodes: CompressedNode[],
  originalTree: AccessibilityNode[],
): ClassifiedNode[] {
  const contentIndices = findContentIndices(originalTree, compressedNodes);

  return compressedNodes.map(node => {
    let zone: ZoneType = contentIndices.has(node.index) ? 'CONTENT' : 'ANCHOR';

    // Override: known anchor patterns are always ANCHOR
    if (zone === 'CONTENT') {
      if (isAnchorByResourceId(node.resourceId) || isAnchorByClassName(node.className)) {
        zone = 'ANCHOR';
      }
    }

    return { node, zone };
  });
}

/**
 * Extract screen context from the original tree for the context hash.
 */
export function extractContext(
  originalTree: AccessibilityNode[],
  appInfo: DeviceStateSnapshot['appInfo'],
): ScreenContext {
  let toolbarTitle: string | undefined;
  let selectedTab: string | undefined;

  function walk(node: AccessibilityNode, insideToolbar: boolean): void {
    const name = shortClassName(node.className);

    const isToolbar = isAnchorByClassName(node.className) ||
      isAnchorByResourceId(node.resourceId);

    // Look for toolbar title
    if ((insideToolbar || isToolbar) && TEXT_CLASS_NAMES.has(name) && node.text && !toolbarTitle) {
      toolbarTitle = node.text;
    }

    // Look for selected tab
    if (node.selected && (node.text || node.contentDesc) && !selectedTab) {
      selectedTab = node.text || node.contentDesc;
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child, insideToolbar || isToolbar);
      }
    }
  }

  for (const root of originalTree) {
    walk(root, false);
  }

  return {
    toolbarTitle,
    selectedTab,
    appPackage: appInfo.packageName,
    currentApp: appInfo.currentApp,
  };
}

/**
 * Compute the skeleton fingerprint from classified nodes and context.
 */
export function computeFingerprint(
  classified: ClassifiedNode[],
  context: ScreenContext,
): ScreenFingerprint {
  // Skeleton hash: ANCHOR nodes only
  const anchorStrings: string[] = [];
  const anchorSummary: string[] = [];

  for (const { node, zone } of classified) {
    if (zone !== 'ANCHOR') continue;
    anchorStrings.push(`${node.className}|${node.resourceId || ''}`);

    const label = node.text || node.contentDesc || node.resourceId || node.className;
    anchorSummary.push(label);
  }

  // Sort for order-independence
  anchorStrings.sort();
  const skeletonHash = sha256Hex(anchorStrings.join('\n'), 12);

  // Context hash
  const contextString = `${context.appPackage}|${context.toolbarTitle || ''}|${context.selectedTab || ''}`;
  const contextHash = sha256Hex(contextString, 8);

  return {
    skeletonHash,
    contextHash,
    fingerprint: `${skeletonHash}:${contextHash}`,
    context,
    anchorSummary,
  };
}
