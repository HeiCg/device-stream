package com.fromapptoviral.deviceserver.handlers

import android.app.UiAutomation
import androidx.test.uiautomator.UiDevice
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

/**
 * GET /info -> device metadata JSON
 *
 * Returns:
 * {
 *   "screenWidth": 1080,
 *   "screenHeight": 1920,
 *   "currentPackage": "com.android.settings",
 *   "currentActivity": ".Settings",
 *   "keyboardVisible": false,
 *   "displayRotation": 0
 * }
 *
 * Results are cached for 500ms to avoid redundant shell commands
 * when /info and /state are called in quick succession.
 */
class InfoHandler(
    private val uiDevice: UiDevice,
    private val uiAutomation: UiAutomation
) {

    @Volatile private var cachedInfo: JSONObject? = null
    @Volatile private var cacheTimestamp: Long = 0

    companion object {
        private const val CACHE_TTL_MS = 500L
    }

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val json = captureInfo()
        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            json.toString()
        )
    }

    /**
     * Capture device info as JSONObject (for StateHandler).
     * Returns cached result if less than 500ms old.
     */
    fun captureInfo(): JSONObject {
        val now = System.currentTimeMillis()
        val cached = cachedInfo
        if (cached != null && (now - cacheTimestamp) < CACHE_TTL_MS) {
            return cached
        }

        val fresh = buildFreshInfo()
        cachedInfo = fresh
        cacheTimestamp = System.currentTimeMillis()
        return fresh
    }

    private fun buildFreshInfo(): JSONObject {
        val screenWidth = uiDevice.displayWidth
        val screenHeight = uiDevice.displayHeight
        val currentPackage = uiDevice.currentPackageName ?: "unknown"
        val rotation = uiDevice.displayRotation

        // Get current activity via shell command
        val activityInfo = try {
            uiDevice.executeShellCommand(
                "dumpsys activity activities | grep mResumedActivity"
            ).trim()
        } catch (_: Exception) {
            ""
        }

        // Parse activity name from dumpsys output
        // Format: "mResumedActivity: ActivityRecord{... com.package/.Activity ...}"
        val activityName = parseActivityName(activityInfo, currentPackage)

        // Check keyboard visibility
        val keyboardVisible = try {
            val imResult = uiDevice.executeShellCommand(
                "dumpsys input_method | grep mInputShown"
            )
            imResult.contains("mInputShown=true")
        } catch (_: Exception) {
            false
        }

        return JSONObject().apply {
            put("screenWidth", screenWidth)
            put("screenHeight", screenHeight)
            put("currentPackage", currentPackage)
            put("currentActivity", activityName)
            put("keyboardVisible", keyboardVisible)
            put("displayRotation", rotation)
        }
    }

    private fun parseActivityName(dumpsysLine: String, packageName: String): String {
        // Try to extract activity from: "mResumedActivity: ActivityRecord{xxx u0 com.pkg/.Activity t123}"
        val regex = Regex("""$packageName/([^\s}]+)""")
        val match = regex.find(dumpsysLine)
        return match?.groupValues?.getOrNull(1) ?: "unknown"
    }
}
