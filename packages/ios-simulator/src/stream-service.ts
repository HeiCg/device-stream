/**
 * iOS Simulator Stream Service
 * Receives frames from CaptureService (ScreenCaptureKit) and relays to browser WebSockets.
 */

import { WebSocket } from 'ws';

interface SimulatorMetadata {
  width: number;
  height: number;
  fps: number;
}

interface SimulatorConnection {
  browsers: Set<WebSocket>;
  metadata?: SimulatorMetadata;
  lastFrameTime: number;
  frameCount: number;
}

export class SimulatorStreamService {
  private connections = new Map<string, SimulatorConnection>();

  /**
   * Handle connection from browser wanting to view simulator stream
   */
  handleBrowserConnection(ws: WebSocket, deviceId: string): void {
    let conn = this.connections.get(deviceId);

    if (!conn) {
      conn = {
        browsers: new Set(),
        lastFrameTime: Date.now(),
        frameCount: 0,
      };
      this.connections.set(deviceId, conn);
    }

    conn.browsers.add(ws);
    console.log(`[SimStream] Browser connected to ${deviceId} (${conn.browsers.size} browsers)`);

    // Send metadata if available (capture already running)
    if (conn.metadata) {
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: 1, // mjpeg
        codecName: 'mjpeg',
        ...conn.metadata,
      }));
    }

    ws.on('close', () => {
      conn?.browsers.delete(ws);
      console.log(`[SimStream] Browser disconnected from ${deviceId} (${conn?.browsers.size ?? 0} browsers)`);

      // Cleanup if no more browsers after a grace period
      if (conn?.browsers.size === 0) {
        setTimeout(() => {
          const currentConn = this.connections.get(deviceId);
          if (currentConn?.browsers.size === 0) {
            this.connections.delete(deviceId);
          }
        }, 30000);
      }
    });

    ws.on('error', (error) => {
      console.error(`[SimStream] Browser error for ${deviceId}:`, error);
    });
  }

  /**
   * Inject a frame from CaptureService (ScreenCaptureKit).
   * Creates/updates the connection entry and broadcasts to all connected browsers.
   */
  injectFrame(deviceId: string, base64Jpeg: string, width: number, height: number): void {
    let conn = this.connections.get(deviceId);

    if (!conn) {
      conn = {
        browsers: new Set(),
        lastFrameTime: Date.now(),
        frameCount: 0,
      };
      this.connections.set(deviceId, conn);
    }

    // Update or set metadata on first frame or if dimensions change
    if (!conn.metadata || conn.metadata.width !== width || conn.metadata.height !== height) {
      conn.metadata = { width, height, fps: 30 };
      const metaMsg = JSON.stringify({
        type: 'metadata',
        codec: 1,
        codecName: 'mjpeg',
        width,
        height,
        fps: 30,
      });
      conn.browsers.forEach(browser => {
        if (browser.readyState === WebSocket.OPEN) {
          browser.send(metaMsg);
        }
      });
    }

    conn.lastFrameTime = Date.now();
    conn.frameCount++;

    if (conn.frameCount === 1) {
      console.log(`[SimStream] Device ${deviceId} first injected frame - ScreenCaptureKit working`);
    }

    // Broadcast frame to all browsers
    const frameData = JSON.stringify({
      type: 'frame',
      data: base64Jpeg,
      pts: conn.frameCount,
      codec: 'mjpeg',
    });

    conn.browsers.forEach(browser => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(frameData);
      }
    });
  }

  /**
   * Check if a device has an active capture (frames being injected)
   */
  isStreaming(deviceId: string): boolean {
    const conn = this.connections.get(deviceId);
    if (!conn) return false;
    // Consider streaming if we received a frame in the last 5 seconds
    return (Date.now() - conn.lastFrameTime) < 5000;
  }

  /**
   * Get stats for a specific device
   */
  getDeviceStats(deviceId: string): {
    browserCount: number;
    frameCount: number;
    metadata?: SimulatorMetadata;
  } | null {
    const conn = this.connections.get(deviceId);
    if (!conn) return null;

    return {
      browserCount: conn.browsers.size,
      frameCount: conn.frameCount,
      metadata: conn.metadata,
    };
  }

  /**
   * Clean up all connections
   */
  cleanup(): void {
    for (const [, conn] of this.connections) {
      conn.browsers.forEach(browser => {
        if (browser.readyState === WebSocket.OPEN) {
          browser.close();
        }
      });
    }
    this.connections.clear();
  }
}

// Export singleton instance
export const simulatorStreamService = new SimulatorStreamService();
