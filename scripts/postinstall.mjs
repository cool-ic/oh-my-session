#!/usr/bin/env node
/**
 * After `npm install` / `npm install -g`: remind users the CLI is `oms`.
 * Printed on stderr so it does not break scripted stdout capture.
 */
const msg = `
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   oh-my-session  installed successfully              ║
║                                                      ║
║   ▶  Command:   oms                                  ║
║                                                      ║
║   Try:                                               ║
║     oms              open the TUI                    ║
║     oms --help       flags & keys                    ║
║     oms --list       plain table                     ║
║                                                      ║
║   Settings live in:  ~/.config/oms/                  ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`;
console.error(msg);
