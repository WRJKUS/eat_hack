// Bundles the Chrome MV3 extension into extension/dist.
//   node build.mjs           one-off build
//   node build.mjs --watch   rebuild on change
import { build, context } from "esbuild";
import { createHash, createPublicKey } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = process.env.CM_OUT_DIR ?? join(root, "dist"); // CM_OUT_DIR: e2e builds a copy with its own study config
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// ---------- study server + invite baked into the build (see src/lib/study-config.ts) ----------
const studyFile = JSON.parse(readFileSync(join(root, "study.config.json"), "utf8"));
const studyConfig = {
  serverUrl: process.env.CM_SERVER_URL ?? studyFile.serverUrl ?? "http://localhost:8787",
  inviteToken: process.env.CM_INVITE_TOKEN ?? studyFile.inviteToken ?? "",
};

// ---------- deterministic extension id from the committed public key ----------
const publicKeyB64 = readFileSync(join(root, "manifest.key.pub"), "utf8").trim();
const der = Buffer.from(publicKeyB64, "base64");
createPublicKey({ key: der, format: "der", type: "spki" }); // throws if the key is malformed
const extensionId = [...createHash("sha256").update(der).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");
writeFileSync(join(root, "EXTENSION_ID"), extensionId + "\n");

const manifest = {
  manifest_version: 3,
  name: "Cookie Monster – Shopper Study",
  short_name: "Cookie Monster",
  version: pkg.version,
  description:
    "Opt-in eye-tracking usability study. Records gaze and page interactions only on study shops, only while you record.",
  key: publicKeyB64,
  minimum_chrome_version: "116",
  permissions: ["nativeMessaging", "storage", "unlimitedStorage", "tabs", "scripting", "alarms", "idle"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "background.js", type: "module" },
  action: { default_popup: "popup.html", default_title: "Cookie Monster study", default_icon: icons() },
  icons: icons(),
  commands: {
    "toggle-pause": {
      suggested_key: { default: "Alt+Shift+P" },
      description: "Pause / resume the study recording",
    },
  },
};

function icons() {
  return { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
}

const common = {
  bundle: true,
  target: "chrome116",
  sourcemap: "linked",
  logLevel: "info",
  legalComments: "none",
  minify: !watch,
  define: {
    "process.env.NODE_ENV": '"production"',
    __STUDY_CONFIG__: JSON.stringify(studyConfig),
    // Seconds without input before a silent tab stops counting as viewed; 0 disables (automated tests,
    // where the real machine's idle state would make results depend on whether someone touches the keyboard).
    __IDLE_THRESHOLD_S__: JSON.stringify(Number(process.env.CM_IDLE_THRESHOLD_S ?? 120)),
  },
};

const configs = [
  { ...common, entryPoints: { background: "src/background.ts" }, format: "esm", outdir: dist },
  {
    ...common,
    entryPoints: {
      content: "src/content.ts",
      popup: "src/pages/popup.ts",
      calibrate: "src/pages/calibrate.ts",
      review: "src/pages/review.ts",
      welcome: "src/pages/welcome.ts",
    },
    format: "iife",
    outdir: dist,
  },
  {
    ...common,
    entryPoints: {
      popup: "src/pages/popup.css",
      calibrate: "src/pages/calibrate.css",
      review: "src/pages/review.css",
      welcome: "src/pages/welcome.css",
    },
    outdir: dist,
    sourcemap: false,
  },
];

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  for (const page of ["popup.html", "calibrate.html", "review.html", "welcome.html"]) {
    cpSync(join(root, "src/pages", page), join(dist, page));
  }
  mkdirSync(join(dist, "icons"), { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(join(dist, "icons", `icon${size}.png`), iconPng(size));
  writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
}

const staticPlugin = {
  name: "static",
  setup(b) {
    b.onEnd(() => copyStatic());
  },
};

rmSync(dist, { recursive: true, force: true });
copyStatic();

if (watch) {
  const ctxs = await Promise.all(configs.map((c) => context({ ...c, plugins: [staticPlugin] })));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log(`[extension] watching… id=${extensionId}`);
} else {
  await Promise.all(configs.map((c) => build(c)));
  copyStatic();
  console.log(`[extension] built to ${dist} (id ${extensionId})`);
}

// ---------- procedural icon (cookie with an eye), no image deps ----------
function iconPng(size) {
  const ss = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  const chips = [
    [0.36, 0.3, 0.07], [0.68, 0.36, 0.06], [0.3, 0.64, 0.06], [0.62, 0.72, 0.07], [0.74, 0.56, 0.045],
  ];
  const sample = (u, v) => {
    // background: rounded square
    const r = 0.22, ax = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), ay = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (Math.hypot(ax, ay) > r) return [0, 0, 0, 0];
    let c = [36, 40, 74, 255];
    const d = Math.hypot(u - 0.5, v - 0.5);
    if (d < 0.38) {
      c = [222, 166, 92, 255];
      for (const [cx, cy, cr] of chips) if (Math.hypot(u - cx, v - cy) < cr) c = [92, 58, 34, 255];
      // eye in the centre: white almond + dark iris + red pupil highlight
      const ex = (u - 0.5) / 0.2, ey = (v - 0.52) / 0.11;
      if (ex * ex + ey * ey < 1) {
        c = [250, 250, 252, 255];
        const id = Math.hypot(u - 0.5, v - 0.52);
        if (id < 0.085) c = [40, 60, 140, 255];
        if (id < 0.04) c = [12, 14, 28, 255];
      }
    }
    return c;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
        }
      const o = (y * size + x) * 4, a = acc[3];
      px[o] = a ? acc[0] / a : 0; px[o + 1] = a ? acc[1] / a : 0; px[o + 2] = a ? acc[2] / a : 0; px[o + 3] = a / (ss * ss);
    }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
