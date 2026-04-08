import { WebSocket } from 'ws';
import { AndroidDeviceService, ScrcpyService } from '@device-stream/android';
import type { StreamDevice, StreamInfo } from './types';

interface AndroidSession {
  serial: string;
  browsers: Set<WebSocket>;
  metadata?: { codec: number; width: number; height: number };
  deviceWidth: number;
  deviceHeight: number;
  /** Cached H.264 configuration (SPS/PPS) — needed to initialize a decoder */
  lastConfig?: string;
  /** Cached last keyframe — lets late-joining browsers see the current screen */
  lastKeyframe?: string;
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

    // Get device dimensions for fallback
    const devices = await this.deviceService.listDevices();
    const deviceInfo = devices.find(d => d.serial === serial);
    const fallbackWidth = deviceInfo?.screenWidth ?? 1080;
    const fallbackHeight = deviceInfo?.screenHeight ?? 1920;

    // Connect to device via ADB
    await this.deviceService.connect(serial);
    const adb = await this.deviceService.getDevice(serial);

    // Ensure session entry exists for WS clients that connected early
    if (!this.sessions.has(serial)) {
      this.sessions.set(serial, { serial, browsers: new Set(), deviceWidth: fallbackWidth, deviceHeight: fallbackHeight });
    }
    const session = this.sessions.get(serial)!;

    // Start scrcpy with callback-based frame delivery
    await this.scrcpyService.startStreamWithCallback(
      adb,
      serial,
      (metadata) => {
        // Use device dimensions as fallback when scrcpy returns 0
        const width = metadata.width || session.deviceWidth;
        const height = metadata.height || session.deviceHeight;
        session.metadata = { ...metadata, width, height };

        // Send metadata to all already-connected browsers
        const metaMsg = JSON.stringify({
          type: 'metadata',
          codec: metadata.codec,
          codecName: 'h264',
          width,
          height,
          fps: 60,
        });
        session.browsers.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(metaMsg);
          }
        });
      },
      (packet) => {
        // Cache configuration and keyframes for late-joining browsers
        const frameMsg = JSON.stringify(packet);
        if (packet.type === 'configuration') {
          session.lastConfig = frameMsg;
        } else if (packet.type === 'data' && packet.keyframe) {
          session.lastKeyframe = frameMsg;
        }

        // Broadcast frame to all connected browsers
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
      this.sessions.set(serial, { serial, browsers: new Set(), deviceWidth: 1080, deviceHeight: 1920 });
    }
    const session = this.sessions.get(serial)!;
    session.browsers.add(ws);

    console.log(`[AndroidStreamer] Browser connected to ${serial} (${session.browsers.size} browsers)`);

    // Replay cached stream state so late-joining browsers can decode immediately:
    // 1. metadata (codec, dimensions)
    // 2. configuration (SPS/PPS — required to initialize the H.264 decoder)
    // 3. last keyframe (current screen content)
    if (session.metadata) {
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: session.metadata.codec,
        codecName: 'h264',
        width: session.metadata.width,
        height: session.metadata.height,
        fps: 60,
      }));
      if (session.lastConfig) {
        ws.send(session.lastConfig);
      }
      if (session.lastKeyframe) {
        ws.send(session.lastKeyframe);
      }
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
