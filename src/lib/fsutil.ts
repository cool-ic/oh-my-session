import fs from "node:fs";
import path from "node:path";

export function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readJsonFile<T>(p: string): T | null {
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function safeMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** Walk one level of subdirs (non-recursive helpers). */
export function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

export function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Count non-empty lines in a file without loading whole file into memory. */
export function countLines(filePath: string): number {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      let count = 0;
      let leftover = false;
      let bytes = 0;
      while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        for (let i = 0; i < bytes; i++) {
          if (buf[i] === 0x0a) {
            count++;
            leftover = false;
          } else {
            leftover = true;
          }
        }
      }
      if (leftover) count++;
      return count;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 0;
  }
}

/**
 * Count jsonl records whose `type` is in `types`.
 * Streams line-by-line; skips malformed lines.
 */
export function countJsonlTypes(
  filePath: string,
  types: Set<string>,
): number {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    let n = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { type?: string };
        if (obj.type && types.has(obj.type)) n++;
      } catch {
        /* skip */
      }
    }
    return n;
  } catch {
    return 0;
  }
}
