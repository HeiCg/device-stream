/**
 * @device-stream/android
 * Android device streaming via TangoADB + scrcpy
 */

export {
  AndroidDeviceService,
  androidDeviceService,
  tangoAdbService,
} from './device-service';

export {
  ScrcpyService,
  scrcpyService,
} from './scrcpy-service';

export {
  ScrcpySetup,
  scrcpySetup,
} from './scrcpy-setup';

// Re-export core types for convenience
export {
  Device,
  VideoStreamMetadata,
  DeviceConnection,
} from '@device-stream/core';

// Re-export TangoADB types
export { Adb, AdbServerClient } from '@yume-chan/adb';
