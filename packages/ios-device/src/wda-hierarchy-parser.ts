/**
 * Parser for WDA /source XML → AccessibilityNode[]
 *
 * WDA returns XML with XCUIElementType* tag names:
 * <AppiumAUT>
 *   <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Settings"
 *     label="Settings" enabled="true" visible="true" accessible="false"
 *     x="0" y="0" width="390" height="844">
 *     <XCUIElementTypeWindow ...>
 *       <XCUIElementTypeOther ...>
 *         <XCUIElementTypeStaticText value="General" label="General" .../>
 *       </XCUIElementTypeOther>
 *     </XCUIElementTypeWindow>
 *   </XCUIElementTypeApplication>
 * </AppiumAUT>
 */

import { AccessibilityNode } from '@device-stream/core';

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

function attrInt(nodeStr: string, name: string, fallback: number = 0): number {
  const val = attr(nodeStr, name);
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * Parse WDA /source XML into AccessibilityNode[].
 */
export function parseWdaSourceXml(xml: string): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  let globalIndex = 0;

  function parseNode(xmlFragment: string): AccessibilityNode | null {
    // Match opening tag (XCUIElementType* or other)
    const openMatch = xmlFragment.match(/^<(\w+)\s([^>]*?)(\/)?>|^<(\w+)\s([^>]*)>/s);
    if (!openMatch) return null;

    const tagName = openMatch[1] || openMatch[4] || '';
    const attrs = openMatch[2] || openMatch[5] || '';
    const isSelfClosing = openMatch[3] === '/';

    const x = attrInt(attrs, 'x');
    const y = attrInt(attrs, 'y');
    const w = attrInt(attrs, 'width');
    const h = attrInt(attrs, 'height');

    // Use the type attribute if present, otherwise use the tag name
    const className = attr(attrs, 'type') || tagName;

    const node: AccessibilityNode = {
      index: globalIndex++,
      className,
      resourceId: attr(attrs, 'name') || undefined,
      text: attr(attrs, 'value') || attr(attrs, 'label') || undefined,
      contentDesc: attr(attrs, 'label') || undefined,
      bounds: { x1: x, y1: y, x2: x + w, y2: y + h },
      clickable: attrBool(attrs, 'accessible'),
      scrollable: className.includes('ScrollView'),
      focused: attrBool(attrs, 'focused'),
      enabled: attrBool(attrs, 'enabled'),
      selected: attrBool(attrs, 'selected') || undefined,
    };

    if (!isSelfClosing) {
      const children = extractChildNodes(xmlFragment, tagName);
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
    }

    return node;
  }

  function extractChildNodes(xml: string, parentTag: string): string[] {
    const children: string[] = [];
    const firstClose = xml.indexOf('>');
    if (firstClose === -1) return children;

    const inner = xml.substring(firstClose + 1);
    let depth = 0;
    let start = -1;
    let i = 0;

    while (i < inner.length) {
      if (inner[i] === '<' && inner[i + 1] !== '/') {
        // Opening tag
        const tagEnd = inner.indexOf('>', i);
        if (tagEnd === -1) break;

        const tagContent = inner.substring(i, tagEnd + 1);
        const isSelf = tagContent.endsWith('/>');

        if (depth === 0) {
          start = i;
        }

        if (isSelf) {
          if (depth === 0) {
            children.push(tagContent);
            start = -1;
          }
        } else {
          depth++;
        }

        i = tagEnd + 1;
      } else if (inner.startsWith('</', i)) {
        const closeEnd = inner.indexOf('>', i);
        if (closeEnd === -1) break;

        depth--;
        if (depth === 0 && start !== -1) {
          children.push(inner.substring(start, closeEnd + 1));
          start = -1;
        }

        // Break if we hit the parent closing tag
        const closingTag = inner.substring(i + 2, closeEnd);
        if (depth < 0 || closingTag === parentTag) break;

        i = closeEnd + 1;
      } else {
        i++;
      }
    }

    return children;
  }

  // Strip outer wrapper tags (AppiumAUT, etc.)
  // Find the first XCUIElementType* tag
  const xcuiMatch = xml.match(/<(XCUIElementType\w+)\s/);
  if (xcuiMatch) {
    const startIdx = xml.indexOf(xcuiMatch[0]);
    const tag = xcuiMatch[1];
    const endTag = `</${tag}>`;
    const endIdx = xml.lastIndexOf(endTag);
    if (endIdx !== -1) {
      const fragment = xml.substring(startIdx, endIdx + endTag.length);
      const node = parseNode(fragment);
      if (node) {
        // Return the app node's children as the tree, or wrap if no children
        if (node.children && node.children.length > 0) {
          return node.children;
        }
        return [node];
      }
    }
  }

  // Fallback: try to parse the whole thing
  const wrapped = `<root>${xml}</root>`;
  const topChildren = extractChildNodes(wrapped, 'root');
  for (const childXml of topChildren) {
    const node = parseNode(childXml);
    if (node) nodes.push(node);
  }

  return nodes;
}
