package com.fromapptoviral.deviceserver.handlers

import android.util.Base64
import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * POST /state -> combined state capture: waitForIdle + screenshot + hierarchy + info
 *
 * This is the single-call endpoint that replaces the parallel ADB calls
 * in StateManager.capture(). The sequence is:
 *   1. waitForIdle (configurable timeout) - native idle detection (never fails!)
 *   2. In parallel:
 *      a. hierarchy via AccessibilityNodeInfo (never fails!) [current thread]
 *      b. screenshot via UiAutomation.takeScreenshot() [thread pool]
 *      c. device info (package, activity, keyboard) [thread pool]
 *
 * Body (optional): {"quality": 80, "scale": 1, "maxElements": 50, "waitTimeoutMs": 1000}
 *
 * Returns:
 * {
 *   "screenshot": "<base64 JPEG>",
 *   "hierarchy": [IndexedElement, ...],
 *   "info": {screenWidth, screenHeight, currentPackage, currentActivity, keyboardVisible, displayRotation},
 *   "waitedMs": 123,
 *   "captureMs": 456
 * }
 */
class StateHandler(
    private val screenshotHandler: ScreenshotHandler,
    private val hierarchyHandler: HierarchyHandler,
    private val infoHandler: InfoHandler,
    private val uiDevice: UiDevice
) {

    private val executor = Executors.newFixedThreadPool(2)

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val params = if (body.isNotBlank()) JSONObject(body) else JSONObject()

        val quality = params.optInt("quality", 80)
        val scale = params.optInt("scale", 1)
        val maxElements = params.optInt("maxElements", 50)
        val waitTimeoutMs = params.optLong("waitTimeoutMs", 1000)

        val captureStart = System.currentTimeMillis()

        // 1. Wait for idle (never throws)
        val idleStart = System.currentTimeMillis()
        uiDevice.waitForIdle(waitTimeoutMs)
        val waitedMs = System.currentTimeMillis() - idleStart

        // 2. Parallel capture: screenshot + info in thread pool, hierarchy on current thread
        val screenshotFuture: Future<ByteArray?> = executor.submit<ByteArray?> {
            screenshotHandler.captureJpegBytes(quality, scale)
        }
        val infoFuture: Future<JSONObject> = executor.submit<JSONObject> {
            infoHandler.captureInfo()
        }

        // Hierarchy runs on the current thread
        val hierarchy: JSONArray = hierarchyHandler.captureHierarchy(maxElements)

        // Collect parallel results
        val screenshotBytes = screenshotFuture.get(5, TimeUnit.SECONDS)
        val info = infoFuture.get(5, TimeUnit.SECONDS)

        val screenshotBase64 = if (screenshotBytes != null) {
            Base64.encodeToString(screenshotBytes, Base64.NO_WRAP)
        } else {
            ""
        }

        val captureMs = System.currentTimeMillis() - captureStart

        val result = JSONObject().apply {
            put("screenshot", screenshotBase64)
            put("hierarchy", hierarchy)
            put("info", info)
            put("waitedMs", waitedMs)
            put("captureMs", captureMs)
        }

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            result.toString()
        )
    }
}
