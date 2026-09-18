import { describe, expect, it } from "vitest";

import {
  buildOsc5522ReadQuery,
  isTmuxSession,
  newOsc5522Id,
  parseOsc5522Reply,
  queryTerminalClipboardImages,
  readPastedImage,
  wrapOscForTmux,
  type TerminalClipboardDeps,
} from "../terminalClipboard.js";

const ESC = "\x1b";
const ST = "\x1b\\";
const BEL = "\x07";

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function reply(meta: string, payload = ""): string {
  return `${ESC}]5522;${meta};${payload}${ST}`;
}

/** Fake terminal deps: captures writes, replays scripted replies. */
function fakeTerminal(script: (emit: (sequence: string) => void) => void): {
  deps: TerminalClipboardDeps;
  writes: string[];
} {
  const writes: string[] = [];
  let handler: ((sequence: string) => void) | null = null;
  const deps: TerminalClipboardDeps = {
    write: (data: string) => {
      writes.push(data);
      script((sequence) => handler?.(sequence));
    },
    subscribe: (next: (sequence: string) => void) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
    env: {},
  };
  return { deps, writes };
}

describe("buildOsc5522ReadQuery", () => {
  it("frames a read request with metadata and base64 mime list", () => {
    const query = buildOsc5522ReadQuery("image/png", { id: "abc123", password: "pw", humanName: "t3code" });
    expect(query.startsWith(`${ESC}]5522;`)).toBe(true);
    expect(query.endsWith(ST)).toBe(true);
    const [, meta, payload] = query.slice(2, -ST.length).split(";");
    expect(meta).toMatch(/^type=read:id=abc123:pw=.+:name=.+$/);
    expect(Buffer.from(payload ?? "", "base64").toString("utf8")).toBe("image/png");
  });

  it("mints multiplexer-safe ids", () => {
    expect(newOsc5522Id()).toMatch(/^[a-zA-Z0-9\-_+.]+$/);
  });
});

describe("parseOsc5522Reply", () => {
  it("parses ok / data / done / error packets", () => {
    expect(parseOsc5522Reply(reply("type=read:status=OK:id=x"))).toEqual({ kind: "ok", id: "x" });
    const data = parseOsc5522Reply(reply(`type=read:status=DATA:mime=${b64("image/png")}:id=x`, b64("bytes")));
    expect(data?.kind).toBe("data");
    if (data?.kind === "data") {
      expect(data.mimeType).toBe("image/png");
      expect(Buffer.from(data.bytes).toString("utf8")).toBe("bytes");
    }
    expect(parseOsc5522Reply(reply("type=read:status=DONE:id=x"))).toEqual({ kind: "done", id: "x" });
    expect(parseOsc5522Reply(reply("type=read:status=EPERM:id=x"))).toEqual({ kind: "error", id: "x", code: "EPERM" });
  });

  it("accepts BEL terminators and rejects non-5522 sequences", () => {
    expect(parseOsc5522Reply(`${ESC}]5522;type=read:status=DONE;${BEL}`)).toEqual({ kind: "done", id: null });
    expect(parseOsc5522Reply(`${ESC}]52;c;dGV4dA==${BEL}`)).toBeNull();
    expect(parseOsc5522Reply("not an osc sequence")).toBeNull();
    expect(parseOsc5522Reply(reply("type=write:status=DONE"))).toBeNull();
  });
});

describe("wrapOscForTmux", () => {
  it("wraps in a DCS passthrough envelope with doubled escapes", () => {
    const wrapped = wrapOscForTmux(`${ESC}]5522;type=read;eA==${ST}`);
    expect(wrapped.startsWith(`${ESC}Ptmux;`)).toBe(true);
    expect(wrapped.endsWith(ST)).toBe(true);
    // Every inner escape is doubled; only the envelope framing stays single.
    expect(wrapped).toContain(`${ESC}${ESC}]5522`);
  });
});

describe("isTmuxSession", () => {
  it("detects TMUX", () => {
    expect(isTmuxSession({ TMUX: "/tmp/tmux-1,123,0" })).toBe(true);
    expect(isTmuxSession({})).toBe(false);
  });
});

