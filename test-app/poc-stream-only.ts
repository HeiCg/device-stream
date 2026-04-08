/**
 * POC: Test @device-stream/stream-only with a connected Android device.
 *
 * Usage:
 *   npx tsx test-app/poc-stream-only.ts
 *
 * Then open http://localhost:3456 in your browser.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createStreamServer } from '@device-stream/stream-only';

const PORT = 3456;
const VIEWER_PORT = 3457;

async function main() {
  console.log('Starting stream-only server...\n');

  const server = await createStreamServer({ port: PORT });

  // List devices
  const devices = await server.listDevices();
  console.log(`Found ${devices.length} device(s):`);
  for (const d of devices) {
    console.log(`  - ${d.serial} (${d.platform}) — ${d.name} [${d.screenWidth}x${d.screenHeight}]`);
  }

  if (devices.length === 0) {
    console.error('\nNo devices found. Is ADB running? Is a simulator booted?');
    await server.close();
    process.exit(1);
  }

  // Start streaming the first device
  const target = devices[0];
  console.log(`\nStarting stream for ${target.serial}...`);

  try {
    const info = await server.startStream(target.serial);
    console.log(`Stream started: ${info.codec} ${info.width}x${info.height}`);
  } catch (err) {
    console.error('Failed to start stream:', err);
    await server.close();
    process.exit(1);
  }

  // Serve the viewer HTML on a separate port
  const viewerHtml = fs.readFileSync(
    path.join(__dirname, 'poc-viewer.html'),
    'utf-8'
  ).replace(
    // Inject the stream server URL so the viewer knows where to connect
    'fetch(\'/devices\')',
    `fetch('http://localhost:${PORT}/devices')`
  ).replace(
    "wsProtocol + '//' + location.host + '/stream/' + device.serial",
    `'ws://localhost:${PORT}/stream/' + device.serial`
  );

  const viewerServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(viewerHtml);
  });

  viewerServer.listen(VIEWER_PORT, () => {
    console.log(`\n=== Open http://localhost:${VIEWER_PORT} in your browser ===\n`);
    console.log('Press Ctrl+C to stop.\n');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    viewerServer.close();
    await server.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
