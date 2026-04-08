# `@device-stream/stream-only` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone `@device-stream/stream-only` package that streams Android and iOS Simulator screens to browsers via WebSocket, with no control APIs.

**Architecture:** A thin orchestration layer (`StreamServer`) creates an HTTP+WS server, delegates device discovery and streaming to platform-specific streamer modules (`AndroidStreamer`, `SimulatorStreamer`). Each streamer wraps existing package functionality (ScrcpyService, CaptureService) with multi-client broadcast support.

**Tech Stack:** TypeScript, Node.js `http`, `ws` WebSocket library, `@device-stream/core` protocol, `@device-stream/android` (ScrcpyService), `@device-stream/ios-simulator` (CaptureService + SimulatorStreamService)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/stream-only/package.json` | Package metadata, dependencies |
| Create | `packages/stream-only/tsconfig.json` | TypeScript config extending root |
| Create | `packages/stream-only/src/index.ts` | Public exports: `createStreamServer`, types |
| Create | `packages/stream-only/src/types.ts` | `StreamDevice`, `StreamInfo`, `StreamServerOptions` types |
| Create | `packages/stream-only/src/simulator-streamer.ts` | iOS Simulator discovery + CaptureService + broadcast |
| Modify | `packages/android/src/scrcpy-service.ts` | Add `startStreamWithCallback()` for callback-based frame delivery |
| Create | `packages/stream-only/src/android-streamer.ts` | Android discovery + ScrcpyService + broadcast wrapper |
| Create | `packages/stream-only/src/stream-server.ts` | HTTP server, WS upgrade routing, lifecycle management |
| Modify | `packages/android/src/index.ts` | Re-export new ScrcpyService method (no change needed — class already exported) |
| Modify | `package.json` (root) | Add `build:stream-only` script, update `build` script |

---

### Task 1: Package Scaffolding

**Files:**
- Create: `packages/stream-only/package.json`
- Create: `packages/stream-only/tsconfig.json`
- Create: `packages/stream-only/src/types.ts`
- Create: `packages/stream-only/src/index.ts`

- [ ] **Step 1: Create `packages/stream-only/package.json`**

```json
{
  "name": "@device-stream/stream-only",
  "version": "1.1.0",
  "description": "Stream device screens to browsers via WebSocket — no control APIs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/HeiCg/device-stream.git",
    "directory": "packages/stream-only"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "device-stream",
    "stream",
    "screen-mirroring",
    "websocket",
    "scrcpy",
    "ios-simulator"
  ],
  "license": "MIT",
  "dependencies": {
    "@device-stream/core": "^1.1.0",
    "@device-stream/android": "^1.1.0",
    "@device-stream/ios-simulator": "^1.1.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/stream-only/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `packages/stream-only/src/types.ts`**

```typescript
export interface StreamServerOptions {
  port?: number;
  host?: string;
}

export interface StreamDevice {
  serial: string;
  platform: 'android' | 'ios-simulator';
  name: string;
  screenWidth: number;
  screenHeight: number;
}

export interface StreamInfo {
  serial: string;
  platform: 'android' | 'ios-simulator';
  codec: 'h264' | 'mjpeg';
  width: number;
  height: number;
}
```

- [ ] **Step 4: Create a placeholder `packages/stream-only/src/index.ts`**

```typescript
export { StreamServerOptions, StreamDevice, StreamInfo } from './types';

// StreamServer and createStreamServer will be added in Task 6
```

- [ ] **Step 5: Install dependencies and verify build**

Run: `cd /Users/heicg/conductor/workspaces/device-stream/kyiv && npm install && npm run build -w @device-stream/stream-only`
Expected: Successful compilation with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/stream-only/
git commit -m "feat(stream-only): scaffold package with types"
```

---

### Task 2: iOS Simulator Streamer

**Files:**
- Create: `packages/stream-only/src/simulator-streamer.ts`

This module handles iOS Simulator discovery via `xcrun simctl` and streaming via `CaptureService` + `SimulatorStreamService`. The iOS Simulator packages already support multi-browser broadcast natively.

- [ ] **Step 1: Create `packages/stream-only/src/simulator-streamer.ts`**

```typescript
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build -w @device-stream/stream-only`
Expected: Successful compilation.

- [ ] **Step 3: Commit**

```bash
git add packages/stream-only/src/simulator-streamer.ts
git commit -m "feat(stream-only): add iOS Simulator streamer"
```

---

### Task 3: Add Callback-Based Streaming to ScrcpyService

**Files:**
- Modify: `packages/android/src/scrcpy-service.ts`

The current `ScrcpyService.startStream(adb, serial, ws)` pipes frames directly to a single WebSocket. We need a `startStreamWithCallback()` method that delivers frames to a callback instead, enabling the broadcast wrapper in `android-streamer.ts`.

- [ ] **Step 1: Add `FrameCallback` type and `startStreamWithCallback` method**

In `packages/android/src/scrcpy-service.ts`, add the following after the `ScrcpySession` interface (line 21):

```typescript
interface ScrcpyCallbackSession {
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  videoStream: ReadableStream<ScrcpyMediaStreamPacket>;
  serial: string;
  reader?: ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
  stopping?: boolean;
}

export type FrameCallback = (packet: {
  type: string;
  data: string;
  keyframe?: boolean;
  pts?: string;
}) => void;
```

- [ ] **Step 2: Add the `startStreamWithCallback` method to `ScrcpyService` class**

Add this method after the existing `startStream` method (after line 101):

```typescript
  private callbackSessions: Map<string, ScrcpyCallbackSession> = new Map();

  async startStreamWithCallback(
    adb: Adb,
    serial: string,
    onMetadata: (metadata: { codec: number; width: number; height: number }) => void,
    onFrame: FrameCallback,
  ): Promise<void> {
    // Stop any existing callback session for this device
    await this.stopCallbackStream(serial);

    console.log(`Starting scrcpy callback stream for device ${serial}`);

    try {
      await scrcpySetup.ensureServerReady(adb, true);

      const options = new AdbScrcpyOptionsLatest({
        video: true,
        audio: false,
        control: true,
        tunnelForward: true,
        sendDeviceMeta: true,
        sendCodecMeta: true,
        sendFrameMeta: true,
      }, {
        version: VERSION,
      });

      const client = await AdbScrcpyClient.start(
        adb,
        scrcpySetup.getDeviceServerPath(),
        options
      );

      const videoStreamPromise = await client.videoStream;
      if (!videoStreamPromise) {
        throw new Error('Video stream not available');
      }

      const videoStream = videoStreamPromise.stream;
      const metadata = videoStreamPromise.metadata;

      const session: ScrcpyCallbackSession = {
        client,
        videoStream,
        serial,
      };

      this.callbackSessions.set(serial, session);

      onMetadata({
        codec: metadata.codec,
        width: videoStreamPromise.width,
        height: videoStreamPromise.height,
      });

      this.pipeCallbackStream(session, onFrame).catch(err =>
        console.error(`pipeCallbackStream error for ${serial}:`, err)
      );

    } catch (error) {
      console.error(`Failed to start scrcpy callback stream for ${serial}:`, error);
      throw error;
    }
  }

  private async pipeCallbackStream(
    session: ScrcpyCallbackSession,
    onFrame: FrameCallback,
  ): Promise<void> {
    const { videoStream, serial } = session;

    try {
      const reader = videoStream.getReader();
      session.reader = reader;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`Callback video stream ended for ${serial}`);
          break;
        }

        const packet = {
          type: value.type,
          data: Buffer.from(value.data).toString('base64'),
          ...(value.type === 'data' && {
            keyframe: value.keyframe,
            pts: value.pts?.toString(),
          }),
        };

        onFrame(packet);
      }
    } catch (error) {
      console.error(`Error reading callback video stream for ${serial}:`, error);
    } finally {
      await this.stopCallbackStream(serial);
    }
  }

  async stopCallbackStream(serial: string): Promise<void> {
    const session = this.callbackSessions.get(serial);
    if (!session || session.stopping) return;

    session.stopping = true;
    this.callbackSessions.delete(serial);

    console.log(`Stopping scrcpy callback stream for ${serial}`);

    try {
      if (session.reader) {
        await session.reader.cancel();
      }
      await session.client.close();
    } catch (error) {
      console.error(`Error stopping callback stream for ${serial}:`, error);
    }
  }

  isCallbackStreaming(serial: string): boolean {
    return this.callbackSessions.has(serial);
  }
