/**
 * Scrcpy streaming service for Android devices
 * Uses TangoADB (@yume-chan/adb-scrcpy) for H.264 video streaming
 */

import type { Adb } from '@yume-chan/adb';
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { VERSION } from '@yume-chan/fetch-scrcpy-server';
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';
import type { ReadableStream } from '@yume-chan/stream-extra';
import type { WebSocket } from 'ws';
import { scrcpySetup } from './scrcpy-setup';

interface ScrcpySession {
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  videoStream: ReadableStream<ScrcpyMediaStreamPacket>;
  serial: string;
  ws: WebSocket;
  reader?: ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
  stopping?: boolean;
}

export class ScrcpyService {
  private sessions: Map<string, ScrcpySession> = new Map();

  async startStream(adb: Adb, serial: string, ws: WebSocket): Promise<void> {
    // Stop any existing session for this device
    await this.stopStream(serial);

    console.log(`Starting scrcpy stream for device ${serial}`);

    try {
      // Ensure scrcpy server is deployed on device (force reinstall to update version)
      await scrcpySetup.ensureServerReady(adb, true);

      // Create scrcpy options - use latest version with video enabled
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

      // Start scrcpy client
      const client = await AdbScrcpyClient.start(
        adb,
        scrcpySetup.getDeviceServerPath(),
        options
      );

      console.log(`Scrcpy client started for ${serial}`);

      // Get video stream
      const videoStreamPromise = await client.videoStream;

      if (!videoStreamPromise) {
        throw new Error('Video stream not available');
      }

      const videoStream = videoStreamPromise.stream;
      const metadata = videoStreamPromise.metadata;

      console.log(`Video stream metadata:`, {
        codec: metadata.codec,
        width: videoStreamPromise.width,
        height: videoStreamPromise.height,
      });

      // Create session
      const session: ScrcpySession = {
        client,
        videoStream,
        serial,
        ws,
      };

      this.sessions.set(serial, session);

      // Send initial metadata to client
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: metadata.codec,
        width: videoStreamPromise.width,
        height: videoStreamPromise.height,
      }));

      // Start reading and forwarding video packets (fire-and-forget to avoid blocking)
      this.pipeVideoStream(session).catch(err =>
        console.error(`pipeVideoStream error for ${serial}:`, err)
      );

    } catch (error) {
      console.error(`Failed to start scrcpy stream for ${serial}:`, error);
      throw error;
    }
  }

  private async pipeVideoStream(session: ScrcpySession): Promise<void> {
    const { videoStream, ws, serial } = session;

    try {
      const reader = videoStream.getReader() as unknown as ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
      session.reader = reader;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`Video stream ended for ${serial}`);
          break;
        }

        // Forward video packet to WebSocket client
        if (ws.readyState === 1) { // WebSocket.OPEN
          const packet = {
            type: value.type,
            data: Buffer.from(value.data).toString('base64'),
            ...(value.type === 'data' && {
              keyframe: value.keyframe,
              pts: value.pts?.toString(),
            }),
          };

          ws.send(JSON.stringify(packet));
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

    if (!session || session.stopping) return;

    session.stopping = true;
    this.sessions.delete(serial);

    console.log(`Stopping scrcpy stream for ${serial}`);

    try {
      if (session.reader) {
        await session.reader.cancel();
      }

      await session.client.close();
    } catch (error) {
      console.error(`Error stopping stream for ${serial}:`, error);
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
