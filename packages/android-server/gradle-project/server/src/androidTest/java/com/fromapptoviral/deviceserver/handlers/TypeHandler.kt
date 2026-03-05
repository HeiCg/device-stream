package com.fromapptoviral.deviceserver.handlers

import android.app.Instrumentation
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.KeyCharacterMap
import android.view.KeyEvent
import com.fromapptoviral.deviceserver.utils.HttpUtils
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * POST /type -> text input via Instrumentation.sendKeySync()
 *
 * For short text (<=5 chars): sends each character one at a time via key events.
 * For longer text: uses clipboard paste (KEYCODE_PASTE) for speed.
 *
 * Body: {"text": "Hello World"}
 * Returns: {"success": true, "charsTyped": 11, "method": "clipboard"|"keys"}
 */
class TypeHandler(private val instrumentation: Instrumentation) {

    private val kcm = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD)

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val body = HttpUtils.readBody(session)
        val json = JSONObject(body)

        val text = json.getString("text")

        // Fast path: clipboard paste for text longer than 5 chars
        if (text.length > 5) {
            val clipboardResult = tryClipboardPaste(text)
            if (clipboardResult != null) {
                return NanoHTTPD.newFixedLengthResponse(
                    Response.Status.OK,
                    "application/json",
                    clipboardResult.toString()
                )
            }
            // Clipboard failed, fall through to char-by-char
        }

        // Slow path: character by character
        val charsTyped = typeCharByChar(text)

        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            JSONObject().apply {
                put("success", true)
                put("charsTyped", charsTyped)
                put("method", "keys")
            }.toString()
        )
    }

    /**
     * Try to paste text via clipboard. Returns result JSON on success, null on failure.
     */
    private fun tryClipboardPaste(text: String): JSONObject? {
        return try {
            val context = instrumentation.targetContext
            val clipboardManager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                ?: return null

            // ClipboardManager.setPrimaryClip must be called from main thread
            val latch = CountDownLatch(1)
            var clipSet = false

            Handler(Looper.getMainLooper()).post {
                try {
                    val clip = ClipData.newPlainText("text", text)
                    clipboardManager.setPrimaryClip(clip)
                    clipSet = true
                } catch (_: Exception) {
                    // Clipboard may fail on some Android versions
                }
                latch.countDown()
            }

            if (!latch.await(200, TimeUnit.MILLISECONDS)) return null
            if (!clipSet) return null

            // Give clipboard time to propagate
            Thread.sleep(50)

            // Send KEYCODE_PASTE (279)
            instrumentation.uiAutomation.executeShellCommand("input keyevent 279").close()

            JSONObject().apply {
                put("success", true)
                put("charsTyped", text.length)
                put("method", "clipboard")
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Type text character by character via key events.
     */
    private fun typeCharByChar(text: String): Int {
        var charsTyped = 0

        for (char in text) {
            val events = kcm.getEvents(charArrayOf(char))
            if (events != null) {
                for (event in events) {
                    instrumentation.sendKeySync(event)
                }
                charsTyped++
            } else {
                // Fallback: use shell input for characters that can't be mapped
                instrumentation.uiAutomation.executeShellCommand(
                    "input text \"${char}\""
                ).close()
                charsTyped++
            }
        }

        return charsTyped
    }
}
