/**
 * iOS Simulator Manager
 * Uses appium-ios-simulator for robust simulator management
 */

import { getSimulator, killAllSimulators } from 'appium-ios-simulator';
import type { Simulator } from 'appium-ios-simulator';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  FarmDevice,
  DeviceStatus,
  CreateDeviceOptions,
  InstallAppResult,
  StreamResult,
} from '@device-stream/core';

const execAsync = promisify(exec);

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  deviceTypeIdentifier?: string;
  runtime?: string;
}

interface SimctlRuntime {
  identifier: string;
  name: string;
  version: string;
  isAvailable: boolean;
}

export interface IOSSimulatorManagerOptions {
  bootTimeout?: number;
  mirrorKitAppPath?: string;
  mirrorKitBundleId?: string;
}

export class IOSSimulatorManager extends EventEmitter {
  private devices: Map<string, FarmDevice> = new Map();
  private simulators: Map<string, Simulator> = new Map();
  private bootTimeout: number;
  private mirrorKitAppPath: string;
  private mirrorKitBundleId: string;

  constructor(options: IOSSimulatorManagerOptions = {}) {
    super();
    this.bootTimeout = options.bootTimeout ?? 120000;
    this.mirrorKitBundleId = options.mirrorKitBundleId ?? 'com.devicestream.mirrorkit';
    this.mirrorKitAppPath = options.mirrorKitAppPath ?? path.resolve(__dirname, '../../mirrorkit/build/Release-iphonesimulator/MirrorKit.app');
  }

  /**
   * Get appium-ios-simulator instance for a device
   */
  private async getSimulatorInstance(udid: string): Promise<Simulator> {
    let sim = this.simulators.get(udid);
    if (!sim) {
      sim = await getSimulator(udid);
      this.simulators.set(udid, sim);
    }
    return sim;
  }

