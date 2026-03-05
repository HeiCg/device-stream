package com.fromapptoviral.deviceserver.utils

import fi.iki.elonen.NanoHTTPD

/**
 * Shared HTTP utilities for request handling.
 */
object HttpUtils {
    /**
     * Read the full request body from an IHTTPSession.
     *
     * InputStream.read() may return fewer bytes than requested (partial read).
     * This loops until all bytes are consumed or EOF is reached.
     *
     * Note: readNBytes() requires Java 9+ but minSdk 26 = Java 8, so we loop manually.
     */
    fun readBody(session: NanoHTTPD.IHTTPSession): String {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        if (contentLength == 0) return ""
        val buf = ByteArray(contentLength)
        var offset = 0
        while (offset < contentLength) {
            val n = session.inputStream.read(buf, offset, contentLength - offset)
            if (n == -1) break
            offset += n
        }
        return String(buf, 0, offset)
    }
}
