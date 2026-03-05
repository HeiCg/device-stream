/**
 * @device-stream/ios-simulator
 * iOS Simulator streaming via ScreenCaptureKit (sim-capture binary)
 */

export {
  SimulatorStreamService,
  simulatorStreamService,
} from './stream-service';

export {
  IOSSimulatorManager,
  IOSSimulatorManagerOptions,
  createIOSSimulatorManager,
} from './simulator-manager';

export {
  CaptureService,
  createCaptureService,
} from './capture-service';

// Re-export core types for convenience
export {
  FarmDevice,
  DeviceStatus,
  CreateDeviceOptions,
  InstallAppResult,
  StreamResult,
} from '@device-stream/core';
