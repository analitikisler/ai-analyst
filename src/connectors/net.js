// Outbound calls of the connectors. Every one goes through the AI_ANALYST_NO_CLOUD guard, to a host fixed per
// connector, over HTTPS on port 443, never to an IP literal or a private, loopback, link-local or otherwise special
// address, and redirects are refused (a redirect to another host would be a different host).
// The name is resolved once, every address is checked, and the request connects to that checked address (pinned
// through the request's lookup), with SNI, the certificate check and the Host header still on the name: a DNS answer
// that changes between the check and the connection (rebinding) cannot reach the local network.
// Tests pass app.connectorFetch (a stub with the fetch signature, the host checks still run on it), or
// app.connectorResolve and app.connectorTransport to drive the real path with a stubbed resolver and socket.
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { assertCloudAllowed } from "../cloud.js";
import { AppError } from "../errors.js";

// ---------------------------------------------------------------- addresses

const V4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
]) V4.addSubnet(net, bits, "ipv4");

const V6 = new BlockList();
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo (an IPv4 address in disguise)
  ["2001:db8::", 32], // documentation
  ["2001:10::", 28], // ORCHID
  ["64:ff9b:1::", 48], // local-use NAT64
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
]) V6.addSubnet(net, bits, "ipv6");

/** An IPv6 address as eight 16-bit numbers (with an embedded dotted IPv4 tail); null when it is not one. */
function hextets(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (isIP(tail[1]) !== 4) return null;
    const [a, b, c, d] = tail[1].split(".").map(Number);
    s = s.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (x) => (x ? x.split(":") : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const all = [...head, ...Array(Math.max(0, fill)).fill("0"), ...rest];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}
const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * The IPv4 address an IPv6 address carries, when it carries one: IPv4-mapped (::ffff:a.b.c.d, also written in hex),
 * IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::). Else null.
 */
export function embeddedV4(ip) {
  const h = hextets(ip);
  if (!h) return null;
  const zero = (from, to) => h.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && h[5] === 0xffff) return v4of(h[6], h[7]);
  if (zero(0, 6)) return v4of(h[6], h[7]);
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6)) return v4of(h[6], h[7]);
  if (h[0] === 0x2002) return v4of(h[1], h[2]);
  return null;
}

/** Whether an address must never be reached: private, loopback, link-local, special-purpose, or one in disguise. */
export const isPrivateAddress = (ip) => {
  const a = String(ip).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const kind = isIP(a);
  if (kind === 4) return V4.check(a, "ipv4");
  if (kind !== 6) return true;
  const v4 = embeddedV4(a);
  if (v4) return V4.check(v4, "ipv4");
  return V6.check(a, "ipv6");
};

// ---------------------------------------------------------------- URLs

const notAllowed = (detail) => new AppError("host_not_allowed", "That address cannot be reached from here: only the shop's own domain over HTTPS on the standard port (no IP addresses, no private networks, no redirects).", { params: { detail } });

/** Checks a URL before a connector calls it. hosts: exact names, or a function that says yes to a host. */
export function checkUrl(url, hosts) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw notAllowed("not a web address");
  }
  if (u.protocol !== "https:") throw notAllowed("https only");
  if (u.username || u.password) throw notAllowed("no user name or password in the address");
  // https://host:443 normalises to no port; any other port is refused.
  if (u.port !== "") throw notAllowed("port 443 only");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, "")) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw notAllowed(host);
  const ok = typeof hosts === "function" ? hosts(host) : hosts.includes(host);
  if (!ok) throw notAllowed(host);
  return u;
}

// ---------------------------------------------------------------- the request

const MAX_BODY = 32 * 1024 * 1024;

/**
 * One HTTPS request to a checked address: TCP goes to `address`, while SNI, the certificate check and the Host
 * header use the URL's name. No redirect is followed. The whole request (connect, handshake, headers and body) has
 * one deadline, timeoutMs, which a slow server dripping bytes does not reset; init.signal aborts it. Resolves to a
 * fetch Response.
 */
export function pinnedRequest(u, init, { address, family }, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    let settled = false;
    let timer = null;
    let req = null;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      req?.destroy();
      reject(err);
    };
    const done = (v) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(v);
    };
    const onAbort = () => fail(Object.assign(new Error("The request was stopped."), { name: "AbortError", code: "aborted" }));
    if (signal?.aborted) return onAbort();
    const headers = { ...(init.headers ?? {}), Host: u.host };
    req = httpsRequest(
      {
        host: u.hostname,
        port: u.port || 443,
        servername: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: init.method ?? "GET",
        headers,
        agent: false,
        // The checked address, whatever the name resolves to now.
        lookup: (_name, opts, cb) => (opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) fail(new AppError("shop_unreachable", `${u.hostname} sent more than 32 MB in one answer.`, { params: { host: u.hostname } }));
          else chunks.push(c);
        });
        res.on("end", () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
          const status = res.statusCode ?? 502;
          const body = [101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
          done(new Response(body, { status: status < 200 ? 502 : status, headers: h }));
        });
        res.on("error", fail);
      },
    );
    timer = setTimeout(() => fail(Object.assign(new Error(`No complete answer within ${Math.round(timeoutMs / 1000)} s.`), { code: "timeout" })), timeoutMs);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    req.on("error", fail);
    if (init.body != null) req.write(init.body);
    req.end();
  });
}

/**
 * A guarded fetch for one connector.
 * @param {object} app the workspace (app.connectorFetch, app.connectorResolve, app.connectorTransport: test stubs)
 * @param {{ service: string, hosts: string[] | ((host: string) => boolean), timeoutMs?: number }} o
 */
export function connectorFetch(app, { service, hosts, timeoutMs = 30_000 }) {
  return async (url, init = {}) => {
    const stub = app?.connectorFetch;
    // As for every real client (src/cloud.js): the guard sits on the real path, so a test's stub still runs, and
    // with AI_ANALYST_NO_CLOUD set nothing real is resolved or sent. The host checks run on both.
    if (!stub && !app?.connectorTransport) assertCloudAllowed(service);
    const u = checkUrl(url, hosts);
    const unreachable = () => new AppError("shop_unreachable", `${service} could not be reached at ${u.hostname}.`, { params: { host: u.hostname } });
    let res;
    if (stub) {
      res = await stub(u.toString(), { ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(timeoutMs) }).catch((err) => {
        if (err?.code === "no_cloud" || err?.code === "host_not_allowed") throw err;
        throw unreachable();
      });
    } else {
      // Resolve once; every address must be public; connect to the first, pinned.
      const resolve = app?.connectorResolve ?? ((name) => lookup(name, { all: true, verbatim: true }));
      const addrs = await Promise.resolve(resolve(u.hostname)).catch(() => []);
      if (!addrs?.length) throw new AppError("shop_unreachable", `${u.hostname} could not be found. Check the address.`, { params: { host: u.hostname } });
      if (addrs.some((a) => isPrivateAddress(a.address))) throw notAllowed(`${u.hostname} points to a private address`);
      const pick = { address: addrs[0].address, family: addrs[0].family ?? isIP(addrs[0].address) };
      const transport = app?.connectorTransport ?? ((uu, ii, a) => pinnedRequest(uu, ii, a, { timeoutMs }));
      res = await transport(u, init, pick).catch((err) => {
        if (["no_cloud", "host_not_allowed", "shop_unreachable", "aborted"].includes(err?.code)) throw err;
        throw unreachable();
      });
    }
    if (res.status >= 300 && res.status < 400) throw notAllowed("a redirect");
    return res;
  };
}

/** Reads a JSON body, or null when it is not JSON. */
export const jsonOf = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};
