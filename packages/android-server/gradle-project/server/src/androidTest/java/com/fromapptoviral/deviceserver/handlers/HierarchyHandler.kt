package com.fromapptoviral.deviceserver.handlers

import android.app.UiAutomation
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.view.Display
import com.fromapptoviral.deviceserver.utils.AccessibilityTreeWalker
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONArray

/**
 * GET /hierarchy → UI tree as IndexedElement[] JSON
 *
 * Uses AccessibilityNodeInfo directly (NOT uiautomator dump CLI).
 * This is the key reliability fix: AccessibilityNodeInfo does not fail
 * with "could not get idle state" like the CLI tool does.
 *
 * Query params:
 *   maxElements - max elements to return (default: 50)
 */
class HierarchyHandler(private val uiAutomation: UiAutomation) {

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val maxElements = session.parms["maxElements"]?.toIntOrNull()?.coerceIn(1, 200) ?: 50
        val json = captureHierarchy(maxElements)
        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            json.toString()
        )
    }

    /**
     * Capture hierarchy as JSONArray (for StateHandler).
     */
    fun captureHierarchy(maxElements: Int = 50): JSONArray {
        val root = uiAutomation.rootInActiveWindow

        // Get screen dimensions from the root node bounds
        val screenWidth: Int
        val screenHeight: Int
        if (root != null) {
            val rect = android.graphics.Rect()
            root.getBoundsInScreen(rect)
            screenWidth = if (rect.right > 0) rect.right else 1080
            screenHeight = if (rect.bottom > 0) rect.bottom else 1920
        } else {
            screenWidth = 1080
            screenHeight = 1920
        }

        val walker = AccessibilityTreeWalker(
            screenWidth = screenWidth,
            screenHeight = screenHeight,
            maxElements = maxElements
        )

        val result = walker.walk(root)
        root?.recycle()
        return result
    }
}