```

- [ ] **Step 3: Update `stopAll` to also stop callback sessions**

In `packages/android/src/scrcpy-service.ts`, replace the existing `stopAll` method (lines 174-177):

Old:
```typescript
  async stopAll(): Promise<void> {
    const serials = Array.from(this.sessions.keys());
    await Promise.all(serials.map(serial => this.stopStream(serial)));
  }
```

New:
```typescript
  async stopAll(): Promise<void> {
    const wsSerials = Array.from(this.sessions.keys());
    const cbSerials = Array.from(this.callbackSessions.keys());
    await Promise.all([
      ...wsSerials.map(serial => this.stopStream(serial)),
      ...cbSerials.map(serial => this.stopCallbackStream(serial)),
    ]);
  }
```

- [ ] **Step 4: Verify android package still builds**

Run: `npm run build -w @device-stream/android`
Expected: Successful compilation with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/android/src/scrcpy-service.ts
git commit -m "feat(android): add callback-based streaming to ScrcpyService"
```

---

### Task 4: Android Streamer

**Files:**
- Create: `packages/stream-only/src/android-streamer.ts`

This module wraps `AndroidDeviceService` for discovery and `ScrcpyService.startStreamWithCallback()` for streaming, adding multi-client WebSocket broadcast.

- [ ] **Step 1: Create `packages/stream-only/src/android-streamer.ts`**

