import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { handleRequest } from './http.js';
import { startWorkspaceWatch } from './watch.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WORKFISH_PORT ?? 8787);

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

const bootConfig = loadConfig();
if (bootConfig) {
  startWorkspaceWatch(bootConfig.workspacePath);
}

server.listen(PORT, HOST, () => {
  console.log(`workfish server listening on http://${HOST}:${PORT}`);
});

export { HOST, PORT, server };
