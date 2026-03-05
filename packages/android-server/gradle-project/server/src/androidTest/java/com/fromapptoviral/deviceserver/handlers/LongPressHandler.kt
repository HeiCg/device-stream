package com.fromapptoviral.deviceserver.handlers

import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

/**
 * POST /longPress -> long press at (x, y) via UiDevice.swipe(x,y,x,y,steps)
 *
 * Uses the same technique as ADB `input swipe x y x y duration`:
 * a swipe from a point to itself simulates a long press.
 *
 * Body: {"x": 540, "y": 960, "durationMs": 1000}
 * Returns: {"success": true}
 */
class LongPressHandler(private val uiDevice: UiDevice) {

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val json = JSONObject(body)

        val x = json.getInt("x")
        val y = json.getInt("y")
        val durationMs = json.optInt("durationMs", 1000)

        // Each step ~5ms, so steps = durationMs / 5
        val steps = Math.max(1, durationMs / 5)
        val success = uiDevice.swipe(x, y, x, y, steps)

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            JSONObject().apply {
                put("success", success)
            }.toString()
        )
    }
}
