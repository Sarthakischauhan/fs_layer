/** Error helpers for virtual filesystem backends. */

export class FsError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "FsError";
    this.code = code;
    this.path = path;
  }
}

export function erofs(op: string, path?: string): never {
  throw new FsError(
    "EROFS",
    `Read-only file system: ${op} is not supported${path ? `: ${path}` : ""}`,
    path,
  );
}

export function enoent(path: string): never {
  throw new FsError("ENOENT", `No such file or directory: ${path}`, path);
}

export function eisdir(path: string): never {
  throw new FsError("EISDIR", `Is a directory: ${path}`, path);
}

export function enotdir(path: string): never {
  throw new FsError("ENOTDIR", `Not a directory: ${path}`, path);
}

export function eexist(path: string): never {
  throw new FsError("EEXIST", `File exists: ${path}`, path);
}
