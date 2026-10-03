/**
 * Match patterns for the allowlisted shop hosts. Chrome rejects ports in registerContentScripts patterns,
 * so "localhost:5174" becomes "*://localhost/*"; the exact host:port allowlist is enforced by the
 * background (contentStateFor / SessionManager.ingest) and again inside content.ts, so a script injected on
 * another port of the same host stays completely inert.
 */
export function matchPatterns(domains: string[]): string[] {
  const out = new Set<string>();
  for (const raw of domains) {
    const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const host = d.replace(/:\d+$/, "");
    if (!host) continue;
    out.add(`*://${host}/*`);
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes("[");
    if (!isIp && host !== "localhost") out.add(`*://*.${host}/*`);
  }
  return [...out];
}
