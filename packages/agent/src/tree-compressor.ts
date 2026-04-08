/**
 * TypeScript port of native TreeCompressor + NodeSerializer.
 * Removes empty container nodes and flattens tree to numbered CompressedNode[].
 *
 * Reference: native-servers/android-device-server/.../TreeCompressor.kt
 * Reference: native-servers/android-device-server/.../NodeSerializer.kt
 */

import { AccessibilityNode } from '@device-stream/core';
import { CompressedNode } from './types';

// Containers that add no semantic value when empty
const CONTAINER_TYPES = new Set([
  // Android
  'FrameLayout', 'LinearLayout', 'RelativeLayout', 'ConstraintLayout',
  'ViewGroup', 'CoordinatorLayout', 'AppBarLayout',
  'CollapsingToolbarLayout', 'NestedScrollView', 'CardView', 'MaterialCardView',
  // iOS
  'UIView', 'UIStackView',
]);

// Pure layout containers whose empty subtrees can be skipped entirely
const SKIPPABLE_CONTAINERS = new Set([
  'FrameLayout', 'LinearLayout', 'RelativeLayout', 'ConstraintLayout',
  'ViewGroup', 'UIView', 'UIStackView',
]);

function shortClassName(fullName: string): string {
  const lastDot = fullName.lastIndexOf('.');
  return lastDot >= 0 ? fullName.substring(lastDot + 1) : fullName;
}

function stripResourceId(resourceId: string): string {
  const slashIdx = resourceId.indexOf('/');
  return slashIdx >= 0 ? resourceId.substring(slashIdx + 1) : resourceId;
}

function isInteractive(node: AccessibilityNode): boolean {
  return node.clickable || node.scrollable || node.focused ||
    node.checked === true || node.selected === true;
}

function hasContent(node: AccessibilityNode): boolean {
  return !!(node.text || node.contentDesc || node.resourceId);
}

function shouldKeep(node: AccessibilityNode): boolean {
  if (isInteractive(node)) return true;

  const name = shortClassName(node.className);
  if (CONTAINER_TYPES.has(name)) {
    return hasContent(node);
  }

  return true;
}

function shouldSkipSubtree(node: AccessibilityNode): boolean {
  const name = shortClassName(node.className);
  if (!SKIPPABLE_CONTAINERS.has(name)) return false;
  return !hasContent(node);
}

function toCompressedNode(node: AccessibilityNode, index: number): CompressedNode {
  return {
    index,
    className: shortClassName(node.className),
    resourceId: node.resourceId ? stripResourceId(node.resourceId) : undefined,
    text: node.text || undefined,
    contentDesc: node.contentDesc || undefined,
    bounds: { ...node.bounds },
    clickable: node.clickable,
    scrollable: node.scrollable,
    focused: node.focused,
    enabled: node.enabled,
    checked: node.checked,
    selected: node.selected,
  };
}

/**
 * Compress an accessibility tree by removing empty containers,
 * flatten to a 1-indexed CompressedNode array.
 */
export function compressTree(
  nodes: AccessibilityNode[],
  maxElements: number = 50
): CompressedNode[] {
  const result: CompressedNode[] = [];
  let nextIndex = 1;

  function traverse(node: AccessibilityNode): void {
    if (result.length >= maxElements) return;

    const keep = shouldKeep(node);

    if (keep) {
      result.push(toCompressedNode(node, nextIndex++));
    }

    if (!keep && shouldSkipSubtree(node)) {
      return;
    }

    if (node.children) {
      for (const child of node.children) {
        if (result.length >= maxElements) break;
        traverse(child);
      }
    }
  }

  for (const root of nodes) {
    if (result.length >= maxElements) break;
    traverse(root);
  }

  return result;
}
