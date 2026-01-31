/**
 * Scrcpy streaming service for Android devices
 * Uses TangoADB (@yume-chan/adb-scrcpy) for H.264 video streaming
 */

import type { Adb } from '@yume-chan/adb';
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import type { WebSocket } from 'ws';
import { scrcpySetup } from './scrcpy-setup';

interface ScrcpySession {
  // Use any for the complex generic type
  client: AdbScrcpyClient<AdbScrcpyOptions2_1<true>>;
  serial: string;
  ws: WebSocket;
  reader?: ReadableStreamDefaultReader<unknown>;
}

export class ScrcpyService {
  private sessions: Map<string, ScrcpySession> = new Map();

  async startStream(adb: Adb, serial: string, ws: WebSocket): Promise<void> {
    // Stop any existing session for this device
    await this.stopStream(serial);

    console.log(`Starting scrcpy stream for device ${serial}`);

    try {
      // Ensure scrcpy server is deployed on device
      await scrcpySetup.ensureServerReady(adb, true);

      // Create scrcpy options (using version 2.1 options class)
      // See: https://tangoadb.dev/scrcpy/options/
      // The Init interface takes all options in a single object
      const options = new AdbScrcpyOptions2_1({
        // Video settings - true enables video
        video: true,
        // Audio settings (disabled for lower bandwidth)
        audio: false,
        // Control settings (allow touch/input)
        control: true,
        // Use tunnel forward mode (more reliable)
        tunnelForward: true,
        // Send metadata
        sendDeviceMeta: true,
        sendCodecMeta: true,
        sendFrameMeta: true,
      });

      // Start scrcpy client
      // See: https://tangoadb.dev/scrcpy/start-server/
      const client = await AdbScrcpyClient.start(
        adb,
        scrcpySetup.getDeviceServerPath(),
        options
      );

      console.log(`Scrcpy client started for ${serial}`);

      // Get video stream (this is a Promise)
      // See: https://tangoadb.dev/scrcpy/video/
      const videoStream = await client.videoStream;

      if (!videoStream) {
        throw new Error('Video stream not available');
      }

      // Video stream has width, height properties directly on it
      // and metadata.codec for the codec info
      const width = videoStream.width;
      const height = videoStream.height;
      const codec = videoStream.metadata?.codec;

      console.log(`Video stream metadata:`, {
        codec,
        width,
        height,
      });

      // Create session
      const session: ScrcpySession = {
        client,
        serial,
        ws,
      };

      this.sessions.set(serial, session);

      // Send initial metadata to client
      ws.send(JSON.stringify({
        type: 'metadata',
        codec,
        width,
        height,
      }));

      // Listen for size changes (orientation changes)
      videoStream.sizeChanged(({ width: newWidth, height: newHeight }: { width: number; height: number }) => {
        console.log(`Video size changed for ${serial}: ${newWidth}x${newHeight}`);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'sizeChanged',
            width: newWidth,
            height: newHeight,
          }));
        }
      });

      // Start reading and forwarding video packets
      // Cast to ReadableStream<unknown> to avoid complex generic issues
      await this.pipeVideoStream(session, videoStream.stream as ReadableStream<unknown>);

    } catch (error) {
      console.error(`Failed to start scrcpy stream for ${serial}:`, error);
      throw error;
    }
  }

  private async pipeVideoStream(
    session: ScrcpySession,
    videoStream: ReadableStream<unknown>
  ): Promise<void> {
    const { ws, serial } = session;

    try {
      const reader = videoStream.getReader();
      session.reader = reader;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`Video stream ended for ${serial}`);
          break;
        }

        // Forward video packet to WebSocket client
        if (ws.readyState === 1) { // WebSocket.OPEN
          // Packet structure: { type: 'configuration' | 'data', data: Uint8Array, keyframe?: boolean, pts?: bigint }
          const packet = value as {
            type: string;
            data: Uint8Array;
            keyframe?: boolean;
            pts?: bigint;
          };

          const output: Record<string, unknown> = {
            type: packet.type,
            data: Array.from(packet.data),
          };

          if (packet.type === 'data') {
            output.keyframe = packet.keyframe;
            output.pts = packet.pts?.toString();
          }

          ws.send(JSON.stringify(output));
        } else {
          console.log(`WebSocket closed for ${serial}, stopping stream`);
          break;
        }
      }
    } catch (error) {
      console.error(`Error reading video stream for ${serial}:`, error);
    } finally {
      await this.stopStream(serial);
    }
  }

  async stopStream(serial: string): Promise<void> {
    const session = this.sessions.get(serial);

    if (session) {
      console.log(`Stopping scrcpy stream for ${serial}`);

      try {
        if (session.reader) {
          await session.reader.cancel();
        }

        await session.client.close();
      } catch (error) {
        console.error(`Error stopping stream for ${serial}:`, error);
      }

      this.sessions.delete(serial);
    }
  }

  isStreaming(serial: string): boolean {
    return this.sessions.has(serial);
  }

  getSession(serial: string): ScrcpySession | undefined {
    return this.sessions.get(serial);
  }

  /**
   * Stop all active streams
   */
  async stopAll(): Promise<void> {
    const serials = Array.from(this.sessions.keys());
    await Promise.all(serials.map(serial => this.stopStream(serial)));
  }
}

export const scrcpyService = new ScrcpyService();
