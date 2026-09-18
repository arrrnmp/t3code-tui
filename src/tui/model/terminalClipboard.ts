import { isSshSession } from "./clipboard.js";
import { MAX_IMAGE_BYTES, readClipboardImage } from "./attachments.js";

/**
 * Image paste via Kitty's OSC 5522 clipboard protocol
 * (https://sw.kovidgoyal.net/kitty/clipboard/).
 *
 * OSC 52 only carries plain text *out* to the terminal, so it can never
 * deliver a screenshot *in*. OSC 5522 extends it to arbitrary MIME types:
 * the app sends `ESC ] 5522 ; type=read : … ; <base64 mime list> ST` over
 * the pty and the terminal replies with `status=OK / DATA / DONE` packets.
 * Because the bytes travel over the same pty the TUI already uses, this
 * works over SSH — where the host OS clipboard belongs to the wrong
 * machine — with no extra tooling on either end.
 *
 * Requirements on the terminal side (kitty-only protocol; every other
 * terminal ignores the query and the attempt times out fast):
 * `clipboard_control` must include `read-clipboard` (kitty defaults to
 * write-only and answers denied reads with silence), `clipboard_max_size`
 * must fit the screenshot (`0` disables the cap), kitty must be restarted
 * after changing them, and under tmux `allow-passthrough` must be on.
 */

export const TERMINAL_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const ESC = "\x1b";
const ST = "\x1b\\";
const BEL = "\x07";
/** The list query is prompt-free per spec, so it gets a short fuse. */
const LIST_TIMEOUT_MS = 1500;
/** The data read may wait on the user approving kitty's prompt. */
const READ_TIMEOUT_MS = 30_000;

function b64encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function b64decodeBytes(value: string): Uint8Array {
  return Buffer.from(value, "base64");
}

