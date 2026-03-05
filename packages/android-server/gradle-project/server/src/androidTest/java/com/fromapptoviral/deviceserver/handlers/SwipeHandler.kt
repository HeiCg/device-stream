package com.fromapptoviral.deviceserver.handlers

import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

/**
 * POST /swipe -> swipe via UiDevice
 *
 * Body: {"startX": 540, "startY": 1200, "endX": 540, "endY": 600, "durationMs": 300}
 * Returns: {"success": true}
 */
class SwipeHandler(private val uiDevice: UiDevice) {

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val json = JSONObject(body)

        val startX = json.getInt("startX")
        val startY = json.getInt("startY")
        val endX = json.getInt("endX")
        val endY = json.getInt("endY")
        val steps = json.optInt("steps", 10)

        // UiDevice.swipe uses steps (each step ~5ms)
        val success = uiDevice.swipe(startX, startY, endX, endY, steps)

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            JSONObject().apply {
                put("success", success)
            }.toString()
        )
    }
}
