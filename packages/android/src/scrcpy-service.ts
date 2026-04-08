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

interface ScrcpyCallbackSession {
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  videoStream: ReadableStream<ScrcpyMediaStreamPacket>;
  serial: string;
  reader?: ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
  stopping?: boolean;
}

export type FrameCallback = (packet: {
  type: string;
  data: string;
  keyframe?: boolean;
  pts?: string;
}) => void;

export class ScrcpyService {
  private sessions: Map<string, ScrcpySession> = new Map();
  private callbackSessions: Map<string, ScrcpyCallbackSession> = new Map();

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

  async startStreamWithCallback(
    adb: Adb,
    serial: string,
    onMetadata: (metadata: { codec: number; width: number; height: number }) => void,
    onFrame: FrameCallback,
  ): Promise<void> {
    // Stop any existing callback session for this device
    await this.stopCallbackStream(serial);

    console.log('Starting scrcpy callback stream for device', serial);

    try {
      await scrcpySetup.ensureServerReady(adb, true);

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

      const client = await AdbScrcpyClient.start(
        adb,
        scrcpySetup.getDeviceServerPath(),
        options
      );

      const videoStreamPromise = await client.videoStream;
      if (!videoStreamPromise) {
        throw new Error('Video stream not available');
      }

      const videoStream = videoStreamPromise.stream;
      const metadata = videoStreamPromise.metadata;

      const session: ScrcpyCallbackSession = {
        client,
        videoStream,
        serial,
      };

      this.callbackSessions.set(serial, session);

      onMetadata({
        codec: metadata.codec,
        width: videoStreamPromise.width,
        height: videoStreamPromise.height,
      });

      this.pipeCallbackStream(session, onFrame).catch(err =>
        console.error('pipeCallbackStream error for', serial, ':', err)
      );

    } catch (error) {
      console.error('Failed to start scrcpy callback stream for', serial, ':', error);
      throw error;
    }
  }

  private async pipeCallbackStream(
    session: ScrcpyCallbackSession,
    onFrame: FrameCallback,
  ): Promise<void> {
    const { videoStream, serial } = session;

    console.log('[pipeCallbackStream] Starting frame reader for', serial);
    let frameCount = 0;

    try {
      const reader = videoStream.getReader() as unknown as ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
      session.reader = reader;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('Callback video stream ended for', serial, 'after', frameCount, 'frames');
          break;
        }

        frameCount++;
        if (frameCount <= 3 || frameCount % 100 === 0) {
          console.log('[pipeCallbackStream]', serial, 'frame', frameCount, 'type:', value.type, 'size:', value.data?.length);
        }

        const packet = {
          type: value.type,
          data: Buffer.from(value.data).toString('base64'),
          ...(value.type === 'data' && {
            keyframe: value.keyframe,
            pts: value.pts?.toString(),
          }),
        };

        onFrame(packet);
      }
    } catch (error) {
      console.error('Error reading callback video stream for', serial, ':', error);
    } finally {
      await this.stopCallbackStream(serial);
    }
  }

  async stopCallbackStream(serial: string): Promise<void> {
    const session = this.callbackSessions.get(serial);
    if (!session || session.stopping) return;

    session.stopping = true;
    this.callbackSessions.delete(serial);

    console.log('Stopping scrcpy callback stream for', serial);

    try {
      if (session.reader) {
        await session.reader.cancel();
      }
      await session.client.close();
    } catch (error) {
      console.error('Error stopping callback stream for', serial, ':', error);
    }
  }

  isCallbackStreaming(serial: string): boolean {
    return this.callbackSessions.has(serial);
  }

  /**
   * Stop all active streams
   */
  async stopAll(): Promise<void> {
    const wsSerials = Array.from(this.sessions.keys());
    const cbSerials = Array.from(this.callbackSessions.keys());
    await Promise.all([
      ...wsSerials.map(serial => this.stopStream(serial)),
      ...cbSerials.map(serial => this.stopCallbackStream(serial)),
    ]);
  }
}

export const scrcpyService = new ScrcpyService();
