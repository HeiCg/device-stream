# @device-stream/ios-simulator

iOS Simulator streaming via MirrorKit app + polling fallback.

## System Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS only |
| **Xcode** | Required (for `xcrun simctl`) |
| **Nix** | Not required |

## How It Works

### MirrorKit (Primary)

MirrorKit is a Swift app that runs inside the iOS Simulator and uses ReplayKit to capture the screen at 30fps. It connects to your server via WebSocket and sends MJPEG frames.

```
┌─────────────────────────────────────────────────────────────┐
│  iOS Simulator                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  MirrorKit.app                                        │  │
│  │  ├─ ReplayKit (captures 30fps)                        │  │
│  │  ├─ Metal GPU (JPEG encoding)                         │  │
│  │  └─ WebSocket → server                                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │ WebSocket (MJPEG)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Your Server (SimulatorStreamService)                       │
│  ├─ /ws/mirror/device   ← receives frames from MirrorKit   │
│  └─ /ws/mirror/browser  → forwards to browser clients      │
└─────────────────────────────────────────────────────────────┘
```

### Polling Fallback

If MirrorKit fails (e.g., ReplayKit permission denied), the service automatically falls back to polling screenshots at 15fps using `xcrun simctl io screenshot`.

## Setup

### 1. Build MirrorKit

```bash
cd device-stream
npm run build:mirrorkit
```

This builds the MirrorKit app for iOS Simulator.

### 2. Install Dependencies

```bash
npm install @device-stream/ios-simulator
```

## Usage

### Basic Example

```typescript
import {
  IOSSimulatorManager,
  SimulatorStreamService,
} from '@device-stream/ios-simulator';
import { WebSocketServer } from 'ws';

// Create manager
const manager = new IOSSimulatorManager({
  bootTimeout: 120000,
  mirrorKitAppPath: './mirrorkit/build/Release-iphonesimulator/MirrorKit.app',
  mirrorKitBundleId: 'com.devicestream.mirrorkit',
});

// Create simulator
const device = await manager.createDevice({
  platform: 'ios',
  deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
});

// Boot simulator
await manager.startDevice(device.id);

// Create stream service
const streamService = new SimulatorStreamService();

// Set up WebSocket server
const wss = new WebSocketServer({ port: 5001 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `ws://${req.headers.host}`);
  const deviceId = url.searchParams.get('deviceId');

  if (url.pathname === '/ws/mirror/device') {
    // MirrorKit app connects here
    streamService.handleDeviceConnection(ws, deviceId!);
  } else if (url.pathname === '/ws/mirror/browser') {
    // Browser clients connect here
    streamService.handleBrowserConnection(ws, deviceId!);
  }
});

// Start streaming (installs and launches MirrorKit)
await manager.startStreaming(device.id, 'localhost', 5001);
```

### Using Polling Fallback

```typescript
const streamService = new SimulatorStreamService();

// Start polling mode (15fps screenshots)
await streamService.startPollingFallback(deviceId, browserWebSocket);
```

## API Reference

### IOSSimulatorManager

```typescript
class IOSSimulatorManager extends EventEmitter {
  constructor(options?: IOSSimulatorManagerOptions);

  // Simulator lifecycle
  createDevice(options: CreateDeviceOptions): Promise<FarmDevice>;
  startDevice(deviceId: string): Promise<FarmDevice>;
  stopDevice(deviceId: string): Promise<void>;
  deleteDevice(deviceId: string): Promise<void>;

  // Streaming
  startStreaming(deviceId: string, serverHost?: string, serverPort?: number): Promise<StreamResult>;
  stopStreaming(deviceId: string): Promise<void>;

  // App management
  installApp(deviceId: string, appPath: string): Promise<InstallAppResult>;
  launchApp(deviceId: string, bundleId: string): Promise<boolean>;
  terminateApp(deviceId: string, bundleId: string): Promise<boolean>;

  // Device management
  getDevice(deviceId: string): FarmDevice | undefined;
  getAllDevices(): FarmDevice[];
  killAll(): Promise<void>;
  cleanup(): Promise<void>;

  // Runtime info
  listDeviceTypes(): Promise<string[]>;
  listRuntimes(): Promise<SimctlRuntime[]>;
  listExistingSimulators(): Promise<SimctlDevice[]>;
}
```

### SimulatorStreamService

```typescript
class SimulatorStreamService {
  // WebSocket handlers
  handleDeviceConnection(ws: WebSocket, deviceId: string): void;
  handleBrowserConnection(ws: WebSocket, deviceId: string): void;

  // Polling fallback
  startPollingFallback(deviceId: string, ws: WebSocket): Promise<void>;

  // Status
  isDeviceConnected(deviceId: string): boolean;
  getConnectedDevices(): string[];
  getDeviceStats(deviceId: string): DeviceStats | null;

  // Cleanup
  cleanup(): void;
}
```

## Events

The `IOSSimulatorManager` emits these events:

| Event | Payload | Description |
|-------|---------|-------------|
| `device:creating` | `FarmDevice` | Device creation started |
| `device:created` | `FarmDevice` | Device created successfully |
| `device:booting` | `FarmDevice` | Device boot started |
| `device:ready` | `FarmDevice` | Device fully booted |
| `device:stopping` | `FarmDevice` | Device shutdown started |
| `device:stopped` | `FarmDevice` | Device shut down |
| `device:busy` | `{ device, taskId }` | Device marked as busy |
| `device:released` | `FarmDevice` | Device released from task |
| `device:error` | `{ device, error }` | Error occurred |

## Troubleshooting

### MirrorKit not connecting

1. Check that MirrorKit is built: `ls mirrorkit/build/Release-iphonesimulator/MirrorKit.app`
2. Verify the simulator is booted: `xcrun simctl list devices | grep Booted`
3. Check WebSocket server is running on the correct port

### ReplayKit permission denied

The first time MirrorKit runs, iOS will prompt for screen recording permission. Accept it, or the service will fall back to polling mode.

### Low FPS with polling

Polling mode is limited to ~15fps due to screenshot capture overhead. For 30fps, use MirrorKit with ReplayKit.

## Limitations

- macOS only (requires Xcode)
- MirrorKit requires building from source
- First launch needs ReplayKit permission
- Polling fallback: 15fps vs MirrorKit 30fps
