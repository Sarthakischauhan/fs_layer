/**
 * ReadOnlyVirtualFs — base IFileSystem for database-backed virtual filesystems.
 *
 * Implements just-bash's IFileSystem contract. Writes throw EROFS.
 * Subclasses provide path tree + content resolution.
 */

import type {
  BufferEncoding,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions,
} from "just-bash";

import { ContentCache } from "./cache.js";
import { eisdir, enoent, enotdir, erofs } from "./errors.js";
import { basename, dirname, normalizePath, PathTree } from "./path-tree.js";

const DEFAULT_MODE_FILE = 0o444;
const DEFAULT_MODE_DIR = 0o555;

export interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

type ReadFileOptions = { encoding?: BufferEncoding | null };
type WriteFileOptions = { encoding?: BufferEncoding };

export abstract class ReadOnlyVirtualFs implements IFileSystem {
  protected tree: PathTree;
  protected readonly cache: ContentCache;
  protected readonly mtime: Date;

  constructor(tree: PathTree, cache?: ContentCache) {
    this.tree = tree;
    this.cache = cache ?? new ContentCache();
    this.mtime = new Date();
  }

  /** Resolve file body for a normalised absolute path (must be a file). */
  protected abstract loadContent(path: string): Promise<string>;

  protected async getContent(path: string): Promise<string> {
    const normalised = normalizePath(path);
    const slug = this.tree.pathToSlug(normalised);
    if (!this.cache.has(slug)) {
      const content = await this.loadContent(normalised);
      this.cache.put(slug, content);
    }
    return this.cache.get(slug) ?? "";
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) return normalizePath(path);
    const baseDir = this.tree.isDir(base) ? normalizePath(base) : dirname(base);
    if (baseDir === "/") return normalizePath("/" + path);
    return normalizePath(baseDir + "/" + path);
  }

  getAllPaths(): string[] {
    return this.tree.getAllPaths();
  }

  async exists(path: string): Promise<boolean> {
    return this.tree.exists(normalizePath(path));
  }

  async stat(path: string): Promise<FsStat> {
    const normalised = normalizePath(path);
    if (this.tree.isDir(normalised)) {
      return {
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false,
        mode: DEFAULT_MODE_DIR,
        size: 0,
        mtime: this.mtime,
      };
    }
    if (this.tree.isFile(normalised)) {
      const content = await this.getContent(normalised);
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: DEFAULT_MODE_FILE,
        size: Buffer.byteLength(content, "utf8"),
        mtime: this.mtime,
      };
    }
    enoent(path);
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async readdir(path: string): Promise<string[]> {
    const normalised = normalizePath(path);
    if (this.tree.isFile(normalised)) enotdir(path);
    if (!this.tree.isDir(normalised)) enoent(path);
    return this.tree.lsNames(normalised);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const normalised = normalizePath(path);
    if (this.tree.isFile(normalised)) enotdir(path);
    if (!this.tree.isDir(normalised)) enoent(path);

    return this.tree.lsChildren(normalised).map((child) => {
      const name = basename(child);
      const isDirectory = this.tree.isDir(child);
      return {
        name,
        isFile: !isDirectory,
        isDirectory,
        isSymbolicLink: false,
      };
    });
  }

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const normalised = normalizePath(path);
    if (this.tree.isDir(normalised)) eisdir(path);
    if (!this.tree.isFile(normalised)) enoent(path);

    const content = await this.getContent(normalised);
    const encoding =
      typeof options === "string" ? options : (options?.encoding ?? "utf8");

    if (encoding === null || encoding === "binary" || encoding === "latin1") {
      return Buffer.from(content, "utf8").toString("latin1");
    }
    if (encoding === "base64") {
      return Buffer.from(content, "utf8").toString("base64");
    }
    if (encoding === "hex") {
      return Buffer.from(content, "utf8").toString("hex");
    }
    return content;
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const text = await this.readFile(path, "utf8");
    return new Uint8Array(Buffer.from(text, "utf8"));
  }

  async realpath(path: string): Promise<string> {
    const normalised = normalizePath(path);
    if (!this.tree.exists(normalised)) enoent(path);
    return normalised;
  }

  async readlink(path: string): Promise<string> {
    throw new Error(`EINVAL: not a symbolic link: ${path}`);
  }

  async writeFile(
    path: string,
    _content: FileContent,
    _options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    erofs("writeFile", path);
  }

  async appendFile(
    path: string,
    _content: FileContent,
    _options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    erofs("appendFile", path);
  }

  async mkdir(path: string, _options?: MkdirOptions): Promise<void> {
    erofs("mkdir", path);
  }

  async rm(path: string, _options?: RmOptions): Promise<void> {
    erofs("rm", path);
  }

  async cp(src: string, dest: string, _options?: CpOptions): Promise<void> {
    erofs("cp", `${src} -> ${dest}`);
  }

  async mv(src: string, dest: string): Promise<void> {
    erofs("mv", `${src} -> ${dest}`);
  }

  async chmod(path: string, _mode: number): Promise<void> {
    erofs("chmod", path);
  }

  async symlink(_target: string, linkPath: string): Promise<void> {
    erofs("symlink", linkPath);
  }

  async link(_existingPath: string, newPath: string): Promise<void> {
    erofs("link", newPath);
  }

  async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    erofs("utimes", path);
  }
}
