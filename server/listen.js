/* Where the server listens. GR8R_HOST is one address or a comma-separated list: the launchd job passes the
   Tailscale IP, for http on the tailnet, and 127.0.0.1, which `tailscale serve` proxies HTTPS to (Tailscale on
   macOS cannot proxy to its own tailnet address). Never 0.0.0.0, which would also expose it on the local network. */
import http from 'node:http';

export const hostList = value => {
  const hosts = String(value ?? '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);
  return hosts.length ? hosts : ['127.0.0.1'];
};

/* Listens on every host with the one app, so they share its in-memory state. With port 0 the first listener picks
   the port and the rest use the same one. Resolves to the listening servers, the app's first. */
export async function listenAll(server, port, hosts) {
  const handler = server.listeners('request')[0];
  const servers = [];
  for (const [i, host] of hosts.entries()) {
    const s = i === 0 ? server : http.createServer(handler);
    const p = i === 0 ? port : servers[0].address().port;
    await new Promise((resolve, reject) => {
      s.once('error', reject);
      s.listen(p, host, () => {
        s.off('error', reject);
        resolve();
      });
    });
    servers.push(s);
  }
  return servers;
}
