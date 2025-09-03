// instance.ts - Manage active server instance identity and leadership

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

const LOCK_BASENAME = "dataLayerMCP_active_instance.json";
const LOCK_PATH = path.join(os.tmpdir(), LOCK_BASENAME);

type LockFile = {
  instanceId: string;
  pid: number;
  startedAt: number; // epoch ms
};

const myInstanceId = uuidv4();
const myStartedAt = Date.now();

let amActive = false;
let watcher: fs.FSWatcher | null = null;

function readLockFile(): LockFile | null {
  try {
    const raw = fs.readFileSync(LOCK_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.instanceId === "string") return parsed as LockFile;
  } catch {}
  return null;
}

function writeLockFile(data: LockFile) {
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify(data, null, 2), { encoding: "utf8" });
  } catch {}
}

export function initActiveInstance(): void {
  // Claim leadership by writing our identity
  writeLockFile({ instanceId: myInstanceId, pid: process.pid, startedAt: myStartedAt });
  amActive = true;

  // Watch for lock changes; if replaced by another instance, demote self
  try {
    if (watcher) watcher.close();
    watcher = fs.watch(LOCK_PATH, { persistent: false }, () => {
      const cur = readLockFile();
      if (!cur) return;
      if (cur.instanceId !== myInstanceId) {
        amActive = false;
      }
    });
  } catch {}
}

export function amIActiveInstance(): boolean {
  // Cheap cached check first
  if (!amActive) return false;

  // Verify against disk in case of missed watch events
  const cur = readLockFile();
  return !!cur && cur.instanceId === myInstanceId;
}

export function getInstanceInfo() {
  return { instanceId: myInstanceId, startedAt: myStartedAt, pid: process.pid, lockPath: LOCK_PATH } as const;
}

