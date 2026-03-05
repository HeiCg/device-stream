package com.fromapptoviral.deviceserver.handlers

import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

/**
 * POST /waitForIdle -> native UI idle detection via UiDevice.waitForIdle()
 *
 * This is the KEY reliability fix. UiDevice.waitForIdle(timeout) does NOT throw
 * an error when it times out - it simply returns. This is fundamentally different
 * from `uiautomator dump` which FAILS with "could not get idle state".
 *
 * Body: {"timeoutMs": 1000}  (optional, default: 2000)
 * Returns: {"idle": true, "waitedMs": 123}
 */
class WaitForIdleHandler(private val uiDevice: UiDevice) {

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val json = if (body.isNotBlank()) JSONObject(body) else JSONObject()

        val timeoutMs = json.optLong("timeoutMs", 2000)

        val startTime = System.currentTimeMillis()
        uiDevice.waitForIdle(timeoutMs)
        val waitedMs = System.currentTimeMillis() - startTime

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            JSONObject().apply {
                put("idle", true)
                put("waitedMs", waitedMs)
            }.toString()
        )
    }

    /**
     * Wait for idle and return how long we waited (for StateHandler).
     */
    fun waitForIdle(timeoutMs: Long = 2000): Long {
        val startTime = System.currentTimeMillis()
        uiDevice.waitForIdle(timeoutMs)
        return System.currentTimeMillis() - startTime
    }
}
