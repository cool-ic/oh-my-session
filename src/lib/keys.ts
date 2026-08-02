/**
 * Raw TTY key reader with a **short** Esc timeout (vim-like).
 *
 * Node's `readline.emitKeypressEvents` waits ~500ms after bare `\x1b`
 * to decide whether it is Esc or the start of a CSI sequence (arrows).
 * That makes Esc in TUIs feel laggy. We use ~25ms instead (still enough
 * to coalesce `\x1b[A` etc. when bytes arrive together or in a burst).
 */
import type { Readable } from "node:stream";

export interface AppKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export type KeyHandler = (str: string, key: AppKey) => void;

/** Esc disambiguation window (ms). vim ttimeoutlen-style. */
const ESC_MS = 25;

type RawStdin = Readable & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
};

/**
 * Attach a key handler. Returns detach function.
 * Caller should setRawMode(true) / resume before or we do it here.
 */
export function attachKeys(
  stdin: RawStdin,
  onKey: KeyHandler,
): () => void {
  let escTimer: ReturnType<typeof setTimeout> | null = null;
  let buf = "";

  function clearEscTimer(): void {
    if (escTimer) {
      clearTimeout(escTimer);
      escTimer = null;
    }
  }

  function emit(str: string, key: AppKey): void {
    try {
      onKey(str, key);
    } catch (e) {
      // never break the input loop
      console.error(e);
    }
  }

  function emitEsc(): void {
    escTimer = null;
    emit("\x1b", {
      name: "escape",
      sequence: "\x1b",
      ctrl: false,
      meta: false,
      shift: false,
    });
  }

  /** Try to consume one complete key from buf; return true if consumed. */
  function consumeOne(): boolean {
    if (!buf) return false;

    // --- Escape / CSI / Alt ---
    if (buf[0] === "\x1b") {
      // Alone — wait briefly for rest of sequence
      if (buf.length === 1) {
        clearEscTimer();
        escTimer = setTimeout(emitEsc, ESC_MS);
        buf = "";
        return false;
      }

      // CSI: ESC [ ... finalByte
      if (buf[1] === "[") {
        // Need at least ESC [ X
        if (buf.length < 3) return false;
        // Find final byte (0x40-0x7E)
        let i = 2;
        while (i < buf.length) {
          const c = buf.charCodeAt(i);
          if (c >= 0x40 && c <= 0x7e) {
            const seq = buf.slice(0, i + 1);
            buf = buf.slice(i + 1);
            emitCsi(seq);
            return true;
          }
          i++;
        }
        // Incomplete CSI — wait for more (don't fire bare Esc)
        return false;
      }

      // ESC O P/Q/R/S (SS3 function keys) — consume 3 bytes
      if (buf[1] === "O" && buf.length >= 3) {
        const seq = buf.slice(0, 3);
        buf = buf.slice(3);
        // map common
        const map: Record<string, string> = {
          OP: "f1",
          OQ: "f2",
          OR: "f3",
          OS: "f4",
          OH: "home",
          OF: "end",
        };
        const name = map[seq.slice(1)];
        if (name) {
          emit(seq, { name, sequence: seq, ctrl: false, meta: false, shift: false });
        }
        return true;
      }

      // Alt+key: ESC + char
      if (buf.length >= 2) {
        const ch = buf[1]!;
        buf = buf.slice(2);
        emit(ch, {
          name: ch.length === 1 ? ch : undefined,
          sequence: "\x1b" + ch,
          ctrl: false,
          meta: true,
          shift: false,
        });
        return true;
      }
      return false;
    }

    // --- Control / specials ---
    const ch = buf[0]!;
    const code = ch.charCodeAt(0);

    // Enter
    if (ch === "\r" || ch === "\n") {
      buf = buf.slice(1);
      // swallow CRLF pair
      if (ch === "\r" && buf[0] === "\n") buf = buf.slice(1);
      emit("\r", {
        name: "return",
        sequence: "\r",
        ctrl: false,
        meta: false,
        shift: false,
      });
      return true;
    }

    // Tab
    if (ch === "\t") {
      buf = buf.slice(1);
      emit("\t", {
        name: "tab",
        sequence: "\t",
        ctrl: false,
        meta: false,
        shift: false,
      });
      return true;
    }

    // Backspace
    if (ch === "\x7f" || ch === "\b") {
      buf = buf.slice(1);
      emit(ch, {
        name: "backspace",
        sequence: ch,
        ctrl: false,
        meta: false,
        shift: false,
      });
      return true;
    }

    // Ctrl+letter (1..26) except already handled tab/enter
    if (code >= 1 && code <= 26) {
      buf = buf.slice(1);
      const letter = String.fromCharCode(code + 96); // a-z
      emit(ch, {
        name: letter,
        sequence: ch,
        ctrl: true,
        meta: false,
        shift: false,
      });
      return true;
    }

    // Printable ASCII / UTF-8 start — take one Unicode codepoint
    // (Buffer was decoded as utf8 string already)
    const cp = buf.codePointAt(0)!;
    const s = String.fromCodePoint(cp);
    buf = buf.slice(s.length);
    if (s >= " ") {
      emit(s, {
        name: s.length === 1 && /[a-zA-Z0-9]/.test(s) ? s : undefined,
        sequence: s,
        ctrl: false,
        meta: false,
        shift: false,
      });
      return true;
    }

    // Unknown control — drop
    buf = buf.slice(1);
    return true;
  }

  function emitCsi(seq: string): void {
    // seq like \x1b[A or \x1b[1;5A or \x1b[5~
    const body = seq.slice(2); // after ESC [
    let name: string | undefined;
    let ctrl = false;
    let shift = false;
    let meta = false;

    // modifier form: 1;2A or 1;5A
    const modM = /^(\d*);(\d*)([A-Za-z~])$/.exec(body);
    const simpleM = /^(\d*~|[A-Za-z])$/.exec(body);

    let final = "";
    let nums: number[] = [];
    if (modM) {
      nums = [modM[1], modM[2]].filter(Boolean).map((x) => parseInt(x!, 10));
      final = modM[3]!;
      const mod = nums[1] ?? nums[0] ?? 1;
      // xterm modifiers: 2 shift, 3 meta, 4 shift+meta, 5 ctrl, ...
      shift = !!(mod && (mod - 1) & 1);
      meta = !!(mod && (mod - 1) & 2);
      ctrl = !!(mod && (mod - 1) & 4);
    } else if (simpleM) {
      final = simpleM[1]!;
      if (final.endsWith("~")) {
        nums = [parseInt(final, 10)];
        final = "~";
      }
    } else {
      final = body.slice(-1);
    }

    const letter = final.length === 1 ? final : final;
    switch (letter) {
      case "A":
        name = "up";
        break;
      case "B":
        name = "down";
        break;
      case "C":
        name = "right";
        break;
      case "D":
        name = "left";
        break;
      case "H":
        name = "home";
        break;
      case "F":
        name = "end";
        break;
      case "Z":
        name = "tab";
        shift = true;
        break;
      case "~": {
        const n = nums[0] ?? parseInt(body, 10);
        if (n === 3) name = "delete";
        else if (n === 5) name = "pageup";
        else if (n === 6) name = "pagedown";
        else if (n === 1 || n === 7) name = "home";
        else if (n === 4 || n === 8) name = "end";
        break;
      }
      default:
        break;
    }

    emit(seq, {
      name,
      sequence: seq,
      ctrl,
      meta,
      shift,
    });
  }

  function onData(chunk: Buffer | string): void {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    // If a lone-Esc timer is armed, this data is the rest of the sequence
    if (escTimer) {
      clearEscTimer();
      buf = "\x1b" + s;
    } else {
      buf += s;
    }
    // Drain all complete keys
    while (consumeOne()) {
      /* continue */
    }
  }

  stdin.on("data", onData);

  return () => {
    clearEscTimer();
    stdin.off("data", onData);
  };
}
