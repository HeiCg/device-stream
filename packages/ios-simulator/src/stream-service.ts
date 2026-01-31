/**
 * iOS Simulator Stream Service
 * WebSocket-based relay for MirrorKit app and polling fallback
 */

import { WebSocket } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SimulatorMetadata {
  width: number;
  height: number;
  fps: number;
}

interface SimulatorConnection {
  device: WebSocket;
  browsers: Set<WebSocket>;
  metadata?: SimulatorMetadata;
  lastFrameTime: number;
  frameCount: number;
}

interface FrameMessage {
  type: 'frame';
  data: string;  // Base64 encoded JPEG
  pts: number;
  codec: 'mjpeg';
}

interface MetadataMessage {
  type: 'metadata';
  width: number;
  height: number;
  fps: number;
}

export class SimulatorStreamService {
  private connections = new Map<string, SimulatorConnection>();
  private pollingIntervals = new Map<string, NodeJS.Timeout>();

  /**
   * Handle connection from MirrorKit app on iOS simulator
   */
  handleDeviceConnection(ws: WebSocket, deviceId: string): void {
    console.log(`[SimStream] Device ${deviceId} connected`);

    // Clear any polling fallback that might be running
    this.stopPollingFallback(deviceId);

    // Remove existing connection if any
    const existing = this.connections.get(deviceId);
    if (existing?.device.readyState === WebSocket.OPEN) {
      existing.device.close();
    }

    this.connections.set(deviceId, {
      device: ws,
      browsers: existing?.browsers ?? new Set(),
      lastFrameTime: Date.now(),
      frameCount: 0
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleDeviceMessage(deviceId, msg);
      } catch (error) {
        console.error(`[SimStream] Error parsing device message:`, error);
      }
    });

