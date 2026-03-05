package com.fromapptoviral.deviceserver.handlers

import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

/**
 * POST /tap -> click at (x, y) via UiDevice
 *
 * Body: {"x": 540, "y": 960}
 * Returns: {"success": true}
 */
class TapHandler(private val uiDevice: UiDevice) {

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val json = JSONObject(body)

        val x = json.getInt("x")
        val y = json.getInt("y")

        val success = uiDevice.click(x, y)

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            JSONObject().apply {
                put("success", success)
            }.toString()
        )
    }
}
