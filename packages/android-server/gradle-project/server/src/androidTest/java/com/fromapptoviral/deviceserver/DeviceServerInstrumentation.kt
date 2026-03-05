package com.fromapptoviral.deviceserver

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch

/**
 * Entry point for the on-device HTTP server.
 *
 * Run with:
 *   adb shell am instrument -w \
 *     -e class com.fromapptoviral.deviceserver.DeviceServerInstrumentation \
 *     -e port 9008 \
 *     com.fromapptoviral.deviceserver.test/androidx.test.runner.AndroidJUnitRunner
 *
 * The port defaults to 9008 if not specified via -e port.
 *
 * This @Test method starts the server and blocks forever,
 * keeping the instrumentation process alive.
 */
@RunWith(AndroidJUnit4::class)
class DeviceServerInstrumentation {

    companion object {
        private const val TAG = "DeviceServer"
        const val DEFAULT_PORT = 9008
    }

    @Test
    fun startServer() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val uiDevice = UiDevice.getInstance(instrumentation)
        val uiAutomation = instrumentation.uiAutomation

        // Read port from instrumentation arguments, default to 9008
        val port = InstrumentationRegistry.getArguments()
            .getString("port")?.toIntOrNull() ?: DEFAULT_PORT

        Log.i(TAG, "Starting DeviceHttpServer on port $port ...")

        val server = DeviceHttpServer(port, uiDevice, uiAutomation, instrumentation)
        server.start()

        Log.i(TAG, "DeviceHttpServer running on port $port")

        // Block forever - the server runs in daemon threads
        val latch = CountDownLatch(1)
        Runtime.getRuntime().addShutdownHook(Thread {
            Log.i(TAG, "Shutting down DeviceHttpServer ...")
            server.stop()
            latch.countDown()
        })

        try {
            latch.await()
        } catch (_: InterruptedException) {
            Log.i(TAG, "Server interrupted, shutting down ...")
            server.stop()
        }
    }
}