/** Multiplexer-safe request id (`[a-zA-Z0-9-_+.]` — echoed back verbatim). */
export function newOsc5522Id(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export interface Osc5522QueryOptions {
  id: string;
  /** Random per-process secret so kitty can offer "always allow". */
  password: string;
  humanName: string;
}

/**
 * `ESC ] 5522 ; type=read:id=…:pw=…:name=… ; <base64 mime list> ST`.
 * Pass `"."` as the mime list to list available types (prompt-free).
 */
export function buildOsc5522ReadQuery(mimeList: string, options: Osc5522QueryOptions): string {
  const meta = `type=read:id=${options.id}:pw=${b64encode(options.password)}:name=${b64encode(options.humanName)}`;
  return `${ESC}]5522;${meta};${b64encode(mimeList)}${ST}`;
}

export type Osc5522Reply =
  | { kind: "ok"; id: string | null }
  | { kind: "data"; id: string | null; mimeType: string; bytes: Uint8Array }
  | { kind: "done"; id: string | null }
  | { kind: "error"; id: string | null; code: string };

/** Parses one terminal reply packet; null when it isn't a 5522 read reply. */
export function parseOsc5522Reply(sequence: string): Osc5522Reply | null {
  let body = sequence;
  if (!body.startsWith(`${ESC}]`)) return null;
  body = body.slice(2);
  if (body.endsWith(ST)) body = body.slice(0, -ST.length);
  else if (body.endsWith(BEL)) body = body.slice(0, -BEL.length);
  else return null;
  const first = body.indexOf(";");
  if (first === -1 || body.slice(0, first) !== "5522") return null;
  const rest = body.slice(first + 1);
  const second = rest.indexOf(";");
  const meta = second === -1 ? rest : rest.slice(0, second);
  const payload = second === -1 ? "" : rest.slice(second + 1);
  const fields = new Map<string, string>();
  for (const part of meta.split(":")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (fields.get("type") !== "read") return null;
  const id = fields.get("id") ?? null;
  const status = fields.get("status") ?? null;
  if (status === "OK") return { kind: "ok", id };
  if (status === "DONE") return { kind: "done", id };
  if (status === "DATA") {
    const mimeRaw = fields.get("mime");
    if (mimeRaw === undefined) return null;
    const mimeType = Buffer.from(mimeRaw, "base64").toString("utf8");
    if (!/^[ -~]{1,128}$/.test(mimeType)) return null;
    return { kind: "data", id, mimeType, bytes: b64decodeBytes(payload) };
  }
  if (status !== null) return { kind: "error", id, code: status };
  return null;
}

/** DCS passthrough envelope so the query survives tmux (needs `allow-passthrough`). */
export function wrapOscForTmux(osc: string): string {
  return `${ESC}Ptmux;${osc.replaceAll(ESC, `${ESC}${ESC}`)}${ST}`;
}

export function isTmuxSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.TMUX === "string" && env.TMUX.length > 0;
}

export interface TerminalClipboardDeps {
  write: (data: string) => void;
  subscribe: (handler: (sequence: string) => void) => () => void;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
  env?: NodeJS.ProcessEnv;
}

export type TerminalClipboardOutcome =
  | { status: "read"; mimeType: string; bytes: Uint8Array }
  /** The terminal answered but the clipboard holds no image. */
  | { status: "no-image" }
  /** Explicit refusal (`EPERM`) or other error packet. */
  | { status: "denied"; code: string }
  /** Silence: the terminal doesn't speak 5522 (or a multiplexer ate it). */
  | { status: "unsupported" }
  /** The user never approved the prompt, or the transfer stalled. */
  | { status: "timed-out" }
  | { status: "limit-exceeded" };

interface PendingRead {
  id: string;
  mimes: Map<string, Uint8Array[]>;
  gotOk: boolean;
  done: boolean;
  totalBytes: number;
}

/**
 * One 5522 request round-trip: send `query`, collect replies matching `id`
 * until DONE/ERROR or the deadline. Resolves the assembled per-mime chunks.
 */
function roundTrip(
  deps: TerminalClipboardDeps,
  query: string,
  id: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ mimes: Map<string, Uint8Array[]>; error: string | null; responded: boolean }> {
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  return new Promise((resolve) => {
    const pending: PendingRead = { id, mimes: new Map(), gotOk: false, done: false, totalBytes: 0 };
    let settled = false;
    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(timer);
      unsubscribe();
      resolve({ mimes: pending.mimes, error, responded: pending.gotOk || pending.mimes.size > 0 || pending.done });
    };
    const timer = setTimeoutFn(() => finish(pending.gotOk ? "timed-out" : "unsupported"), timeoutMs);
    const unsubscribe = deps.subscribe((sequence) => {
      const reply = parseOsc5522Reply(sequence);
      if (reply === null || (reply.id !== null && reply.id !== id)) return;
      if (reply.kind === "ok") {
        pending.gotOk = true;
        return;
      }
      if (reply.kind === "done") {
        pending.done = true;
        finish(null);
        return;
      }
      if (reply.kind === "error") {
        finish(reply.code);
        return;
      }
      const chunks = pending.mimes.get(reply.mimeType) ?? [];
      chunks.push(reply.bytes);
      pending.mimes.set(reply.mimeType, chunks);
      pending.totalBytes += reply.bytes.length;
      if (pending.totalBytes > maxBytes) finish("limit-exceeded");
    });
    deps.write(query);
  });
}

/**
 * Reads the first available image off the *terminal's* clipboard over 5522:
 * a prompt-free type list first (fast fallback for non-kitty terminals),
 * then the full transfer for image types only.
 */
