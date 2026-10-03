// Demo Kitchen Shop — tiny dependency-free server (node:http).
// Every page is rendered server-side so URLs are real paths.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homePage, categoryPage, productPage, cartPage, checkoutPage, thankYouPage, notFoundPage } from "./src/render.mjs";

const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST; // default: all interfaces (IPv4 + IPv6)
const ASSETS_DIR = fileURLToPath(new URL("./assets/", import.meta.url));

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, type = "text/html; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(res.req.method === "HEAD" ? undefined : body);
}

async function serveAsset(res, rel) {
  const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = join(ASSETS_DIR, safe);
  if (!file.startsWith(ASSETS_DIR)) return send(res, 403, "Forbidden", "text/plain");
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function route(path, query) {
  if (path === "/") return homePage();
  let m;
  if ((m = path.match(/^\/category\/([a-z0-9-]+)$/))) return categoryPage(m[1], query.get("sort") || "");
  if ((m = path.match(/^\/products\/([a-z0-9-]+)$/))) return productPage(m[1]);
  if (path === "/cart") return cartPage();
  if (path === "/checkout") return checkoutPage();
  if (path === "/thank-you") return thankYouPage();
  return null;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let path = decodeURIComponent(url.pathname);

    if (path.startsWith("/assets/")) return await serveAsset(res, path.slice("/assets/".length));
    if (path === "/favicon.ico") return await serveAsset(res, "favicon.svg");

    // No-JS fallback for the checkout form; form data is intentionally ignored.
    if (req.method === "POST" && path === "/thank-you") {
      req.resume();
      res.writeHead(303, { Location: "/thank-you" });
      return res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain", { Allow: "GET, HEAD" });

    if (path.length > 1 && path.endsWith("/")) {
      res.writeHead(301, { Location: path.replace(/\/+$/, "") + url.search });
      return res.end();
    }

    const html = route(path, url.searchParams);
    if (html) return send(res, 200, html);
    return send(res, 404, notFoundPage(path));
  } catch (err) {
    console.error(err);
    send(res, 500, "Internal server error", "text/plain");
  } finally {
    if (process.env.QUIET !== "1") console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Demo Kitchen Shop on http://localhost:${PORT}`);
});
