export { StreamServerOptions, StreamDevice, StreamInfo } from './types';
export { StreamServer } from './stream-server';

import { StreamServer } from './stream-server';
import type { StreamServerOptions } from './types';

/**
 * Create and start a stream server.
 *
 * @example
 * const server = await createStreamServer({ port: 3456 });
 * const devices = await server.listDevices();
 * await server.startStream(devices[0].serial);
 */
export async function createStreamServer(
  options: StreamServerOptions = {},
): Promise<StreamServer> {
  return new StreamServer(options);
}
