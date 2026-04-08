/**
 * Element-based actions: find elements by selector, compute tap coordinates.
 */

import { CompressedNode, ElementSelector } from './types';

/**
 * Find a compressed node matching the given selector.
 * Priority: index → resourceId → text (substring) → contentDesc (substring) → className.
 * Multiple criteria = AND logic.
 */
export function findElement(
  elements: CompressedNode[],
  selector: ElementSelector,
): CompressedNode | undefined {
  return elements.find(el => {
    if (selector.index !== undefined && el.index !== selector.index) return false;
    if (selector.resourceId !== undefined && el.resourceId !== selector.resourceId) return false;
    if (selector.text !== undefined && (!el.text || !el.text.includes(selector.text))) return false;
    if (selector.contentDesc !== undefined && (!el.contentDesc || !el.contentDesc.includes(selector.contentDesc))) return false;
    if (selector.className !== undefined && el.className !== selector.className) return false;
    return true;
  });
}

/**
 * Compute the center point of a compressed node's bounds.
 */
export function computeCenter(node: CompressedNode): { x: number; y: number } {
  return {
    x: Math.round((node.bounds.x1 + node.bounds.x2) / 2),
    y: Math.round((node.bounds.y1 + node.bounds.y2) / 2),
  };
}