export async function queryTerminalClipboardImages(
  deps: TerminalClipboardDeps,
  options?: { listTimeoutMs?: number; readTimeoutMs?: number; maxBytes?: number },
): Promise<TerminalClipboardOutcome> {
  const maxBytes = options?.maxBytes ?? Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;
  const password = crypto.randomUUID();
  const queryOptions = { password, humanName: "t3code" };
  const send = (query: string) => {
    deps.write(isTmuxSession(deps.env) ? wrapOscForTmux(query) : query);
  };

  const listId = newOsc5522Id();
  const list = await roundTrip(
    { ...deps, write: send },
    buildOsc5522ReadQuery(".", { ...queryOptions, id: listId }),
    listId,
    options?.listTimeoutMs ?? LIST_TIMEOUT_MS,
    maxBytes,
  );
  if (list.error !== null) {
    return list.error === "timed-out" || list.error === "unsupported"
      ? { status: "unsupported" }
      : { status: "denied", code: list.error };
  }
  if (!list.responded) return { status: "unsupported" };
  const offered = new Set<string>();
  for (const mime of list.mimes.keys()) offered.add(mime.toLowerCase());
  const wanted = TERMINAL_IMAGE_MIMES.filter((mime) => offered.has(mime));
  if (wanted.length === 0) return { status: "no-image" };

  const readId = newOsc5522Id();
  const read = await roundTrip(
    { ...deps, write: send },
    buildOsc5522ReadQuery(wanted.join(" "), { ...queryOptions, id: readId }),
    readId,
    options?.readTimeoutMs ?? READ_TIMEOUT_MS,
    maxBytes,
  );
  if (read.error !== null) {
    if (read.error === "limit-exceeded") return { status: "limit-exceeded" };
    if (read.error === "timed-out") return { status: "timed-out" };
    if (read.error === "unsupported") return { status: "unsupported" };
    return { status: "denied", code: read.error };
  }
  for (const mime of wanted) {
    const chunks = read.mimes.get(mime) ?? read.mimes.get(mime.toLowerCase());
    if (chunks === undefined) continue;
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total === 0) continue;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (bytes.length > MAX_IMAGE_BYTES) return { status: "limit-exceeded" };
    return { status: "read", mimeType: mime, bytes };
  }
  // The clipboard changed between list and read.
  return { status: "no-image" };
}

export type PastedImage =
  | { bytes: Uint8Array; mimeType: string; error: null }
  | { bytes: null; mimeType: null; error: string };

/**
 * Full paste chain for Alt+V / Ctrl+V:
 * 1. terminal clipboard over 5522 (the only path that crosses SSH),
 * 2. host OS clipboard anywhere it can help (local sessions, or a genuinely
 *    remote-side image when the terminal stays silent),
 * 3. an error that names the actual next step for the session at hand.
 */
export async function readPastedImage(options?: {
  env?: NodeJS.ProcessEnv;
  terminal?: TerminalClipboardDeps | null;
  hostReader?: () => Promise<PastedImage>;
}): Promise<PastedImage> {
  const env = options?.env ?? process.env;
  const remote = isSshSession(env);
  const terminal = options?.terminal ?? null;
  if (terminal !== null) {
    const outcome = await queryTerminalClipboardImages({ ...terminal, env });
    if (outcome.status === "read") return { bytes: outcome.bytes, mimeType: outcome.mimeType, error: null };
    if (outcome.status === "no-image") {
      return { bytes: null, mimeType: null, error: "clipboard has no image — copy one first" };
    }
    if (outcome.status === "denied") {
      return {
        bytes: null,
        mimeType: null,
        error:
          outcome.code === "EPERM"
            ? "terminal denied clipboard read — kitty: add read-clipboard to clipboard_control, restart"
            : `terminal clipboard read failed (${outcome.code})`,
      };
    }
    if (outcome.status === "timed-out") {
      return { bytes: null, mimeType: null, error: "clipboard read timed out — approve the terminal prompt and retry" };
    }
    if (outcome.status === "limit-exceeded") {
      return { bytes: null, mimeType: null, error: "image is larger than 10 MB" };
    }
    // "unsupported": fall through to the host clipboard below.
  }
  if (!remote) {
    return (options?.hostReader ?? readClipboardImage)();
  }
  // Remote with a silent terminal: the host clipboard belongs to the remote
  // box, so it is worth exactly one attempt (an image copied over there);
  // a screenshot on the local machine can never arrive this way.
  const host = await (options?.hostReader ?? readClipboardImage)();
  if (host.error === null) return host;
  return {
    bytes: null,
    mimeType: null,
    error: "over SSH: allow Kitty clipboard reads (clipboard_control), or scp the file and @mention it",
  };
}
