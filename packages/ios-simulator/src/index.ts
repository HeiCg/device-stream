/**
 * @device-stream/ios-simulator
 * iOS Simulator streaming via MirrorKit + polling fallback
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

// Re-export core types for convenience
export {
  FarmDevice,
  DeviceStatus,
  CreateDeviceOptions,
  InstallAppResult,
  StreamResult,
} from '@device-stream/core';
