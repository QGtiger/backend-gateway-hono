import type { Manifest, ManifestFetcher, ModuleFetcher, RouteModule } from './types';
import { NodeVM } from 'vm2'

/**
 * 默认的 Manifest 获取器
 * 从 OSS 获取 manifest.json，路径格式：{baseUrl}/{appName}/{version}/server/manifest.json
 */
export function createDefaultManifestFetcher(baseUrl: string): ManifestFetcher {
  return async (appName: string, version: string): Promise<Manifest> => {
    const url = `${baseUrl}/${appName}/${version}/server/manifest.json`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`);
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
  return async (appName: string, version: string, filePath: string): Promise<string> => {
    const url = `${baseUrl}/${appName}/${version}/server/${filePath}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch module from ${url}: ${response.status} ${response.statusText}`);
    }
    
    return await response.text();
  };
}



/**
 * 带缓存的 Manifest 管理器
 */
export class ManifestManager {
  private cache = new Map<string, { manifest: Manifest; timestamp: number }>();
  private cacheTtl: number; // 缓存时间（毫秒）

  constructor(
    private fetchManifest: ManifestFetcher,
    cacheTtl: number = 5 * 60 * 1000 // 默认 5 分钟
  ) {
    this.cacheTtl = cacheTtl;
  }

  async getManifest(appName: string, version: string): Promise<Manifest> {
    const cacheKey = `${appName}:${version}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.manifest;
    }

    const manifest = await this.fetchManifest(appName, version);
    this.cache.set(cacheKey, { manifest, timestamp: Date.now() });
    return manifest;
  }

  clearCache(appName?: string, version?: string): void {
    if (appName && version) {
      this.cache.delete(`${appName}:${version}`);
    } else if (appName) {
      // 删除该 app 的所有版本
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${appName}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }
}

const EXTERNAL_MODULES = ['drizzle-orm']

/**
 * 带缓存的模块管理器
 */
export class ModuleManager {
  private cache = new Map<string, { module: RouteModule; timestamp: number }>();
  private cacheTtl: number;

  constructor(
    private fetchModule: ModuleFetcher,
    cacheTtl: number = 5 * 60 * 1000
  ) {
    this.cacheTtl = cacheTtl;
  }

  async getModule(appName: string, version: string, filePath: string): Promise<RouteModule> {
    const cacheKey = `${appName}:${version}:${filePath}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.module;
    }

    const code = await this.fetchModule(appName, version, filePath);

    const vm = new NodeVM({
      console: 'inherit',
      require: {
          external: EXTERNAL_MODULES,
          builtin: ['path', 'crypto'],
          root: './'
      },
      wrapper: 'commonjs'
    });

    const module:RouteModule = vm.run(code, `${appName}-${version}-${filePath}.js`);
    
    this.cache.set(cacheKey, { module, timestamp: Date.now() });
    return module;
  }

  clearCache(appName?: string, version?: string, filePath?: string): void {
    if (appName && version && filePath) {
      this.cache.delete(`${appName}:${version}:${filePath}`);
    } else if (appName && version) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${appName}:${version}:`)) {
          this.cache.delete(key);
        }
      }
    } else if (appName) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${appName}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }
}