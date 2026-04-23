import type {
  Manifest,
  ManifestFetcher,
  ModuleFetcher,
  RouteModule,
} from "./types";
import { LRUCache } from "lru-cache";
import { NodeVM } from "vm2";
import { SuperTask } from "./utils";

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

    // 验证 manifest 结构
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
 * 带缓存的 Manifest 管理器
 */
export class ManifestManager {
  private superTask = new SuperTask<Manifest>(1000);
  private lruCache = new LRUCache<string, Manifest>({
    max: 1000,
  });
  private pendingRequests = new Map<string, Promise<Manifest>>();

  constructor(private fetchManifest: ManifestFetcher) {}

  async getManifest(appName: string, version: string): Promise<Manifest> {
    const cacheKey = `${appName}:${version}`;
    let manifestFromCache = this.lruCache.get(cacheKey);
    if (manifestFromCache) {
      console.log(`Manifest ${appName}:${version} from cache`);
      return manifestFromCache;
    }

    // 检查是否有正在进行的请求
    let pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    // 执行请求
    pendingRequest = this.superTask.run(async () => {
      try {
        const manifest = await this.fetchManifest(appName, version);
        this.lruCache.set(cacheKey, manifest);
        return manifest;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    });

    // 缓存请求
    this.pendingRequests.set(cacheKey, pendingRequest);

    // 返回请求
    return pendingRequest;
  }
}

const EXTERNAL_MODULES = ["drizzle-orm"];

/**
 * 带缓存的模块管理器
 */
export class ModuleManager {

  private superTask = new SuperTask<RouteModule>(1000);
  private lruCache = new LRUCache<string, RouteModule>({
    max: 1000,
  });
  private pendingRequests = new Map<string, Promise<RouteModule>>();

  constructor(private fetchModule: ModuleFetcher) {}

  async getModule(
    appName: string,
    version: string,
    filePath: string
  ): Promise<RouteModule> {
    const cacheKey = `${appName}:${version}:${filePath}`;
    let moduleFromCache = this.lruCache.get(cacheKey);
    if (moduleFromCache) {
      console.log(`Module ${filePath} from cache`);
      return moduleFromCache;
    }

    // 检查是否有正在进行的请求
    let pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    // 执行请求并缓存
    pendingRequest = this.superTask.run(async () => {
      try {
        const code = await this.fetchModule(appName, version, filePath);
        const vm = new NodeVM({
          console: "inherit",
          require: {
            external: EXTERNAL_MODULES,
            builtin: ["path", "crypto"],
            root: "./",
          },
          wrapper: "commonjs",
        });
        const module: RouteModule = vm.run(
          code,
          `${appName}-${version}-${filePath}.js`
        );
        this.lruCache.set(cacheKey, module);
        return module;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    });

    // 缓存请求
    this.pendingRequests.set(cacheKey, pendingRequest);
    return pendingRequest;
  }
}
