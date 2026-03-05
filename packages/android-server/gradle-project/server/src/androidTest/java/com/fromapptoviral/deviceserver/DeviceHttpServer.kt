package com.fromapptoviral.deviceserver

import android.app.Instrumentation
import android.app.UiAutomation
import android.util.Log
import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.handlers.*
import fi.iki.elonen.NanoHTTPD

/**
 * Lightweight HTTP server running on the Android device.
 *
 * Routes:
 *   GET  /ping          → health check
 *   GET  /screenshot    → JPEG screenshot via UiAutomation
 *   GET  /hierarchy     → UI tree as IndexedElement[] JSON
 *   POST /tap           → click at (x, y) via UiDevice
 *   POST /swipe         → swipe via UiDevice
 *   POST /type          → text input via Instrumentation
 *   POST /key           → key press via UiDevice
 *   POST /waitForIdle   → native idle detection
 *   GET  /info          → device metadata
 *   POST /longPress     → long press at (x, y)
 *   POST /state         → combined: screenshot + hierarchy + info
 */
class DeviceHttpServer(
    port: Int,
    private val uiDevice: UiDevice,
    private val uiAutomation: UiAutomation,
    private val instrumentation: Instrumentation
) : NanoHTTPD(port) {

    companion object {
        private const val TAG = "DeviceHttpServer"
    }

    // Handlers
    private val screenshotHandler = ScreenshotHandler(uiAutomation)
    private val hierarchyHandler = HierarchyHandler(uiAutomation)
    private val tapHandler = TapHandler(uiDevice)
    private val swipeHandler = SwipeHandler(uiDevice)
    private val typeHandler = TypeHandler(instrumentation)
    private val keyHandler = KeyHandler(uiDevice)
    private val waitForIdleHandler = WaitForIdleHandler(uiDevice)
    private val infoHandler = InfoHandler(uiDevice, uiAutomation)
    private val longPressHandler = LongPressHandler(uiDevice)
    private val stateHandler = StateHandler(screenshotHandler, hierarchyHandler, infoHandler, uiDevice)

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        val method = session.method

        Log.d(TAG, "$method $uri")

        return try {
            when {
                uri == "/ping" && method == Method.GET ->
                    jsonResponse("""{"status":"ok"}""")

                uri == "/screenshot" && method == Method.GET ->
                    screenshotHandler.handle(session)

                uri == "/hierarchy" && method == Method.GET ->
                    hierarchyHandler.handle(session)

                uri == "/tap" && method == Method.POST ->
                    tapHandler.handle(session)

                uri == "/swipe" && method == Method.POST ->
                    swipeHandler.handle(session)

                uri == "/type" && method == Method.POST ->
                    typeHandler.handle(session)

                uri == "/key" && method == Method.POST ->
                    keyHandler.handle(session)

                uri == "/longPress" && method == Method.POST ->
                    longPressHandler.handle(session)

                uri == "/waitForIdle" && method == Method.POST ->
                    waitForIdleHandler.handle(session)

                uri == "/info" && method == Method.GET ->
                    infoHandler.handle(session)

                uri == "/state" && method == Method.POST ->
                    stateHandler.handle(session)

                else ->
                    newFixedLengthResponse(
                        Response.Status.NOT_FOUND,
                        MIME_PLAINTEXT,
                        "Not found: $method $uri"
                    )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling $method $uri", e)
            jsonResponse(
                """{"error":"${e.message?.replace("\"", "\\\"") ?: "unknown"}"}""",
                Response.Status.INTERNAL_ERROR
            )
        }
    }

    private fun jsonResponse(
        json: String,
        status: Response.Status = Response.Status.OK
    ): Response {
        return newFixedLengthResponse(status, "application/json", json)
    }
}