```typescript
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
          width: metadata.width,
          height: metadata.height,
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

    // Wait briefly for metadata to arrive from scrcpy
    await new Promise<void>(resolve => {
      const check = () => {
        if (session.metadata) return resolve();
        setTimeout(check, 50);
      };
      check();
      // Timeout after 5 seconds
      setTimeout(resolve, 5000);
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
        width: session.metadata.width,
        height: session.metadata.height,
      }));
    }

    ws.on('close', () => {
      session.browsers.delete(ws);
      console.log(`[AndroidStreamer] Browser disconnected from ${serial} (${session.browsers.size} browsers)`);
    });

    ws.on('error', (error) => {
      console.error(`[AndroidStreamer] Browser error for ${serial}:`, error);
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build -w @device-stream/stream-only`
Expected: Successful compilation.

- [ ] **Step 3: Commit**

```bash
git add packages/stream-only/src/android-streamer.ts
git commit -m "feat(stream-only): add Android streamer with multi-client broadcast"
```

---

### Task 5: StreamServer

**Files:**
- Create: `packages/stream-only/src/stream-server.ts`
- Modify: `packages/stream-only/src/index.ts`

This is the main entry point — HTTP server + WS upgrade routing + device lifecycle.

- [ ] **Step 1: Create `packages/stream-only/src/stream-server.ts`**

