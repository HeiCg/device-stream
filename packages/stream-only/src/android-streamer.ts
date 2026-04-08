import { WebSocket } from 'ws';
import { AndroidDeviceService, ScrcpyService } from '@device-stream/android';
import type { StreamDevice, StreamInfo } from './types';

interface AndroidSession {
  serial: string;
  browsers: Set<WebSocket>;
  metadata?: { codec: number; width: number; height: number };
}

export class AndroidStreamer {
  private deviceService: AndroidDeviceService;
  private scrcpyService: ScrcpyService;
  private sessions = new Map<string, AndroidSession>();

  constructor() {
    this.deviceService = new AndroidDeviceService();
    this.scrcpyService = new ScrcpyService();
  }

  async listDevices(): Promise<StreamDevice[]> {
    try {
      const devices = await this.deviceService.listDevices();
      return devices.map(d => ({
        serial: d.serial,
        platform: 'android' as const,
        name: d.model,
        screenWidth: d.screenWidth,
        screenHeight: d.screenHeight,
      }));
    } catch (error) {
      console.error('[AndroidStreamer] Failed to list devices:', error);
      return [];
    }
  }

  async startStream(serial: string): Promise<StreamInfo> {
    const existing = this.sessions.get(serial);
    if (existing?.metadata) {
      return {
        serial,
        platform: 'android',
        codec: 'h264',
        width: existing.metadata.width,
        height: existing.metadata.height,
      };
    }

    // Connect to device via ADB
    await this.deviceService.connect(serial);
    const adb = await this.deviceService.getDevice(serial);

    // Ensure session entry exists for WS clients that connected early
    if (!this.sessions.has(serial)) {
      this.sessions.set(serial, { serial, browsers: new Set() });
    }
    const session = this.sessions.get(serial)!;

    // Start scrcpy with callback-based frame delivery
    await this.scrcpyService.startStreamWithCallback(
      adb,
      serial,
      (metadata) => {
        session.metadata = metadata;

        // Send metadata to all already-connected browsers
        const metaMsg = JSON.stringify({
          type: 'metadata',
          codec: metadata.codec,
          codecName: 'h264',
          width: metadata.width,
          height: metadata.height,
          fps: 60,
        });
        session.browsers.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(metaMsg);
          }
        });
      },
      (packet) => {
        // Broadcast frame to all connected browsers
        const frameMsg = JSON.stringify(packet);
        session.browsers.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(frameMsg);
          }
        });
      },
    );

    // Wait for metadata to arrive from scrcpy
    await new Promise<void>((resolve, reject) => {
      if (session.metadata) return resolve();
      const timer = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for scrcpy metadata for ${serial}`));
      }, 5000);
      const interval = setInterval(() => {
        if (session.metadata) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve();
        }
      }, 50);
    });

    return {
      serial,
      platform: 'android',
      codec: 'h264',
      width: session.metadata?.width ?? 1080,
      height: session.metadata?.height ?? 1920,
    };
  }

  async stopStream(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (session) {
      // Close all browser connections
      session.browsers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'device_disconnected', deviceId: serial }));
          ws.close();
        }
      });
      this.sessions.delete(serial);
    }

    await this.scrcpyService.stopCallbackStream(serial);
    await this.deviceService.disconnect(serial);
  }

  handleWebSocket(ws: WebSocket, serial: string): void {
    if (!this.sessions.has(serial)) {
      this.sessions.set(serial, { serial, browsers: new Set() });
    }
    const session = this.sessions.get(serial)!;
    session.browsers.add(ws);

    console.log(`[AndroidStreamer] Browser connected to ${serial} (${session.browsers.size} browsers)`);

    // If metadata already available, send it immediately
    if (session.metadata) {
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: session.metadata.codec,
        codecName: 'h264',
        width: session.metadata.width,
        height: session.metadata.height,
        fps: 60,
      }));
    }

    ws.on('close', () => {
      session.browsers.delete(ws);
      console.log(`[AndroidStreamer] Browser disconnected from ${serial} (${session.browsers.size} browsers)`);
    });

    ws.on('error', (error) => {
      console.error('[AndroidStreamer] Browser error for %s:', serial, error);
    });
  }

  isStreaming(serial: string): boolean {
    return this.scrcpyService.isCallbackStreaming(serial);
  }

  async cleanup(): Promise<void> {
    const serials = Array.from(this.sessions.keys());
    await Promise.all(serials.map(serial => this.stopStream(serial)));
  }
}
