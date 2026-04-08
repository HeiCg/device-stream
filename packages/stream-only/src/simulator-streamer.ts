import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocket } from 'ws';
import { CaptureService } from '@device-stream/ios-simulator';
import { SimulatorStreamService } from '@device-stream/ios-simulator';
import type { StreamDevice, StreamInfo } from './types';

const execFileAsync = promisify(execFile);

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  deviceTypeIdentifier?: string;
}

interface SimctlRuntime {
  devices: Record<string, SimctlDevice[]>;
}

export class SimulatorStreamer {
  private captureService: CaptureService;
  private streamService: SimulatorStreamService;
  private activeDevices = new Set<string>();

  constructor() {
    this.captureService = new CaptureService();
    this.streamService = new SimulatorStreamService();

    // Wire capture frames into the stream service
    this.captureService.setFrameCallback((deviceId, base64Jpeg, width, height) => {
      this.streamService.injectFrame(deviceId, base64Jpeg, width, height);
    });
  }

  async listDevices(): Promise<StreamDevice[]> {
    try {
      const { stdout } = await execFileAsync('xcrun', [
        'simctl', 'list', 'devices', 'available', '-j',
      ]);
      const parsed: SimctlRuntime = JSON.parse(stdout);
      const devices: StreamDevice[] = [];

      for (const [runtime, deviceList] of Object.entries(parsed.devices)) {
        for (const device of deviceList) {
          if (device.state !== 'Booted') continue;

          // Extract iOS version from runtime identifier
          // e.g. "com.apple.CoreSimulator.SimRuntime.iOS-17-4" → "iOS 17.4"
          const versionMatch = runtime.match(/iOS[- ](\d+)[- ](\d+)/);
          const version = versionMatch ? `iOS ${versionMatch[1]}.${versionMatch[2]}` : '';
          const displayName = version ? `${device.name} (${version})` : device.name;

          devices.push({
            serial: device.udid,
            platform: 'ios-simulator',
            name: displayName,
            screenWidth: 1170,  // Default; actual size comes from capture header
            screenHeight: 2532,
          });
        }
      }

      return devices;
    } catch (error) {
      console.error('[SimulatorStreamer] Failed to list simulators:', error);
      return [];
    }
  }

  async startStream(serial: string): Promise<StreamInfo> {
    if (this.activeDevices.has(serial)) {
      const stats = this.streamService.getDeviceStats(serial);
      return {
        serial,
        platform: 'ios-simulator',
        codec: 'mjpeg',
        width: stats?.metadata?.width ?? 1170,
        height: stats?.metadata?.height ?? 2532,
      };
    }

    const started = await this.captureService.startCapture(serial, {
      fps: 30,
      quality: 80,
      scale: 1,
    });

    if (!started) {
      throw new Error(`Failed to start capture for simulator ${serial}. Is sim-capture binary built?`);
    }

    this.activeDevices.add(serial);

    const captureStats = this.captureService.getStats(serial);
    const width = captureStats?.header?.virtualWidth ?? 1170;
    const height = captureStats?.header?.virtualHeight ?? 2532;

    return {
      serial,
      platform: 'ios-simulator',
      codec: 'mjpeg',
      width,
      height,
    };
  }

  async stopStream(serial: string): Promise<void> {
    this.activeDevices.delete(serial);
    await this.captureService.stopCapture(serial);
  }

  handleWebSocket(ws: WebSocket, serial: string): void {
    this.streamService.handleBrowserConnection(ws, serial);
  }

  isStreaming(serial: string): boolean {
    return this.activeDevices.has(serial);
  }

  async cleanup(): Promise<void> {
    await this.captureService.cleanup();
    this.streamService.cleanup();
    this.activeDevices.clear();
  }
}