```typescript
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AndroidStreamer } from './android-streamer';
import { SimulatorStreamer } from './simulator-streamer';
import type { StreamServerOptions, StreamDevice, StreamInfo } from './types';

export class StreamServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private androidStreamer: AndroidStreamer;
  private simulatorStreamer: SimulatorStreamer;
  private streams = new Map<string, StreamInfo>();

  constructor(options: StreamServerOptions = {}) {
    const port = options.port ?? 3456;
    const host = options.host ?? '0.0.0.0';

    this.androidStreamer = new AndroidStreamer();
    this.simulatorStreamer = new SimulatorStreamer();

    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });

    this.httpServer.listen(port, host, () => {
      console.log(`[StreamServer] Listening on ${host}:${port}`);
    });
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/devices') {
      this.listDevices()
        .then(devices => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(devices));
        })
        .catch(error => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleUpgrade(
    request: http.IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer,
  ): void {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/stream\/(.+)$/);

    if (!match) {
      socket.destroy();
      return;
    }

    const serial = decodeURIComponent(match[1]);

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleWebSocketConnection(ws, serial);
    });
  }

  private handleWebSocketConnection(ws: WebSocket, serial: string): void {
    const streamInfo = this.streams.get(serial);

    if (!streamInfo) {
      // Stream not started yet — hold the connection.
      // Delegate to the appropriate streamer so it can queue the WS.
      // We determine platform by checking both streamers.
      // If neither knows this serial, we still hold — startStream() will route later.
      // For now, try android first, then simulator.
      this.androidStreamer.handleWebSocket(ws, serial);
      // Also register with simulator in case it's a simulator device.
      // The streamer that's actually active will broadcast frames;
      // the other just holds an empty browser set.
      this.simulatorStreamer.handleWebSocket(ws, serial);
      return;
    }

    if (streamInfo.platform === 'android') {
      this.androidStreamer.handleWebSocket(ws, serial);
    } else {
      this.simulatorStreamer.handleWebSocket(ws, serial);
    }
  }

  async listDevices(): Promise<StreamDevice[]> {
    const [android, simulator] = await Promise.all([
      this.androidStreamer.listDevices(),
      this.simulatorStreamer.listDevices(),
    ]);
    return [...android, ...simulator];
  }

  async startStream(serial: string): Promise<StreamInfo> {
    // Check if already streaming
    const existing = this.streams.get(serial);
    if (existing) return existing;

    // Determine platform by trying both
    const [androidDevices, simulatorDevices] = await Promise.all([
      this.androidStreamer.listDevices(),
      this.simulatorStreamer.listDevices(),
    ]);

    const isAndroid = androidDevices.some(d => d.serial === serial);
    const isSimulator = simulatorDevices.some(d => d.serial === serial);

    if (!isAndroid && !isSimulator) {
      throw new Error(`Device ${serial} not found`);
    }

    let info: StreamInfo;
    if (isAndroid) {
      info = await this.androidStreamer.startStream(serial);
    } else {
      info = await this.simulatorStreamer.startStream(serial);
    }

    this.streams.set(serial, info);
    console.log(`[StreamServer] Stream started: ${serial} (${info.platform}, ${info.codec})`);
    return info;
  }

  async stopStream(serial: string): Promise<void> {
    const info = this.streams.get(serial);
    if (!info) return;

    this.streams.delete(serial);

    if (info.platform === 'android') {
      await this.androidStreamer.stopStream(serial);
    } else {
      await this.simulatorStreamer.stopStream(serial);
    }

    console.log(`[StreamServer] Stream stopped: ${serial}`);
  }

  activeStreams(): StreamInfo[] {
    return Array.from(this.streams.values());
  }

  async close(): Promise<void> {
    console.log('[StreamServer] Shutting down...');

    // Stop all streams
    const serials = Array.from(this.streams.keys());
    await Promise.all(serials.map(serial => this.stopStream(serial)));

    // Cleanup streamers
    await Promise.all([
      this.androidStreamer.cleanup(),
      this.simulatorStreamer.cleanup(),
    ]);

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });

    console.log('[StreamServer] Shutdown complete');
  }
}
```

- [ ] **Step 2: Update `packages/stream-only/src/index.ts` with full exports**

Replace the contents of `packages/stream-only/src/index.ts`:

