// logging.ts - Server-side logging utilities

export function logInfo(message: string, ...args: any[]) {
  console.error(`[Server][INFO] ${message}`, ...args);
}

export function logWarn(message: string, ...args: any[]) {
  console.error(`[Server][WARN] ${message}`, ...args);
}

export function logError(message: string, ...args: any[]) {
  console.error(`[Server][ERROR] ${message}`, ...args);
}

