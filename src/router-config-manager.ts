import { LRUCache } from "lru-cache";

/**
 * 路由配置中单个 app 的信息
 */
export interface RouterAppInfo {
  id: string;
  domain: string;
  path?: string;
  enable: boolean;
  config: Record<string, unknown>;
  currentVersion: number;
  ossIndexUrl: string;
  publishList: Array<{
    version: number;
    ossIndexUrl: string;
    publishedAt: string;
    note?: string;
  }>;
}

/**
 * 路由配置顶层结构
 */
export interface RouterConfig {
  version: string;
  apps: RouterAppInfo[];
}

/**
 * 配置中心管理器
 * 从 OSS 获取路由配置并缓存，提供通过 appName 查询 version 的能力
 */
export class RouterConfigManager {
  private configCache: RouterConfig | null = null;
  private lastFetchTime: number = 0;
  private pendingFetch: Promise<RouterConfig> | null = null;

  // 按 appName 缓存 version，避免每次查找都遍历数组
  private versionCache = new LRUCache<string, number>({
    max: 100,
  });

  constructor(
    private configUrl: string = "https://lf-frontend.oss-cn-beijing.aliyuncs.com/routers.json",
    private ttlMs: number = 5 * 60 * 1000 // 默认 5 分钟 TTL
  ) {}

  /**
   * 获取路由配置
   * 优先从缓存返回，缓存过期或不存在时重新拉取
   */
  async getConfig(): Promise<RouterConfig> {
    const now = Date.now();

    // 缓存有效，直接返回
    if (this.configCache && now - this.lastFetchTime < this.ttlMs) {
      return this.configCache;
    }

    // 有正在进行的请求，复用
    if (this.pendingFetch) {
      return this.pendingFetch;
    }

    // 发起新请求
    this.pendingFetch = this.fetchConfig();
    try {
      const config = await this.pendingFetch;
      return config;
    } finally {
      this.pendingFetch = null;
    }
  }

  /**
   * 根据 appName 获取对应的 currentVersion
   * @param appName app 名称
   * @returns version 数字，未找到返回 null
   */
  async getVersion(appName: string): Promise<number | null> {
    // 先从 LRU 缓存查
    const cachedVersion = this.versionCache.get(appName);
    if (cachedVersion !== undefined) {
      return cachedVersion;
    }

    // 从配置中查找
    const config = await this.getConfig();
    const app = config.apps.find((a) => a.id === appName);

    if (!app) {
      return null;
    }

    // 写入 LRU 缓存
    this.versionCache.set(appName, app.currentVersion);
    return app.currentVersion;
  }

  /**
   * 强制刷新配置缓存
   */
  async refreshConfig(): Promise<RouterConfig> {
    this.clearCache();
    return this.getConfig();
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.configCache = null;
    this.lastFetchTime = 0;
    this.pendingFetch = null;
    this.versionCache.clear();
  }

  /**
   * 从 OSS 拉取配置
   */
  private async fetchConfig(): Promise<RouterConfig> {
    const response = await fetch(this.configUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch router config from ${this.configUrl}: ${response.status} ${response.statusText}`
      );
    }

    const config: RouterConfig = await response.json();

    // 验证数据结构
    if (!config.version || !Array.isArray(config.apps)) {
      throw new Error("Invalid router config structure");
    }

    this.configCache = config;
    this.lastFetchTime = Date.now();

    console.log(`Router config refreshed, version=${config.version}, apps=${config.apps.length}`);
    return config;
  }
}
