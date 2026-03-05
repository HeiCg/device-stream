package com.fromapptoviral.deviceserver.handlers

import android.app.UiAutomation
import android.graphics.Bitmap
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.Response
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * GET /screenshot → JPEG screenshot via UiAutomation.takeScreenshot()
 *
 * Query params:
 *   quality  - JPEG quality 0-100 (default: 80)
 *   scale    - downscale factor 1/2/4 (default: 1)
 *
 * Returns: image/jpeg bytes
 */
class ScreenshotHandler(private val uiAutomation: UiAutomation) {

    fun handle(session: NanoHTTPD.IHTTPSession): Response {
        val quality = session.parms["quality"]?.toIntOrNull()?.coerceIn(1, 100) ?: 80
        val scale = session.parms["scale"]?.toIntOrNull()?.coerceIn(1, 4) ?: 1

        val bitmap = uiAutomation.takeScreenshot()
            ?: return NanoHTTPD.newFixedLengthResponse(
                Response.Status.INTERNAL_ERROR,
                "application/json",
                """{"error":"takeScreenshot returned null"}"""
            )

        val outputBitmap = if (scale > 1) {
            val w = bitmap.width / scale
            val h = bitmap.height / scale
            Bitmap.createScaledBitmap(bitmap, w, h, true).also {
                bitmap.recycle()
            }
        } else {
            bitmap
        }

        val baos = ByteArrayOutputStream()
        outputBitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos)
        outputBitmap.recycle()

        val bytes = baos.toByteArray()
        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "image/jpeg",
            ByteArrayInputStream(bytes),
            bytes.size.toLong()
        )
    }

    /**
     * Take screenshot and return raw JPEG bytes (for StateHandler).
     */
    fun captureJpegBytes(quality: Int = 80, scale: Int = 1): ByteArray? {
        val bitmap = uiAutomation.takeScreenshot() ?: return null

        val outputBitmap = if (scale > 1) {
            val w = bitmap.width / scale
            val h = bitmap.height / scale
            Bitmap.createScaledBitmap(bitmap, w, h, true).also {
                bitmap.recycle()
            }
        } else {
            bitmap
        }

        val baos = ByteArrayOutputStream()
        outputBitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos)
        outputBitmap.recycle()

        return baos.toByteArray()
    }
}
