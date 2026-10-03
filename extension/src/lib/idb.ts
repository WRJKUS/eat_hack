/*
 * Tiny IndexedDB wrapper for recorded sessions (no deps). Shared by the background service worker and the
 * review page (same extension origin => same database).
 *
 * stores:
 *   sessions  keyPath "id"                SessionMeta
 *   pages     keyPath "id",  idx sessionId { sessionId, ...PageVisit }
 *   aois      keyPath "key", idx sessionId { key: pageId|aoiId, sessionId, aoi }
 *   items     autoIncrement, idx sessionId { sessionId, kind: gaze|fixation|event|rrweb, data }
 */
import type { Aoi, Fixation, GazeSample, PageVisit, SessionEvent } from "@cm/shared";
import type { RecordBatch, SessionMeta } from "./messages";

const DB_NAME = "cookie-monster";
const DB_VERSION = 1;

type ItemKind = "gaze" | "fixation" | "event" | "rrweb";
interface ItemRow {
  sessionId: string;
  kind: ItemKind;
  data: unknown;
}

export interface RrwebPart {
  pageId: string;
  events: unknown[];
}

export interface StoredSession {
  meta: SessionMeta;
  pages: PageVisit[];
  aois: Aoi[];
  gaze: GazeSample[];
  fixations: Fixation[];
  events: SessionEvent[];
  rrweb: RrwebPart[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("sessions", { keyPath: "id" });
      db.createObjectStore("pages", { keyPath: "id" }).createIndex("sessionId", "sessionId");
      db.createObjectStore("aois", { keyPath: "key" }).createIndex("sessionId", "sessionId");
      db.createObjectStore("items", { autoIncrement: true }).createIndex("sessionId", "sessionId");
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function putSessionMeta(meta: SessionMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(meta);
  await txDone(tx);
}

export async function getSessionMeta(id: string): Promise<SessionMeta | undefined> {
  const db = await openDb();
  return reqP(db.transaction("sessions").objectStore("sessions").get(id) as IDBRequest<SessionMeta | undefined>);
}

export async function listSessionMetas(): Promise<SessionMeta[]> {
  const db = await openDb();
  const all = await reqP(db.transaction("sessions").objectStore("sessions").getAll() as IDBRequest<SessionMeta[]>);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** Append one content-script batch atomically. */
export async function appendBatch(batch: RecordBatch): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["pages", "aois", "items"], "readwrite");
  const sid = batch.sessionId;
  if (batch.page) tx.objectStore("pages").put({ ...batch.page, sessionId: sid });
  const aois = tx.objectStore("aois");
  for (const a of batch.aois) aois.put({ key: `${a.pageId}|${a.id}`, sessionId: sid, aoi: a });
  const items = tx.objectStore("items");
  const add = (kind: ItemKind, data: unknown) => items.add({ sessionId: sid, kind, data } satisfies ItemRow);
  // gaze is high-rate: store each batch as one row
  if (batch.gaze.length) add("gaze", batch.gaze);
  for (const f of batch.fixations) add("fixation", f);
  for (const e of batch.events) add("event", e);
  if (batch.rrweb.length && batch.page) add("rrweb", { pageId: batch.page.id, events: batch.rrweb } satisfies RrwebPart);
  await txDone(tx);
}

export async function loadSession(id: string): Promise<StoredSession | null> {
  const db = await openDb();
  const tx = db.transaction(["sessions", "pages", "aois", "items"]);
  const meta = (await reqP(tx.objectStore("sessions").get(id))) as SessionMeta | undefined;
  if (!meta) return null;
  const pagesRaw = (await reqP(tx.objectStore("pages").index("sessionId").getAll(id))) as (PageVisit & { sessionId?: string })[];
  const aoiRows = (await reqP(tx.objectStore("aois").index("sessionId").getAll(id))) as { aoi: Aoi }[];
  const rows = (await reqP(tx.objectStore("items").index("sessionId").getAll(id))) as ItemRow[];
  const out: StoredSession = {
    meta,
    pages: pagesRaw
      .map(({ sessionId: _sid, ...p }) => p as PageVisit)
      .sort((a, b) => a.startedAt - b.startedAt),
    aois: aoiRows.map((r) => r.aoi),
    gaze: [],
    fixations: [],
    events: [],
    rrweb: [],
  };
  for (const r of rows) {
    if (r.kind === "gaze") out.gaze.push(...(r.data as GazeSample[]));
    else if (r.kind === "fixation") out.fixations.push(r.data as Fixation);
    else if (r.kind === "event") out.events.push(r.data as SessionEvent);
    else if (r.kind === "rrweb") out.rrweb.push(r.data as RrwebPart);
  }
  out.gaze.sort((a, b) => a.t - b.t);
  out.fixations.sort((a, b) => a.start - b.start);
  out.events.sort((a, b) => a.t - b.t);
  return out;
}

export async function deleteSessionData(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["sessions", "pages", "aois", "items"], "readwrite");
  tx.objectStore("sessions").delete(id);
  for (const store of ["pages", "aois", "items"] as const) {
    const idx = tx.objectStore(store).index("sessionId");
    const keys = await reqP(idx.getAllKeys(id));
    for (const k of keys) tx.objectStore(store).delete(k);
  }
  await txDone(tx);
}

export async function deleteAllSessions(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["sessions", "pages", "aois", "items"], "readwrite");
  for (const s of ["sessions", "pages", "aois", "items"] as const) tx.objectStore(s).clear();
  await txDone(tx);
}
