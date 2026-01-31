/**
 * @device-stream/core
 * Core types, interfaces, and utilities for device streaming
 */

// Types
export {
  DevicePlatform,
  InputAction,
  VideoCodec,
  ScrollDirection,
  DeviceStatus,
  Device,
  VideoStreamMetadata,
  DeviceConnection,
  PlatformCapabilities,
  FarmDevice,
  CreateDeviceOptions,
  InstallAppResult,
  StreamResult,
} from './types';

// Interfaces
export {
  DeviceService,
  BaseDeviceService,
} from './interfaces';

// Protocol
export {
  CODEC,
  CODEC_NAME,
  MESSAGE_TYPE,
  MetadataMessage,
  FrameMessage,
  DataMessage,
  DeviceDisconnectedMessage,
  PingMessage,
  createMetadataMessage,
  createFrameMessage,
  createDataMessage,
} from './protocol';

// Utilities
export {
  AsyncMutex,
  DeviceMutexManager,
} from './mutex';
