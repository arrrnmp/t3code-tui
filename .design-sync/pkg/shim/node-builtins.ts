/**
 * Browser stand-ins for the Node built-ins that `core/config.ts` and
 * `tui/model/message.ts` import at module level. Components only reach them
 * to shorten displayed paths; nothing here touches a file system.
 */
const norm = (parts: string[]) => {
  const out: string[] = [];
  for (const p of parts.join("/").split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out;
};
export const sep = "/";
export const join = (...parts: string[]) => {
  const abs = parts[0]?.startsWith("/") ?? false;
  return (abs ? "/" : "") + norm(parts).join("/");
};
export const resolve = (...parts: string[]) => {
  const from = parts.findLastIndex((p) => p.startsWith("/"));
  return "/" + norm(from >= 0 ? parts.slice(from) : ["/home/you", ...parts]).join("/");
};
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) || "/" : ".");
export const basename = (p: string, ext?: string) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
};
export const isAbsolute = (p: string) => p.startsWith("/");
export const relative = (from: string, to: string) => {
  const a = norm([from]);
  const b = norm([to]);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
};
export const normalize = (p: string) => (p.startsWith("/") ? "/" : "") + norm([p]).join("/");
export const posix = { sep, join, resolve, dirname, basename, extname, isAbsolute, relative, normalize };
export const homedir = () => "/home/you";
export const platform = () => "linux";
export const tmpdir = () => "/tmp";
const unavailable = () => Promise.reject(new Error("no file system in the browser"));
export const readFile = unavailable;
export const writeFile = unavailable;
export const mkdir = unavailable;
export const existsSync = () => false;
export const readFileSync = () => {
  throw new Error("no file system in the browser");
};
export const createRequire = () => () => {
  throw new Error("no require in the browser");
};
export default { ...posix, posix, homedir, platform, tmpdir, readFile, writeFile, mkdir, existsSync, readFileSync };
