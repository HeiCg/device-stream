/**
 * Serialize CompressedNode[] to a token-efficient text format for LLM consumption.
 *
 * Format: [index] ClassName "text" flags (x1,y1)-(x2,y2)
 * Example: [1] Button "Login" clickable (100,400)-(300,460)
 */

import { CompressedNode } from './types';

/**
 * Convert compressed nodes to a compact text representation.
 * Skips phantom nodes (no text, no contentDesc, no resourceId, not interactive).
 */
export function serializeToCompactText(nodes: CompressedNode[]): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const hasLabel = node.text || node.contentDesc || node.resourceId;
    const interactive = node.clickable || node.scrollable || node.focused ||
      node.checked === true || node.selected === true;

    // Skip phantom nodes that provide no value to the LLM
    if (!hasLabel && !interactive) continue;

    const parts: string[] = [`[${node.index}]`, node.className];

    // Label: prefer text, fall back to contentDesc, then resourceId
    const label = node.text || node.contentDesc || node.resourceId;
    if (label) {
      parts.push(`"${label}"`);
    }

    // Flags
    const flags: string[] = [];
    if (node.clickable) flags.push('clickable');
    if (node.scrollable) flags.push('scrollable');
    if (node.focused) flags.push('focused');
    if (node.checked) flags.push('checked');
    if (node.selected) flags.push('selected');
    if (!node.enabled) flags.push('disabled');
    if (flags.length > 0) {
      parts.push(flags.join(' '));
    }

    // Bounds
    parts.push(`(${node.bounds.x1},${node.bounds.y1})-(${node.bounds.x2},${node.bounds.y2})`);

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}