describe("queryTerminalClipboardImages", () => {
  it("lists, then reads the offered image", async () => {
    const png = new Uint8Array([1, 2, 3, 4]);
    let step = 0;
    const { deps, writes } = fakeTerminal((emit) => {
      step += 1;
      if (step === 1) {
        emit(reply("type=read:status=OK"));
        emit(reply(`type=read:status=DATA:mime=${b64("text/plain")}`, b64("hi")));
        emit(reply(`type=read:status=DATA:mime=${b64("image/png")}`, ""));
        emit(reply("type=read:status=DONE"));
      } else {
        emit(reply("type=read:status=OK"));
        emit(reply(`type=read:status=DATA:mime=${b64("image/png")}`, Buffer.from(png).toString("base64")));
        emit(reply("type=read:status=DONE"));
      }
    });
    const outcome = await queryTerminalClipboardImages(deps);
    expect(writes).toHaveLength(2);
    expect(outcome.status).toBe("read");
    if (outcome.status === "read") {
      expect(outcome.mimeType).toBe("image/png");
      expect(outcome.bytes).toEqual(png);
    }
  });

  it("reports no-image when the list offers text only", async () => {
    const { deps } = fakeTerminal((emit) => {
      emit(reply("type=read:status=OK"));
      emit(reply(`type=read:status=DATA:mime=${b64("text/plain")}`, b64("hi")));
      emit(reply("type=read:status=DONE"));
    });
    expect(await queryTerminalClipboardImages(deps)).toEqual({ status: "no-image" });
  });

  it("reports denied on EPERM", async () => {
    const { deps } = fakeTerminal((emit) => {
      emit(reply("type=read:status=EPERM"));
    });
    expect(await queryTerminalClipboardImages(deps)).toEqual({ status: "denied", code: "EPERM" });
  });

  it("reports unsupported on silence", async () => {
    const writes: string[] = [];
    const deps: TerminalClipboardDeps = {
      write: (data: string) => {
        writes.push(data);
      },
      subscribe: () => () => undefined,
      env: {},
    };
    const outcome = await queryTerminalClipboardImages(deps, { listTimeoutMs: 20, readTimeoutMs: 20 });
    expect(outcome).toEqual({ status: "unsupported" });
    expect(writes).toHaveLength(1);
  });

  it("ignores replies for other request ids", async () => {
    const { deps } = fakeTerminal((emit) => {
      emit(reply("type=read:status=OK:id=someone-else"));
      emit(reply(`type=read:status=DATA:mime=${b64("image/png")}:id=someone-else`, b64("x")));
      emit(reply("type=read:status=DONE:id=someone-else"));
    });
    const outcome = await queryTerminalClipboardImages(deps, { listTimeoutMs: 30, readTimeoutMs: 30 });
    expect(outcome).toEqual({ status: "unsupported" });
  });
});

describe("readPastedImage", () => {
  it("returns the terminal image when kitty answers", async () => {
    const png = new Uint8Array([9, 9]);
    let step = 0;
    const { deps } = fakeTerminal((emit) => {
      step += 1;
      if (step === 1) {
        emit(reply("type=read:status=OK"));
        emit(reply(`type=read:status=DATA:mime=${b64("image/png")}`, ""));
        emit(reply("type=read:status=DONE"));
      } else {
        emit(reply("type=read:status=OK"));
        emit(reply(`type=read:status=DATA:mime=${b64("image/png")}`, Buffer.from(png).toString("base64")));
        emit(reply("type=read:status=DONE"));
      }
    });
    const result = await readPastedImage({ env: { SSH_CONNECTION: "a b c d" }, terminal: deps });
    expect(result.error).toBeNull();
    if (result.error === null) expect(result.bytes).toEqual(png);
  });

  it("guides to kitty config or scp when remote and silent", async () => {
    const terminal: TerminalClipboardDeps = {
      write: () => undefined,
      subscribe: () => () => undefined,
      env: {},
    };
    const result = await readPastedImage({
      env: { SSH_CONNECTION: "a b c d" },
      terminal: { ...terminal, env: {} },
      hostReader: () => Promise.resolve({ bytes: null, mimeType: null, error: "clipboard has no image" }),
    });
    expect(result.error).toMatch(/clipboard_control/);
    expect(result.error).toMatch(/scp/);
    expect(result.error!.length).toBeLessThanOrEqual(120);
  });

  it("uses the host clipboard locally without a terminal", async () => {
    const bytes = new Uint8Array([7]);
    const result = await readPastedImage({
      env: {},
      terminal: null,
      hostReader: () => Promise.resolve({ bytes, mimeType: "image/png", error: null }),
    });
    expect(result).toEqual({ bytes, mimeType: "image/png", error: null });
  });
});
