import type {
  Manifest,
  ManifestFetcher,
  ModuleFetcher,
  ModuleUrlBuilder,
  ManifestUrlBuilder,
  RouteModule,
  ExecutionLog,
} from "./types";
import { CONSOLE_LEVEL_MAP } from "./types";
import { LRUCache } from "lru-cache";
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import { SuperTask } from "./utils";

/**
 * 每请求的 console 捕获上下文。
 *
 * - 模块 load 时（首次缓存）无 store → console 走真 console，开发期可见
 * - handler 执行时（每请求）由调用方 requestLogStore.run({ logs, startMs }, () => module.default(c)) 进入作用域
 *   沙箱里的 Proxy console 会自动把 console.log 等推到当前请求的 logs[]
 * - 并发安全：每个请求独立 ALS context
 */
export const requestLogStore = new AsyncLocalStorage<{ logs: ExecutionLog[]; startMs: number }>();

/**
 * 安全序列化：处理循环引用 + 截断超长字符串
 */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      return v;
    });
  } catch {
    return String(value);
  }
}

/**
 * 创建沙箱用的 Proxy console。
 *
 * Proxy 只创建一次，缓存的 module 一直持有同一个 Proxy 引用。
 * - 无 ALS store 时（模块 load 期），转发到真 console
 * - 有 ALS store 时（请求执行期），推到 store.logs[]
 */
function createSandboxConsole(): { console: unknown } {
  const realConsole = console;
  const proxy = new Proxy({}, {
    get: (_target, prop: string) => {
      const store = requestLogStore.getStore();
      if (!store) {
        return (realConsole as any)[prop];
      }
      const level = CONSOLE_LEVEL_MAP[prop];
      if (!level) {
        return (realConsole as any)[prop];
      }
      return (...args: unknown[]) => {
        store.logs.push({
          timestamp: new Date().toISOString(),
          level,
          message: args.map((a) => safeStringify(a)).join(' '),
          offsetMs: Date.now() - store.startMs,
        });
      };
    },
  });
  return { console: proxy };
}

/**
 * 默认的 Manifest 获取器
 * 从 OSS 获取 manifest.json，路径格式：{baseUrl}/{appName}/{version}/server/manifest.json
 */
export function createDefaultManifestFetcher(baseUrl: string): ManifestFetcher {
  return async (appName: string, version: string): Promise<Manifest> => {
    const url = `${baseUrl}/${appName}/${version}/server/manifest.json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`
      );
    }

    const manifest = await response.json();

    if (!manifest.routes || !Array.isArray(manifest.routes)) {
      throw new Error(`Invalid manifest structure: missing routes array`);
    }

    return manifest;
  };
}

/**
 * 默认的模块获取器
 * 从 OSS 获取 JavaScript 模块代码，路径格式：{baseUrl}/{appName}/{version}/server/{filePath}
 */
