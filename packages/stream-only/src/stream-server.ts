import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AndroidStreamer } from './android-streamer';
import { SimulatorStreamer } from './simulator-streamer';
import type { StreamServerOptions, StreamDevice, StreamInfo } from './types';

export class StreamServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private androidStreamer: AndroidStreamer;
  private simulatorStreamer: SimulatorStreamer;
  private streams = new Map<string, StreamInfo>();

  constructor(options: StreamServerOptions = {}) {
    const port = options.port ?? 3456;
    const host = options.host ?? '0.0.0.0';

    this.androidStreamer = new AndroidStreamer();
    this.simulatorStreamer = new SimulatorStreamer();

    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });

    this.httpServer.listen(port, host, () => {
      console.log(`[StreamServer] Listening on ${host}:${port}`);
    });
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/devices') {
      this.listDevices()
        .then(devices => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(devices));
        })
        .catch(error => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleUpgrade(
    request: http.IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer,
  ): void {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/stream\/(.+)$/);

    if (!match) {
      socket.destroy();
      return;
    }

    const serial = decodeURIComponent(match[1]);

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleWebSocketConnection(ws, serial);
    });
  }

  private handleWebSocketConnection(ws: WebSocket, serial: string): void {
    const streamInfo = this.streams.get(serial);

    if (!streamInfo) {
      // Stream not started yet — hold the connection.
      // Register with both streamers; the active one will broadcast frames.
      this.androidStreamer.handleWebSocket(ws, serial);
      this.simulatorStreamer.handleWebSocket(ws, serial);
      return;
    }

    if (streamInfo.platform === 'android') {
      this.androidStreamer.handleWebSocket(ws, serial);
    } else {
      this.simulatorStreamer.handleWebSocket(ws, serial);
    }
  }

  async listDevices(): Promise<StreamDevice[]> {
    const [android, simulator] = await Promise.all([
      this.androidStreamer.listDevices(),
      this.simulatorStreamer.listDevices(),
    ]);
    return [...android, ...simulator];
  }

  async startStream(serial: string): Promise<StreamInfo> {
    // Check if already streaming
    const existing = this.streams.get(serial);
    if (existing) return existing;

    // Determine platform by trying both
    const [androidDevices, simulatorDevices] = await Promise.all([
      this.androidStreamer.listDevices(),
      this.simulatorStreamer.listDevices(),
    ]);

    const isAndroid = androidDevices.some(d => d.serial === serial);
    const isSimulator = simulatorDevices.some(d => d.serial === serial);

    if (!isAndroid && !isSimulator) {
      throw new Error(`Device ${serial} not found`);
    }

    let info: StreamInfo;
    if (isAndroid) {
      info = await this.androidStreamer.startStream(serial);
    } else {
      info = await this.simulatorStreamer.startStream(serial);
    }

    this.streams.set(serial, info);
    console.log(`[StreamServer] Stream started: ${serial} (${info.platform}, ${info.codec})`);
    return info;
  }

  async stopStream(serial: string): Promise<void> {
    const info = this.streams.get(serial);
    if (!info) return;

    this.streams.delete(serial);

    if (info.platform === 'android') {
      await this.androidStreamer.stopStream(serial);
    } else {
      await this.simulatorStreamer.stopStream(serial);
    }

    console.log(`[StreamServer] Stream stopped: ${serial}`);
  }

  activeStreams(): StreamInfo[] {
    return Array.from(this.streams.values());
  }

  async close(): Promise<void> {
    console.log('[StreamServer] Shutting down...');

    // Stop all streams
    const serials = Array.from(this.streams.keys());
    await Promise.all(serials.map(serial => this.stopStream(serial)));

    // Cleanup streamers
    await Promise.all([
      this.androidStreamer.cleanup(),
      this.simulatorStreamer.cleanup(),
    ]);

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });

    console.log('[StreamServer] Shutdown complete');
  }
}
