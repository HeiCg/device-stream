/**
 * Parser for Android uiautomator dump XML → AccessibilityNode[]
 *
 * uiautomator dump produces XML like:
 * <hierarchy rotation="0">
 *   <node index="0" text="" resource-id="" class="android.widget.FrameLayout"
 *     package="com.example" content-desc="" checkable="false" checked="false"
 *     clickable="false" enabled="true" focusable="false" focused="false"
 *     scrollable="false" long-clickable="false" password="false" selected="false"
 *     bounds="[0,0][1080,1920]">
 *     <node ...>...</node>
 *   </node>
 * </hierarchy>
 */

import { AccessibilityNode } from '@device-stream/core';

/**
 * Parse a bounds string like "[0,0][1080,1920]" into {x1,y1,x2,y2}
 */
function parseBounds(bounds: string): { x1: number; y1: number; x2: number; y2: number } {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }
  return {
    x1: parseInt(match[1], 10),
    y1: parseInt(match[2], 10),
    x2: parseInt(match[3], 10),
    y2: parseInt(match[4], 10),
  };
}

/**
 * Extract an attribute value from an XML node string.
 * Uses string search to avoid dynamic RegExp construction.
 */
function attr(nodeStr: string, name: string): string {
  const needle = `${name}="`;
  const start = nodeStr.indexOf(needle);
  if (start === -1) return '';
  const valueStart = start + needle.length;
  const valueEnd = nodeStr.indexOf('"', valueStart);
  if (valueEnd === -1) return '';
  return nodeStr.substring(valueStart, valueEnd);
}

function attrBool(nodeStr: string, name: string): boolean {
  return attr(nodeStr, name) === 'true';
}

/**
 * Parse uiautomator dump XML into a flat AccessibilityNode array.
 * Preserves hierarchy via the children field.
 */
export function parseUiAutomatorXml(xml: string): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  let globalIndex = 0;

  function parseNode(xmlFragment: string): AccessibilityNode | null {
    // Match the opening tag with attributes
    const openMatch = xmlFragment.match(/^<node\s([^>]*)>/s);
    if (!openMatch) return null;

    const attrs = openMatch[1];
    const bounds = parseBounds(attr(attrs, 'bounds'));

    const node: AccessibilityNode = {
      index: globalIndex++,
      className: attr(attrs, 'class'),
      resourceId: attr(attrs, 'resource-id') || undefined,
      text: attr(attrs, 'text') || undefined,
      contentDesc: attr(attrs, 'content-desc') || undefined,
      bounds,
      clickable: attrBool(attrs, 'clickable'),
      scrollable: attrBool(attrs, 'scrollable'),
      focused: attrBool(attrs, 'focused'),
      enabled: attrBool(attrs, 'enabled'),
      checked: attrBool(attrs, 'checkable') ? attrBool(attrs, 'checked') : undefined,
      selected: attrBool(attrs, 'selected') || undefined,
    };

    // Find children by extracting inner content between opening and closing tags
    const children = extractChildNodes(xmlFragment);
    if (children.length > 0) {
      node.children = [];
      for (const childXml of children) {
        const childNode = parseNode(childXml);
        if (childNode) {
          node.children.push(childNode);
        }
      }
      if (node.children.length === 0) {
        delete node.children;
      }
    }

    return node;
  }

  /**
   * Extract direct child <node>...</node> elements from an XML fragment.
   * Handles nested nodes by tracking depth.
   */
  function extractChildNodes(xml: string): string[] {
    const children: string[] = [];
    // Skip past the opening tag of the parent
    const firstClose = xml.indexOf('>');
    if (firstClose === -1) return children;

    const inner = xml.substring(firstClose + 1);
    let depth = 0;
    let start = -1;

    // Scan for <node and </node> or /> patterns
    let i = 0;
    while (i < inner.length) {
      if (inner.startsWith('<node ', i) || inner.startsWith('<node>', i)) {
        if (depth === 0) {
          start = i;
        }
        depth++;
        i += 5;
      } else if (inner.startsWith('</node>', i)) {
        depth--;
        if (depth === 0 && start !== -1) {
          children.push(inner.substring(start, i + 7));
          start = -1;
        }
        i += 7;
      } else if (inner.startsWith('/>', i) && depth > 0) {
        // Self-closing node
        // Check if we're inside a node tag
        const before = inner.substring(start !== -1 ? start : 0, i);
        const lastOpen = before.lastIndexOf('<node ');
        if (lastOpen !== -1) {
          depth--;
          if (depth === 0 && start !== -1) {
            children.push(inner.substring(start, i + 2));
            start = -1;
          }
        }
        i += 2;
      } else {
        i++;
      }
    }

    return children;
  }

  // Find the top-level <hierarchy> element and extract its child nodes
  const hierarchyMatch = xml.match(/<hierarchy[^>]*>([\s\S]*)<\/hierarchy>/);
  if (!hierarchyMatch) {
    // Try to find individual <node> elements at the top
    const topNodes = extractChildNodes(`<root>${xml}</root>`);
    for (const nodeXml of topNodes) {
      const node = parseNode(nodeXml);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  const hierarchyContent = `<root>${hierarchyMatch[1]}</root>`;
  const topNodes = extractChildNodes(hierarchyContent);
  for (const nodeXml of topNodes) {
    const node = parseNode(nodeXml);
    if (node) nodes.push(node);
  }

  return nodes;
}
