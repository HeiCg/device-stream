package com.fromapptoviral.deviceserver.handlers

import android.view.KeyEvent
import androidx.test.uiautomator.UiDevice
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

/**
 * POST /key -> key press via UiDevice.pressKeyCode()
 *
 * Body: {"keyCode": 4}        <- Android key code
 *   or: {"key": "back"}       <- Named key
 *
 * Named keys: home, back, enter, menu, tab, delete, recent_apps
 *
 * Returns: {"success": true}
 */
class KeyHandler(private val uiDevice: UiDevice) {

    companion object {
        private val NAMED_KEYS = mapOf(
            "home" to KeyEvent.KEYCODE_HOME,
            "back" to KeyEvent.KEYCODE_BACK,
            "enter" to KeyEvent.KEYCODE_ENTER,
            "menu" to KeyEvent.KEYCODE_MENU,
            "tab" to KeyEvent.KEYCODE_TAB,
            "delete" to KeyEvent.KEYCODE_DEL,
            "recent_apps" to KeyEvent.KEYCODE_APP_SWITCH
        )
    }

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val json = JSONObject(body)

        val keyCode: Int = when {
            json.has("keyCode") -> json.getInt("keyCode")
            json.has("key") -> {
                val keyName = json.getString("key").lowercase()
                NAMED_KEYS[keyName]
                    ?: return NanoHTTPD.newFixedLengthResponse(
                        Response.Status.BAD_REQUEST,
                        "application/json",
                        """{"error":"Unknown key name: $keyName","validKeys":${NAMED_KEYS.keys}}"""
                    )
            }
            else -> return NanoHTTPD.newFixedLengthResponse(
                Response.Status.BAD_REQUEST,
                "application/json",
                """{"error":"Must provide 'keyCode' or 'key'"}"""
            )
        }

        val success = uiDevice.pressKeyCode(keyCode)

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            JSONObject().apply {
                put("success", success)
            }.toString()
        )
    }
}