export function createDefaultModuleFetcher(baseUrl: string): ModuleFetcher {
  return async (
    appName: string,
    version: string,
    filePath: string
  ): Promise<string> => {
    const url = `${baseUrl}/${appName}/${version}/server/${filePath}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch module from ${url}: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  };
}

/**
 * 默认的模块 URL 构造器（用于诊断日志）
 */
export function createDefaultModuleUrlBuilder(baseUrl: string): ModuleUrlBuilder {
  return (appName: string, version: string, filePath: string) => {
    return `${baseUrl}/${appName}/${version}/server/${filePath}`;
  };
}

/**
 * 默认的 Manifest URL 构造器（用于诊断日志）
 */
export function createDefaultManifestUrlBuilder(baseUrl: string): ManifestUrlBuilder {
  return (appName: string, version: string) => {
    return `${baseUrl}/${appName}/${version}/server/manifest.json`;
  };
}

/**
 * 带缓存的 Manifest 管理器
 */
export class ManifestManager {
  private superTask = new SuperTask<Manifest>(1000);
  private lruCache = new LRUCache<string, Manifest>({
    max: 1000,
  });
  private pendingRequests = new Map<string, Promise<Manifest>>();

  constructor(private fetchManifest: ManifestFetcher) {}

  /**
   * 判断指定 manifest 是否已在缓存中（仅查询，无副作用）
   */
  isCached(appName: string, version: string): boolean {
    return this.lruCache.has(`${appName}:${version}`);
  }

  async getManifest(appName: string, version: string): Promise<{ value: Manifest; fromCache: boolean }> {
    const cacheKey = `${appName}:${version}`;

    let manifestFromCache = this.lruCache.get(cacheKey);
    if (manifestFromCache) {
      return { value: manifestFromCache, fromCache: true };
    }

    let pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      const value = await pendingRequest;
      return { value, fromCache: true };
    }

    pendingRequest = this.superTask.run(async () => {
      try {
        const manifest = await this.fetchManifest(appName, version);
        this.lruCache.set(cacheKey, manifest);
        return manifest;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    });

    this.pendingRequests.set(cacheKey, pendingRequest);

    const value = await pendingRequest;
    return { value, fromCache: false };
  }
}

// 沙箱允许 require 的模块白名单
const EXTERNAL_MODULES = [
  "drizzle-orm",
  "drizzle-orm/pg-core",
  "@lightfish/server",
  "@lightfish/server/shared",
];

const ALLOWED_BUILTINS = ["path", "crypto", "util", "stream", "buffer"];

/**
 * 带缓存的模块管理器
 *
 * 注意：模块缓存的是 RouteModule（执行 vm.Script 后的 exports）。
 * 沙箱里的 console 是 Proxy（通过 ALS 路由），因此 module.default() 在每次请求中
 * 都会路由到当前请求的 logs[]，无需重建 context。
 */
export class ModuleManager {

  private superTask = new SuperTask<RouteModule>(1000);
  private lruCache = new LRUCache<string, RouteModule>({
    max: 1000,
  });
  private pendingRequests = new Map<string, Promise<RouteModule>>();

  constructor(private fetchModule: ModuleFetcher) {}

  /**
   * 判断指定 module 是否已在缓存中（仅查询，无副作用）
   */
  isCached(appName: string, version: string, filePath: string): boolean {
    return this.lruCache.has(`${appName}:${version}:${filePath}`);
  }

  async getModule(
    appName: string,
    version: string,
    filePath: string
  ): Promise<{ value: RouteModule; fromCache: boolean }> {
    const cacheKey = `${appName}:${version}:${filePath}`;

    let moduleFromCache = this.lruCache.get(cacheKey);
    if (moduleFromCache) {
      return { value: moduleFromCache, fromCache: true };
    }

    let pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      const value = await pendingRequest;
      return { value, fromCache: true };
    }

    pendingRequest = this.superTask.run(async () => {
      try {
        const code = await this.fetchModule(appName, version, filePath);
        const filename = `${appName}-${version}-${filePath}.js`;

        const moduleContainer = { exports: {} as RouteModule };

        const customRequire = (id: string) => {
          const isAllowed = EXTERNAL_MODULES.some(
            (m) => id === m || id.startsWith(m + "/")
          );
          const normalizedId = id.startsWith("node:") ? id.slice(5) : id;
          const isBuiltin = ALLOWED_BUILTINS.includes(normalizedId);
          if (isAllowed || isBuiltin) {
            return require(id);
          }
          throw new Error(
            `Module "${id}" is not allowed in sandbox`
          );
        };

        const sandboxConsole = createSandboxConsole();

        const sandbox = {
          module: moduleContainer,
          exports: moduleContainer.exports,
          require: customRequire,
          __filename: filename,
          __dirname: "/",
          console: sandboxConsole.console,
          fetch,
          URL,
          FormData,
          Buffer,
          setTimeout,
          setInterval,
          clearTimeout,
          Response,
          ReadableStream,
          TextDecoder,
          TextEncoder,
          Blob,
          AbortSignal,
          process: { env: process.env },
          global: {} as any,
        };
        sandbox.global = sandbox;

        const context = vm.createContext(sandbox);
        const script = new vm.Script(code, { filename });
        script.runInContext(context, {
          timeout: 30_000,
        });

        const routeModule = moduleContainer.exports;

        this.lruCache.set(cacheKey, routeModule);
        return routeModule;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    });

    this.pendingRequests.set(cacheKey, pendingRequest);

    const value = await pendingRequest;
    return { value, fromCache: false };
  }
}
