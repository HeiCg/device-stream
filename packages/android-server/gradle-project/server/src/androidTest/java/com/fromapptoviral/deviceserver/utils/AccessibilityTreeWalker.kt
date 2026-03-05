package com.fromapptoviral.deviceserver.utils

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Walks the accessibility tree and produces IndexedElement[] JSON.
 *
 * Output matches exactly the IndexedElement type from types.ts:66-79:
 * {
 *   "index": 1,
 *   "className": "Button",
 *   "resourceId": "btn_save",
 *   "text": "Save",
 *   "contentDesc": "",
 *   "bounds": {"x1":840,"y1":88,"x2":1032,"y2":256},
 *   "clickable": true,
 *   "scrollable": false,
 *   "focused": false,
 *   "enabled": true,
 *   "checked": false,
 *   "selected": false
 * }
 */
class AccessibilityTreeWalker(
    private val screenWidth: Int,
    private val screenHeight: Int,
    private val maxElements: Int = 50,
    private val minElementSize: Int = 10
) {

    data class FlatNode(
        val className: String,
        val resourceId: String,
        val text: String,
        val contentDesc: String,
        val bounds: Rect,
        val clickable: Boolean,
        val scrollable: Boolean,
        val focused: Boolean,
        val enabled: Boolean,
        val checked: Boolean,
        val selected: Boolean,
        val editable: Boolean
    )

    /**
     * Walk the tree starting from root and return IndexedElement[] JSON.
     */
    fun walk(root: AccessibilityNodeInfo?): JSONArray {
        if (root == null) return JSONArray()

        val nodes = mutableListOf<FlatNode>()
        collectNodes(root, nodes)

        // Filter: interactive elements only (clickable, scrollable, focused, editable)
        val interactive = nodes.filter {
            it.clickable || it.scrollable || it.focused || it.editable
        }

        // Filter: minimum size
        val sized = interactive.filter {
            val w = it.bounds.width()
            val h = it.bounds.height()
            w >= minElementSize && h >= minElementSize
        }

        // Filter: on screen
        val onScreen = sized.filter { isOnScreen(it.bounds) }

        // Sort: top-to-bottom, left-to-right
        val sorted = onScreen.sortedWith(compareBy<FlatNode> { node ->
            // Group into rows (20px threshold)
            node.bounds.top / 20
        }.thenBy { node ->
            node.bounds.left
        })

        // Limit to maxElements
        val limited = sorted.take(maxElements)

        // Build JSON with 1-based indexing
        val result = JSONArray()
        for ((i, node) in limited.withIndex()) {
            val obj = JSONObject()
            obj.put("index", i + 1)
            obj.put("className", node.className)
            obj.put("resourceId", node.resourceId)
            obj.put("text", node.text)
            obj.put("contentDesc", node.contentDesc)

            val bounds = JSONObject()
            bounds.put("x1", node.bounds.left)
            bounds.put("y1", node.bounds.top)
            bounds.put("x2", node.bounds.right)
            bounds.put("y2", node.bounds.bottom)
            obj.put("bounds", bounds)

            obj.put("clickable", node.clickable)
            obj.put("scrollable", node.scrollable)
            obj.put("focused", node.focused)
            obj.put("enabled", node.enabled)
            obj.put("checked", node.checked)
            obj.put("selected", node.selected)

            result.put(obj)
        }

        return result
    }

    /**
     * Recursively collect all nodes from the accessibility tree.
     */
    private fun collectNodes(node: AccessibilityNodeInfo, out: MutableList<FlatNode>) {
        val rect = Rect()
        node.getBoundsInScreen(rect)

        val className = shortClassName(node.className?.toString() ?: "")
        val resourceId = shortResourceId(node.viewIdResourceName)
        val text = node.text?.toString() ?: ""
        val contentDesc = node.contentDescription?.toString() ?: ""

        out.add(
            FlatNode(
                className = className,
                resourceId = resourceId,
                text = text,
                contentDesc = contentDesc,
                bounds = rect,
                clickable = node.isClickable,
                scrollable = node.isScrollable,
                focused = node.isFocused,
                enabled = node.isEnabled,
                checked = node.isChecked,
                selected = node.isSelected,
                editable = node.isEditable
            )
        )

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectNodes(child, out)
            child.recycle()
        }
    }

    /**
     * Short class name: "android.widget.Button" → "Button"
     */
    private fun shortClassName(fullName: String): String {
        val idx = fullName.lastIndexOf('.')
        return if (idx >= 0) fullName.substring(idx + 1) else fullName
    }

    /**
     * Short resource ID: "com.app:id/btn_save" → "btn_save"
     */
    private fun shortResourceId(fullId: String?): String {
        if (fullId == null) return ""
        val idx = fullId.lastIndexOf('/')
        return if (idx >= 0) fullId.substring(idx + 1) else fullId
    }

    /**
     * Check if bounds are within screen area.
     */
    private fun isOnScreen(bounds: Rect): Boolean {
        return bounds.right > 0 &&
                bounds.bottom > 0 &&
                bounds.left < screenWidth &&
                bounds.top < screenHeight
    }
}
