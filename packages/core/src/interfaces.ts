/**
 * Core interfaces for device streaming services
 */

import {
  Device,
  DevicePlatform,
  DeviceConnection,
  VideoStreamMetadata,
  ScrollDirection,
  AccessibilityNode,
  DeviceStateSnapshot,
  AppInfo,
  LogEntry,
  PlatformCapability,
  AppearanceMode,
} from './types';

/**
 * Base interface for all device services (Android, iOS, etc.)
 */
export interface DeviceService {
  /**
   * Get the platform this service handles
   */
  getPlatform(): DevicePlatform;

  /**
   * List all available devices for this platform
   */
  listDevices(): Promise<Device[]>;

  /**
   * Connect to a specific device
   */
  connect(serial: string): Promise<void>;

  /**
   * Disconnect from a device
   */
  disconnect(serial: string): Promise<void>;

  /**
   * Check if a device is connected
   */
  isConnected(serial: string): boolean;

  /**
   * Execute tap gesture at coordinates
   */
  tap(serial: string, x: number, y: number): Promise<void>;

  /**
   * Type text on the device
   */
  typeText(serial: string, text: string): Promise<void>;

  /**
   * Press a system key
   */
  pressKey(serial: string, key: string): Promise<void>;

  /**
   * Capture screenshot
   */
  screenshot(serial: string): Promise<Buffer>;

  /**
   * Perform swipe gesture
   */
  swipe?(
    serial: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration?: number
  ): Promise<void>;

  /**
   * Perform scroll gesture in a direction
   */
  scroll?(
    serial: string,
    direction: ScrollDirection,
    distance?: number
  ): Promise<void>;

  /**
   * Start screen mirroring stream
   */
  startMirroring(serial: string): Promise<VideoStreamMetadata>;

  /**
   * Stop screen mirroring stream
   */
  stopMirroring(serial: string): Promise<void>;

  // ─── State ───

  /**
   * Get the accessibility tree (UI hierarchy) for AI agent automation
   */
  getAccessibilityTree?(serial: string, maxElements?: number): Promise<AccessibilityNode[]>;

  /**
   * Get combined device state (a11y tree + app info + device context)
   */
  getDeviceState?(serial: string): Promise<DeviceStateSnapshot>;

  /**
   * Get the list of capabilities this platform supports
   */
  getCapabilities?(): PlatformCapability[];

  // ─── App Management ───

  /**
   * Launch an app by bundle/package ID
   */
  launchApp?(serial: string, appId: string): Promise<void>;

  /**
   * Terminate a running app
   */
  terminateApp?(serial: string, appId: string): Promise<void>;

  /**
   * Install an app from a local file path
   */
  installApp?(serial: string, path: string): Promise<void>;

  /**
   * Uninstall an app by bundle/package ID
   */
  uninstallApp?(serial: string, appId: string): Promise<void>;

  /**
   * List installed applications
   */
  listInstalledApps?(serial: string): Promise<AppInfo[]>;

  /**
   * Clear app data/cache
   */
  clearAppData?(serial: string, appId: string): Promise<void>;

  // ─── Navigation ───

  /**
   * Open a deep link / URL on the device
   */
  openDeepLink?(serial: string, url: string): Promise<void>;

  /**
   * Press the back button / navigate back
   */
  back?(serial: string): Promise<void>;

  /**
   * Perform a long press at coordinates
   */
  longPress?(serial: string, x: number, y: number, duration?: number): Promise<void>;

  // ─── Settings ───

  /**
   * Set simulated GPS location
   */
  setLocation?(serial: string, lat: number, lng: number): Promise<void>;

  /**
   * Clear simulated GPS location
   */
  clearLocation?(serial: string): Promise<void>;

  /**
   * Set appearance mode (light/dark)
   */
  setAppearance?(serial: string, mode: AppearanceMode): Promise<void>;

  /**
   * Get current appearance mode
   */
  getAppearance?(serial: string): Promise<AppearanceMode>;

  /**
   * Set device locale
   */
  setLocale?(serial: string, locale: string): Promise<void>;

  // ─── Permissions ───

  /**
   * Grant a permission to an app
   */
  grantPermission?(serial: string, appId: string, permission: string): Promise<void>;

  /**
   * Revoke a permission from an app
   */
  revokePermission?(serial: string, appId: string, permission: string): Promise<void>;

  // ─── I/O ───

  /**
   * Get device clipboard text
   */
  getClipboard?(serial: string): Promise<string>;

  /**
   * Set device clipboard text
   */
  setClipboard?(serial: string, text: string): Promise<void>;

  /**
   * Add media (photo/video) to the device gallery
   */
  addMedia?(serial: string, path: string): Promise<void>;

  // ─── Streaming ───

  /**
   * Start streaming device logs
   */
  startLogStream?(serial: string, filter?: string): Promise<void>;

  /**
   * Stop streaming device logs
   */
  stopLogStream?(serial: string): Promise<void>;

  /**
   * Start screen recording
   */
  startRecording?(serial: string): Promise<void>;

  /**
   * Stop screen recording and return the video buffer
   */
  stopRecording?(serial: string): Promise<Buffer>;
}

/**
 * Abstract base class for platform-specific device services
 * Provides common functionality and state management
 */
export abstract class BaseDeviceService implements DeviceService {
  protected connections: Map<string, DeviceConnection> = new Map();
  protected platform: DevicePlatform;

  constructor(platform: DevicePlatform) {
    this.platform = platform;
  }

  getPlatform(): DevicePlatform {
    return this.platform;
  }

  isConnected(serial: string): boolean {
    return this.connections.has(serial);
  }

