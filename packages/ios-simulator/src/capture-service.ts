/**
 * ScreenCaptureKit Capture Service
 * Manages sim-capture CLI processes and parses binary frame protocol.
 */

import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

interface CaptureOptions {
  fps?: number;
  quality?: number; // 0-100
  scale?: 1 | 2 | 4;
}

interface CaptureHeader {
  version: number;
  pid: number;
  realWidth: number;
  realHeight: number;
  virtualWidth: number;
  virtualHeight: number;
  orientation: number;
}

interface CaptureInstance {
  process: ChildProcess;
  deviceId: string;
  header?: CaptureHeader;
  frameCount: number;
}

const HEADER_SIZE = 24;

// Default path to the sim-capture binary (relative to this package's dist/)
const DEFAULT_BINARY_PATH = path.resolve(__dirname, '../../../tools/sim-capture/.build/release/sim-capture');

export class CaptureService extends EventEmitter {
  private captures = new Map<string, CaptureInstance>();
  private binaryPath: string;
  private onFrame: ((deviceId: string, base64Jpeg: string, width: number, height: number) => void) | null = null;

  constructor(binaryPath?: string) {
    super();
    this.binaryPath = binaryPath ?? DEFAULT_BINARY_PATH;
  }

  /**
   * Set the callback for injecting frames into the stream service.
   */
  setFrameCallback(cb: (deviceId: string, base64Jpeg: string, width: number, height: number) => void): void {
    this.onFrame = cb;
  }

  /**
   * Check if the sim-capture binary exists.
   */
  isBinaryAvailable(): boolean {
    return fs.existsSync(this.binaryPath);
  }

  /**
   * Start capturing a simulator's screen via ScreenCaptureKit.
   * Returns true if started successfully, false if binary not available or spawn fails.
   */
  async startCapture(deviceId: string, options: CaptureOptions = {}): Promise<boolean> {
    if (this.captures.has(deviceId)) {
      console.log(`[SimCapture] Already capturing ${deviceId}`);
      return true;
    }

    if (!this.isBinaryAvailable()) {
      console.log(`[SimCapture] Binary not found at ${this.binaryPath}`);
      return false;
    }

    const args = [
      '--udid', deviceId,
      '--fps', String(options.fps ?? 30),
      '--quality', String(options.quality ?? 80),
      '--scale', String(options.scale ?? 1),
    ];

    console.log(`[SimCapture] Starting for ${deviceId}: ${this.binaryPath} ${args.join(' ')}`);

    return new Promise((resolve) => {
      try {
        const proc = spawn(this.binaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const instance: CaptureInstance = {
          process: proc,
          deviceId,
          frameCount: 0,
        };

        this.captures.set(deviceId, instance);

        // Parse binary protocol from stdout
        let buffer = Buffer.alloc(0);
        let headerParsed = false;
        let firstFrameResolved = false;

        proc.stdout!.on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);

          // Parse header first
          if (!headerParsed) {
            if (buffer.length >= HEADER_SIZE) {
              const header = this.parseHeader(buffer.subarray(0, HEADER_SIZE));
              instance.header = header;
              buffer = buffer.subarray(HEADER_SIZE);
              headerParsed = true;
              console.log(`[SimCapture] Header for ${deviceId}: ${header.realWidth}x${header.realHeight} (virtual: ${header.virtualWidth}x${header.virtualHeight})`);
            } else {
              return; // Wait for more data
            }
          }

          // Parse frames
          while (buffer.length >= 4) {
            const frameSize = buffer.readUInt32LE(0);

            if (frameSize === 0 || frameSize > 10 * 1024 * 1024) {
              // Invalid frame size - protocol error
              console.error(`[SimCapture] Invalid frame size: ${frameSize} for ${deviceId}`);
              this.stopCapture(deviceId);
              return;
            }

            if (buffer.length < 4 + frameSize) {
              break; // Wait for more data
            }

            const jpegData = buffer.subarray(4, 4 + frameSize);
            buffer = buffer.subarray(4 + frameSize);

            instance.frameCount++;

            // Convert to base64 and inject
            const base64 = jpegData.toString('base64');
            const header = instance.header!;

            if (this.onFrame) {
              this.onFrame(deviceId, base64, header.virtualWidth, header.virtualHeight);
            }

            this.emit('frame', deviceId, instance.frameCount);

            // Resolve start promise on first frame
            if (!firstFrameResolved) {
              firstFrameResolved = true;
              resolve(true);
            }
          }
        });

        // Log stderr from sim-capture
        proc.stderr!.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().trim().split('\n');
          for (const line of lines) {
            if (line) console.log(`[SimCapture:${deviceId}] ${line}`);
          }
        });

        proc.on('error', (err) => {
          console.error(`[SimCapture] Process error for ${deviceId}:`, err);
          this.captures.delete(deviceId);
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(false);
          }
        });

        proc.on('exit', (code, signal) => {
          console.log(`[SimCapture] Process exited for ${deviceId} (code=${code}, signal=${signal})`);
          this.captures.delete(deviceId);
          this.emit('exit', deviceId, code);
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(false);
          }
        });

        // Timeout: if no first frame within 5s, consider it failed
        setTimeout(() => {
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            console.log(`[SimCapture] Timeout waiting for first frame from ${deviceId}`);
            this.stopCapture(deviceId);
            resolve(false);
          }
        }, 5000);
      } catch (err) {
        console.error(`[SimCapture] Failed to spawn for ${deviceId}:`, err);
        this.captures.delete(deviceId);
        resolve(false);
      }
    });
  }

  /**
   * Stop capturing for a device.
   */
  stopCapture(deviceId: string): void {
    const instance = this.captures.get(deviceId);
    if (!instance) return;

    console.log(`[SimCapture] Stopping for ${deviceId} (${instance.frameCount} frames sent)`);
    try {
      instance.process.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }
    this.captures.delete(deviceId);
  }

  /**
   * Check if a device is being captured.
   */
  isCapturing(deviceId: string): boolean {
    return this.captures.has(deviceId);
  }

  /**
   * Get capture stats for a device.
   */
  getStats(deviceId: string): { frameCount: number; header?: CaptureHeader } | null {
    const instance = this.captures.get(deviceId);
    if (!instance) return null;
    return {
      frameCount: instance.frameCount,
      header: instance.header,
    };
  }

  /**
   * Stop all captures.
   */
  cleanup(): void {
    for (const [deviceId] of this.captures) {
      this.stopCapture(deviceId);
    }
  }

  private parseHeader(data: Buffer): CaptureHeader {
    return {
      version: data.readUInt8(0),
      // skip header_size at offset 1
      pid: data.readUInt32LE(2),
      realWidth: data.readUInt32LE(6),
      realHeight: data.readUInt32LE(10),
      virtualWidth: data.readUInt32LE(14),
      virtualHeight: data.readUInt32LE(18),
      orientation: data.readUInt8(22),
    };
  }
}

/**
 * Create a CaptureService instance.
 */
export function createCaptureService(binaryPath?: string): CaptureService {
  return new CaptureService(binaryPath);
}
