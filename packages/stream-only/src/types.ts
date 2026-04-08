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