  /**
   * List available device types
   */
  async listDeviceTypes(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list devicetypes -j');
      const data = JSON.parse(stdout);
      return data.devicetypes.map((dt: { identifier: string }) => dt.identifier);
    } catch (error) {
      console.error('Failed to list device types:', error);
      return [];
    }
  }

  /**
   * List available runtimes
   */
  async listRuntimes(): Promise<SimctlRuntime[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list runtimes -j');
      const data = JSON.parse(stdout);
      return data.runtimes.filter((r: SimctlRuntime) => r.isAvailable);
    } catch (error) {
      console.error('Failed to list runtimes:', error);
      return [];
    }
  }

  /**
   * Get latest iOS runtime
   */
  async getLatestIOSRuntime(): Promise<string | undefined> {
    const runtimes = await this.listRuntimes();
    const iosRuntimes = runtimes
      .filter(r => r.identifier.includes('iOS'))
      .sort((a, b) => {
        const versionA = parseFloat(a.version);
        const versionB = parseFloat(b.version);
        return versionB - versionA;
      });

    return iosRuntimes[0]?.identifier;
  }

  /**
   * List existing simulators
   */
  async listExistingSimulators(): Promise<SimctlDevice[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list devices -j');
      const data = JSON.parse(stdout);
      const devices: SimctlDevice[] = [];

      for (const runtime of Object.keys(data.devices)) {
        for (const device of data.devices[runtime]) {
          devices.push({
            ...device,
            runtime,
          });
        }
      }

      return devices;
    } catch (error) {
      console.error('Failed to list simulators:', error);
      return [];
    }
  }

  /**
   * Create a new iOS simulator
   */
  async createDevice(options: CreateDeviceOptions): Promise<FarmDevice> {
    const name = options.name || `farm-ios-${Date.now()}`;
    const deviceType = options.deviceType || 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro';
    const runtime = options.osVersion || await this.getLatestIOSRuntime();

    if (!runtime) {
      throw new Error('No iOS runtime available');
    }

    const device: FarmDevice = {
      id: '',
      platform: 'ios',
      name,
      status: 'creating',
      createdAt: Date.now(),
      metadata: {
        deviceType: deviceType.split('.').pop(),
        osVersion: runtime.split('.').pop(),
      },
    };

    this.emit('device:creating', device);

    try {
      // Check if simulator with this name already exists
      const existingSimulators = await this.listExistingSimulators();
      const existing = existingSimulators.find(s => s.name === name);

      if (existing) {
        device.id = existing.udid;
        device.serial = existing.udid;
        device.status = existing.state === 'Booted' ? 'ready' : 'stopped';
        this.devices.set(device.id, device);
        console.log(`Simulator already exists: ${name} (${existing.udid})`);
        return device;
      }

      // Create new simulator
      const { stdout } = await execAsync(
        `xcrun simctl create "${name}" "${deviceType}" "${runtime}"`
      );

      const udid = stdout.trim();
      device.id = udid;
      device.serial = udid;
      device.status = 'stopped';

      this.devices.set(udid, device);
      this.emit('device:created', device);

      console.log(`Created simulator: ${name} (${udid})`);
      return device;
    } catch (error) {
      device.status = 'error';
      device.error = error instanceof Error ? error.message : String(error);
      this.emit('device:error', { device, error: device.error });
      throw error;
    }
  }

  /**
   * Start a simulator using appium-ios-simulator
   */
  async startDevice(deviceId: string): Promise<FarmDevice> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (device.status === 'ready' || device.status === 'busy') {
      return device;
    }

    device.status = 'booting';
    this.emit('device:booting', device);

    try {
      const sim = await this.getSimulatorInstance(deviceId);

      // Run simulator in headless mode (no UI window)
      await sim.run({
        isHeadless: true,
        startupTimeout: this.bootTimeout,
        connectHardwareKeyboard: false,
        pasteboardAutomaticSync: 'off',
      });

      // Wait for boot to complete
      await sim.waitForBoot(this.bootTimeout);

      device.status = 'ready';
      this.emit('device:ready', device);
      return device;
    } catch (error) {
      // Check if already booted
      if (error instanceof Error && error.message.includes('already booted')) {
        device.status = 'ready';
        this.emit('device:ready', device);
        return device;
      }

      device.status = 'error';
      device.error = error instanceof Error ? error.message : String(error);
      this.emit('device:error', { device, error: device.error });
      throw error;
    }
  }

  /**
   * Stop a simulator
   */
  async stopDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (device.status === 'stopped' || device.status === 'stopping') {
      return;
    }

    device.status = 'stopping';
    this.emit('device:stopping', device);

    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.shutdown({ timeout: 30000 });

      device.status = 'stopped';
      this.emit('device:stopped', device);
    } catch (error) {
      // Check if already shutdown
      if (error instanceof Error && error.message.includes('current state: Shutdown')) {
        device.status = 'stopped';
        this.emit('device:stopped', device);
        return;
      }

      device.status = 'error';
      device.error = error instanceof Error ? error.message : String(error);
      this.emit('device:error', { device, error: device.error });
      throw error;
    }
  }

  /**
   * Delete a simulator
   */
  async deleteDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device && device.status !== 'stopped') {
      await this.stopDevice(deviceId);
    }

    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.delete();

      this.devices.delete(deviceId);
      this.simulators.delete(deviceId);
      console.log(`Deleted simulator: ${deviceId}`);
    } catch (error) {
      console.error(`Failed to delete simulator ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Install a .app bundle on the simulator
   */
  async installApp(deviceId: string, appPath: string): Promise<InstallAppResult> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return { success: false, error: 'Device not found' };
    }

    if (device.status !== 'ready' && device.status !== 'busy') {
      return { success: false, error: `Device not ready (status: ${device.status})` };
    }

    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.installApp(appPath);

      // Get bundle ID from Info.plist
      let bundleId: string | undefined;
      try {
        const { stdout } = await execAsync(
          `/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${appPath}/Info.plist"`
        );
        bundleId = stdout.trim();
      } catch {
        try {
          const { stdout } = await execAsync(
            `defaults read "${appPath}/Info" CFBundleIdentifier`
          );
          bundleId = stdout.trim();
        } catch {
          console.warn('Could not extract bundle ID from app');
        }
      }

      return { success: true, bundleId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Launch an app on the simulator
   */
  async launchApp(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.launchApp(bundleId, { wait: true, timeoutMs: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Terminate an app on the simulator
   */
  async terminateApp(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.terminateApp(bundleId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if an app is installed
   */
  async isAppInstalled(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      return await sim.isAppInstalled(bundleId);
    } catch {
      return false;
    }
  }

  /**
   * Check if an app is running
   */
  async isAppRunning(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      return await sim.isAppRunning(bundleId);
    } catch {
      return false;
    }
  }

  /**
   * Uninstall an app from the simulator
   */
  async uninstallApp(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.removeApp(bundleId);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== PERMISSIONS ====================

  /**
   * Set app permission
   * @param permission - e.g., 'calendar', 'camera', 'contacts', 'location', 'microphone', 'photos', etc.
   * @param value - 'yes', 'no', 'unset'
   */
  async setAppPermission(deviceId: string, bundleId: string, permission: string, value: 'yes' | 'no' | 'unset'): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setPermission(bundleId, permission, value);
  }

  /**
   * Set multiple app permissions at once
   */
  async setAppPermissions(deviceId: string, bundleId: string, permissions: Record<string, 'yes' | 'no' | 'unset'>): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setPermissions(bundleId, permissions);
  }

  /**
   * Get app permission value
   */
  async getAppPermission(deviceId: string, bundleId: string, permission: string): Promise<string> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.getPermission(bundleId, permission);
  }

  // ==================== BIOMETRICS ====================

  /**
   * Enroll or unenroll biometric (Face ID / Touch ID)
   */
  async setBiometricEnrolled(deviceId: string, enrolled: boolean): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.enrollBiometric(enrolled);
  }

  /**
   * Check if biometric is enrolled
   */
  async isBiometricEnrolled(deviceId: string): Promise<boolean> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.isBiometricEnrolled();
  }

  /**
   * Send biometric match/non-match
   * @param shouldMatch - true for successful auth, false for failure
   * @param biometricName - 'touchId' or 'faceId'
   */
  async sendBiometricMatch(deviceId: string, shouldMatch: boolean, biometricName: 'touchId' | 'faceId' = 'faceId'): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.sendBiometricMatch(shouldMatch, biometricName);
  }

  // ==================== SYSTEM SETTINGS ====================

  /**
   * Set device geolocation
   */
  async setGeolocation(deviceId: string, latitude: number, longitude: number): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setGeolocation(latitude, longitude);
  }

  /**
   * Set device appearance (light/dark mode)
   */
  async setAppearance(deviceId: string, mode: 'light' | 'dark'): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setAppearance(mode);
  }

  /**
   * Get current appearance
   */
  async getAppearance(deviceId: string): Promise<string> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.getAppearance();
  }

  /**
   * Configure localization (language, locale, keyboard)
   */
  async configureLocalization(deviceId: string, options: {
    language?: { name: string };
    locale?: { name: string; calendar?: string };
    keyboard?: { name: string; layout: string };
  }): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.configureLocalization(options);
  }

  // ==================== UTILITIES ====================

  /**
   * Send push notification to the simulator
   */
  async pushNotification(deviceId: string, bundleId: string, payload: Record<string, unknown>): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.pushNotification({
      ...payload,
      'Simulator Target Bundle': bundleId,
    });
  }

  /**
   * Shake the device (triggers shake gesture)
   */
  async shake(deviceId: string): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.shake();
  }

  /**
   * Clear keychains
   */
  async clearKeychains(deviceId: string): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.clearKeychains();
  }

  /**
   * Open URL in simulator (Safari or deep link)
   */
  async openUrl(deviceId: string, url: string): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.openUrl(url);
  }

  /**
   * Get list of running processes on simulator
   */
  async getRunningProcesses(deviceId: string): Promise<Array<{ pid: number; name: string; group: string | null }>> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.ps();
  }

  // ==================== MIRRORKIT STREAMING ====================

  /**
   * Install MirrorKit app on the simulator
   */
  async installMirrorKit(deviceId: string): Promise<InstallAppResult> {
    const appPath = this.mirrorKitAppPath;

    // Check if app exists
    try {
      await fs.access(appPath);
    } catch {
      return {
        success: false,
        error: `MirrorKit app not found at ${appPath}. Run 'npm run build:mirrorkit' first.`
      };
    }

    // Check if already installed
    const isInstalled = await this.isAppInstalled(deviceId, this.mirrorKitBundleId);
    if (isInstalled) {
      console.log(`[MirrorKit] Already installed on ${deviceId}`);
      return { success: true, bundleId: this.mirrorKitBundleId };
    }

    console.log(`[MirrorKit] Installing on ${deviceId}...`);
    return await this.installApp(deviceId, appPath);
  }

  /**
   * Launch MirrorKit app on the simulator with server URL
   */
  async launchMirrorKit(
    deviceId: string,
    serverHost: string = 'localhost',
    serverPort: number = 5001
  ): Promise<boolean> {
    // Build server URL
    const serverUrl = `ws://${serverHost}:${serverPort}/ws/mirror/device?deviceId=${deviceId}`;

    console.log(`[MirrorKit] Launching on ${deviceId} with server ${serverUrl}`);

    try {
      // First terminate if already running
      const isRunning = await this.isAppRunning(deviceId, this.mirrorKitBundleId);
      if (isRunning) {
        await this.terminateApp(deviceId, this.mirrorKitBundleId);
        // Wait a bit for app to fully terminate
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Launch with arguments using simctl directly
      const { stderr } = await execAsync(
        `xcrun simctl launch ${deviceId} ${this.mirrorKitBundleId} --server "${serverUrl}"`
      );

      if (stderr && !stderr.includes('Waiting')) {
        console.warn(`[MirrorKit] Launch warning: ${stderr}`);
      }

      console.log(`[MirrorKit] Launched successfully on ${deviceId}`);
      return true;
    } catch (error) {
      console.error(`[MirrorKit] Failed to launch:`, error);
      return false;
    }
  }

  /**
   * Stop MirrorKit streaming on the simulator
   */
  async stopMirrorKit(deviceId: string): Promise<boolean> {
    console.log(`[MirrorKit] Stopping on ${deviceId}`);
    return await this.terminateApp(deviceId, this.mirrorKitBundleId);
  }

  /**
   * Start streaming from simulator (install + launch MirrorKit)
   */
  async startStreaming(
    deviceId: string,
    serverHost: string = 'localhost',
    serverPort: number = 5001
  ): Promise<StreamResult> {
    // Ensure device is ready
    const device = this.devices.get(deviceId);
    if (!device || (device.status !== 'ready' && device.status !== 'busy')) {
      return { success: false, error: `Device ${deviceId} is not ready` };
    }

    // Install MirrorKit
    const installResult = await this.installMirrorKit(deviceId);
    if (!installResult.success) {
      return { success: false, error: installResult.error };
    }

    // Launch MirrorKit
    const launched = await this.launchMirrorKit(deviceId, serverHost, serverPort);
    if (!launched) {
      return { success: false, error: 'Failed to launch MirrorKit' };
    }

    return { success: true };
  }

  /**
   * Stop streaming from simulator
   */
  async stopStreaming(deviceId: string): Promise<void> {
    await this.stopMirrorKit(deviceId);
  }

  // ==================== DEVICE MANAGEMENT ====================

  /**
   * Get device by ID
   */
  getDevice(deviceId: string): FarmDevice | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Get all devices
   */
  getAllDevices(): FarmDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get devices by status
   */
  getDevicesByStatus(status: DeviceStatus): FarmDevice[] {
    return this.getAllDevices().filter(d => d.status === status);
  }

  /**
   * Mark device as busy
   */
  markBusy(deviceId: string, taskId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = 'busy';
      device.taskId = taskId;
      device.lastUsedAt = Date.now();
      this.emit('device:busy', { device, taskId });
    }
  }

  /**
   * Release device (mark as ready)
   */
  releaseDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device && device.status === 'busy') {
      device.status = 'ready';
      device.taskId = undefined;
      this.emit('device:released', device);
    }
  }

  /**
   * Stop all simulators
   */
  async stopAll(): Promise<void> {
    const stopPromises = this.getAllDevices()
      .filter(d => d.status !== 'stopped')
      .map(d => this.stopDevice(d.id));

    await Promise.allSettled(stopPromises);
  }

  /**
   * Kill all simulators (force)
   */
  async killAll(): Promise<void> {
    await killAllSimulators();

    // Update all device statuses
    for (const device of this.devices.values()) {
      device.status = 'stopped';
    }
  }

  /**
   * Clean up - stop all and delete farm-created simulators
   */
  async cleanup(): Promise<void> {
    await this.stopAll();

    // Delete simulators created by the farm
    const farmDevices = this.getAllDevices().filter(d => d.name.startsWith('farm-ios-'));
    for (const device of farmDevices) {
      try {
        await this.deleteDevice(device.id);
      } catch (error) {
        console.error(`Failed to delete ${device.id}:`, error);
      }
    }
  }
}

// Export factory function
export function createIOSSimulatorManager(options?: IOSSimulatorManagerOptions): IOSSimulatorManager {
  return new IOSSimulatorManager(options);
}