  protected markConnected(serial: string, sessionId?: string): void {
    this.connections.set(serial, {
      serial,
      platform: this.platform,
      connectedAt: Date.now(),
      sessionId,
    });
  }

  protected markDisconnected(serial: string): void {
    this.connections.delete(serial);
  }

  protected assertConnected(serial: string): void {
    if (!this.isConnected(serial)) {
      throw new Error(`Device ${serial} is not connected. Platform: ${this.platform}`);
    }
  }

  protected getConnection(serial: string): DeviceConnection {
    const connection = this.connections.get(serial);
    if (!connection) {
      throw new Error(`Device ${serial} is not connected. Platform: ${this.platform}`);
    }
    return connection;
  }

  async swipe(
    _serial: string,
    _startX: number,
    _startY: number,
    _endX: number,
    _endY: number,
    _duration?: number
  ): Promise<void> {
    throw new Error(`swipe is not supported on platform: ${this.platform}`);
  }

  async scroll(
    _serial: string,
    _direction: ScrollDirection,
    _distance?: number
  ): Promise<void> {
    throw new Error(`scroll is not supported on platform: ${this.platform}`);
  }

  async getAccessibilityTree(_serial: string, _maxElements?: number): Promise<AccessibilityNode[]> {
    throw new Error(`getAccessibilityTree is not supported on platform: ${this.platform}`);
  }

  async getDeviceState(_serial: string): Promise<DeviceStateSnapshot> {
    throw new Error(`getDeviceState is not supported on platform: ${this.platform}`);
  }

  getCapabilities(): PlatformCapability[] {
    return [];
  }

  async launchApp(_serial: string, _appId: string): Promise<void> {
    throw new Error(`launchApp is not supported on platform: ${this.platform}`);
  }

  async terminateApp(_serial: string, _appId: string): Promise<void> {
    throw new Error(`terminateApp is not supported on platform: ${this.platform}`);
  }

  async installApp(_serial: string, _path: string): Promise<void> {
    throw new Error(`installApp is not supported on platform: ${this.platform}`);
  }

  async uninstallApp(_serial: string, _appId: string): Promise<void> {
    throw new Error(`uninstallApp is not supported on platform: ${this.platform}`);
  }

  async listInstalledApps(_serial: string): Promise<AppInfo[]> {
    throw new Error(`listInstalledApps is not supported on platform: ${this.platform}`);
  }

  async clearAppData(_serial: string, _appId: string): Promise<void> {
    throw new Error(`clearAppData is not supported on platform: ${this.platform}`);
  }

  async openDeepLink(_serial: string, _url: string): Promise<void> {
    throw new Error(`openDeepLink is not supported on platform: ${this.platform}`);
  }

  async back(_serial: string): Promise<void> {
    throw new Error(`back is not supported on platform: ${this.platform}`);
  }

  async longPress(_serial: string, _x: number, _y: number, _duration?: number): Promise<void> {
    throw new Error(`longPress is not supported on platform: ${this.platform}`);
  }

  async setLocation(_serial: string, _lat: number, _lng: number): Promise<void> {
    throw new Error(`setLocation is not supported on platform: ${this.platform}`);
  }

  async clearLocation(_serial: string): Promise<void> {
    throw new Error(`clearLocation is not supported on platform: ${this.platform}`);
  }

  async setAppearance(_serial: string, _mode: AppearanceMode): Promise<void> {
    throw new Error(`setAppearance is not supported on platform: ${this.platform}`);
  }

  async getAppearance(_serial: string): Promise<AppearanceMode> {
    throw new Error(`getAppearance is not supported on platform: ${this.platform}`);
  }

  async setLocale(_serial: string, _locale: string): Promise<void> {
    throw new Error(`setLocale is not supported on platform: ${this.platform}`);
  }

  async grantPermission(_serial: string, _appId: string, _permission: string): Promise<void> {
    throw new Error(`grantPermission is not supported on platform: ${this.platform}`);
  }

  async revokePermission(_serial: string, _appId: string, _permission: string): Promise<void> {
    throw new Error(`revokePermission is not supported on platform: ${this.platform}`);
  }

  async getClipboard(_serial: string): Promise<string> {
    throw new Error(`getClipboard is not supported on platform: ${this.platform}`);
  }

  async setClipboard(_serial: string, _text: string): Promise<void> {
    throw new Error(`setClipboard is not supported on platform: ${this.platform}`);
  }

  async addMedia(_serial: string, _path: string): Promise<void> {
    throw new Error(`addMedia is not supported on platform: ${this.platform}`);
  }

  async startLogStream(_serial: string, _filter?: string): Promise<void> {
    throw new Error(`startLogStream is not supported on platform: ${this.platform}`);
  }

  async stopLogStream(_serial: string): Promise<void> {
    throw new Error(`stopLogStream is not supported on platform: ${this.platform}`);
  }

  async startRecording(_serial: string): Promise<void> {
    throw new Error(`startRecording is not supported on platform: ${this.platform}`);
  }

  async stopRecording(_serial: string): Promise<Buffer> {
    throw new Error(`stopRecording is not supported on platform: ${this.platform}`);
  }

  // Abstract methods to be implemented by platform-specific services
  abstract listDevices(): Promise<Device[]>;
  abstract connect(serial: string): Promise<void>;
  abstract disconnect(serial: string): Promise<void>;
  abstract tap(serial: string, x: number, y: number): Promise<void>;
  abstract typeText(serial: string, text: string): Promise<void>;
  abstract pressKey(serial: string, key: string): Promise<void>;
  abstract screenshot(serial: string): Promise<Buffer>;
  abstract startMirroring(serial: string): Promise<VideoStreamMetadata>;
  abstract stopMirroring(serial: string): Promise<void>;
}