    ws.on('close', () => {
      console.log(`[SimStream] Device ${deviceId} disconnected`);
      const conn = this.connections.get(deviceId);
      if (conn) {
        // Notify browsers about disconnect
        conn.browsers.forEach(browser => {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(JSON.stringify({
              type: 'device_disconnected',
              deviceId
            }));
          }
        });
      }
    });

    ws.on('error', (error) => {
      console.error(`[SimStream] Device ${deviceId} error:`, error);
    });

    // Send ping to keep connection alive
    this.startPingInterval(ws, deviceId);
  }

  /**
   * Handle connection from browser wanting to view simulator stream
   */
  handleBrowserConnection(ws: WebSocket, deviceId: string): void {
    let conn = this.connections.get(deviceId);

    if (!conn) {
      // Create connection placeholder if device not yet connected
      conn = {
        device: ws, // Placeholder, will be replaced when device connects
        browsers: new Set(),
        lastFrameTime: Date.now(),
        frameCount: 0
      };
      this.connections.set(deviceId, conn);
    }

    conn.browsers.add(ws);
    console.log(`[SimStream] Browser connected to ${deviceId} (${conn.browsers.size} browsers)`);

    // Send metadata if available
    if (conn.metadata) {
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: 1, // mjpeg
        codecName: 'mjpeg',
        ...conn.metadata
      }));
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleBrowserMessage(deviceId, msg, ws);
      } catch (error) {
        console.error(`[SimStream] Error parsing browser message:`, error);
      }
    });

    ws.on('close', () => {
      conn?.browsers.delete(ws);
      console.log(`[SimStream] Browser disconnected from ${deviceId} (${conn?.browsers.size ?? 0} browsers)`);

      // Cleanup if no more connections
      if (conn?.browsers.size === 0) {
        // Keep connection around for a while in case browsers reconnect
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

  private handleDeviceMessage(deviceId: string, msg: MetadataMessage | FrameMessage): void {
    const conn = this.connections.get(deviceId);
    if (!conn) return;

    switch (msg.type) {
      case 'metadata':
        conn.metadata = {
          width: msg.width,
          height: msg.height,
          fps: msg.fps
        };
        console.log(`[SimStream] Device ${deviceId} metadata: ${msg.width}x${msg.height} @ ${msg.fps}fps`);

        // Forward metadata to all browsers
        conn.browsers.forEach(browser => {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(JSON.stringify({
              type: 'metadata',
              codec: 1, // mjpeg
              codecName: 'mjpeg',
              ...conn.metadata
            }));
          }
        });
        break;

      case 'frame':
        conn.lastFrameTime = Date.now();
        conn.frameCount++;

        // Forward frame to all connected browsers
        const frameData = JSON.stringify(msg);
        conn.browsers.forEach(browser => {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(frameData);
          }
        });
        break;
    }
  }

  private handleBrowserMessage(
    deviceId: string,
    msg: { type: string; [key: string]: unknown },
    ws: WebSocket
  ): void {
    const conn = this.connections.get(deviceId);
    if (!conn) return;

    switch (msg.type) {
      case 'command':
        // Forward commands to device (future: touch input)
        if (conn.device.readyState === WebSocket.OPEN) {
          conn.device.send(JSON.stringify(msg));
        }
        break;

      case 'request_metadata':
        if (conn.metadata) {
          ws.send(JSON.stringify({
            type: 'metadata',
            codec: 1,
            codecName: 'mjpeg',
            ...conn.metadata
          }));
        }
        break;
    }
  }

  private startPingInterval(ws: WebSocket, deviceId: string): void {
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));
  }

  /**
   * Check if a device is connected and streaming
   */
  isDeviceConnected(deviceId: string): boolean {
    const conn = this.connections.get(deviceId);
    if (!conn) return false;
    return conn.device.readyState === WebSocket.OPEN;
  }

  /**
   * Get list of connected simulators
   */
  getConnectedDevices(): string[] {
    const devices: string[] = [];
    this.connections.forEach((conn, deviceId) => {
      if (conn.device.readyState === WebSocket.OPEN) {
        devices.push(deviceId);
      }
    });
    return devices;
  }

  /**
   * Get stats for a specific device
   */
  getDeviceStats(deviceId: string): {
    connected: boolean;
    browserCount: number;
    frameCount: number;
    metadata?: SimulatorMetadata;
  } | null {
    const conn = this.connections.get(deviceId);
    if (!conn) return null;

    return {
      connected: conn.device.readyState === WebSocket.OPEN,
      browserCount: conn.browsers.size,
      frameCount: conn.frameCount,
      metadata: conn.metadata
    };
  }

  /**
   * Start polling fallback for simulators that don't support ReplayKit
   */
  async startPollingFallback(deviceId: string, ws: WebSocket): Promise<void> {
    console.log(`[SimStream] Starting polling fallback for ${deviceId}`);

    // Stop any existing polling
    this.stopPollingFallback(deviceId);

    let frameCount = 0;
    const targetFps = 15; // Lower fps for polling
    const interval = 1000 / targetFps;

    // Get initial screenshot to get dimensions
    try {
      const { stdout } = await execAsync(
        `xcrun simctl io ${deviceId} screenshot --type=jpeg /dev/stdout | base64`,
        { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }
      );

      // Send initial metadata (approximate)
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: 1,
        codecName: 'mjpeg',
        width: 1170,  // iPhone 14 Pro width
        height: 2532, // iPhone 14 Pro height
        fps: targetFps
      }));
    } catch (error) {
      console.error(`[SimStream] Failed to get initial screenshot:`, error);
    }

    const pollingInterval = setInterval(async () => {
      try {
        const { stdout } = await execAsync(
          `xcrun simctl io ${deviceId} screenshot --type=jpeg /dev/stdout | base64`,
          { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );

        frameCount++;
        const frameData = {
          type: 'frame',
          data: stdout.trim(),
          pts: frameCount,
          codec: 'mjpeg'
        };

        // Send to all browsers
        const conn = this.connections.get(deviceId);
        if (conn) {
          conn.browsers.forEach(browser => {
            if (browser.readyState === WebSocket.OPEN) {
              browser.send(JSON.stringify(frameData));
            }
          });
        }
      } catch {
        // Silently ignore screenshot errors
      }
    }, interval);

    this.pollingIntervals.set(deviceId, pollingInterval);

    ws.on('close', () => {
      this.stopPollingFallback(deviceId);
    });
  }

  private stopPollingFallback(deviceId: string): void {
    const interval = this.pollingIntervals.get(deviceId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(deviceId);
      console.log(`[SimStream] Stopped polling fallback for ${deviceId}`);
    }
  }

  /**
   * Clean up all connections
   */
  cleanup(): void {
    // Stop all polling intervals
    for (const [deviceId, interval] of this.pollingIntervals) {
      clearInterval(interval);
      this.pollingIntervals.delete(deviceId);
    }

    // Close all connections
    for (const [deviceId, conn] of this.connections) {
      if (conn.device.readyState === WebSocket.OPEN) {
        conn.device.close();
      }
      conn.browsers.forEach(browser => {
        if (browser.readyState === WebSocket.OPEN) {
          browser.close();
        }
      });
      this.connections.delete(deviceId);
    }
  }
}

// Export singleton instance
export const simulatorStreamService = new SimulatorStreamService();