```typescript
export { StreamServerOptions, StreamDevice, StreamInfo } from './types';
export { StreamServer } from './stream-server';

import { StreamServer } from './stream-server';
import type { StreamServerOptions } from './types';

/**
 * Create and start a stream server.
 *
 * @example
 * const server = await createStreamServer({ port: 3456 });
 * const devices = await server.listDevices();
 * await server.startStream(devices[0].serial);
 */
export async function createStreamServer(
  options: StreamServerOptions = {},
): Promise<StreamServer> {
  return new StreamServer(options);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build -w @device-stream/stream-only`
Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add packages/stream-only/src/stream-server.ts packages/stream-only/src/index.ts
git commit -m "feat(stream-only): add StreamServer with HTTP + WebSocket routing"
```

---

### Task 6: Monorepo Integration

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add `build:stream-only` script and update `build` script**

In the root `package.json`, add to the `scripts` object:

Replace the `build` line:
```json
"build": "npm run build -w @device-stream/core && npm run build -w @device-stream/ios-simulator -w @device-stream/ios-device -w @device-stream/android",
```

With:
```json
"build": "npm run build -w @device-stream/core && npm run build -w @device-stream/ios-simulator -w @device-stream/ios-device -w @device-stream/android && npm run build -w @device-stream/stream-only",
```

And add after `build:android-server`:
```json
"build:stream-only": "npm run build -w @device-stream/stream-only",
```

- [ ] **Step 2: Install and do a full build**

Run: `cd /Users/heicg/conductor/workspaces/device-stream/kyiv && npm install && npm run build`
Expected: All packages build successfully, including `@device-stream/stream-only`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add stream-only to monorepo build pipeline"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/stream-only.md`

- [ ] **Step 1: Create `docs/stream-only.md`**

```markdown
# @device-stream/stream-only

Stream device screens to browsers via WebSocket. No control APIs — just video.

## Supported Platforms

- **Android** — H.264 via scrcpy (requires ADB server running)
- **iOS Simulator** — MJPEG via ScreenCaptureKit (requires sim-capture binary built)

## Quick Start

```bash
npm install @device-stream/stream-only
```

```typescript
import { createStreamServer } from '@device-stream/stream-only';

const server = await createStreamServer({ port: 3456 });

// List available devices
const devices = await server.listDevices();
console.log(devices);

// Start streaming a device
await server.startStream(devices[0].serial);

// Browsers connect via WebSocket:
//   /stream/{serial}
//
// Protocol:
//   1. Server sends { type: 'metadata', codec, width, height }
//   2. Server sends continuous frame messages
//   3. On disconnect: { type: 'device_disconnected', deviceId }
```

## API

### `createStreamServer(options?)`

Creates and starts the stream server.

| Option | Type     | Default     | Description         |
|--------|----------|-------------|---------------------|
| `port` | `number` | `3456`      | Server port         |
| `host` | `string` | `'0.0.0.0'` | Bind address        |

### `StreamServer`

| Method            | Returns               | Description                          |
|-------------------|-----------------------|--------------------------------------|
| `listDevices()`   | `Promise<StreamDevice[]>` | List all available devices       |
| `startStream(serial)` | `Promise<StreamInfo>` | Start streaming a device         |
| `stopStream(serial)`  | `Promise<void>`      | Stop streaming a device          |
| `activeStreams()`  | `StreamInfo[]`        | List active streams                  |
| `close()`         | `Promise<void>`       | Shutdown everything                  |

### REST

`GET /devices` — Returns `StreamDevice[]` as JSON.

### WebSocket

Connect to `/stream/{serial}` to receive frames.

## Prerequisites

- **Android**: ADB server running (`adb start-server`)
- **iOS Simulator**: `sim-capture` binary built (`npm run build:sim-capture` from repo root)
```

- [ ] **Step 2: Commit**

```bash
git add docs/stream-only.md
git commit -m "docs: add stream-only package documentation"
```
