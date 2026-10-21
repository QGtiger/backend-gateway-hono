import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface AppEnv {
  Variables: {
    db?: NodePgDatabase;
    params?: Record<string, string>;
    appName?: string;
    version?: string;
  };
}

export interface Route {
  pattern: string;
  file: string;
  params: string[];
}

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

export type RouteModule = {
  default: (c: any) => unknown | Promise<unknown>;
  method?: RouteMethod | RouteMethod[];
};



export interface Manifest {
  routes: Route[];
}

export type ManifestFetcher = (appName: string, version: string) => Promise<Manifest>;
export type ModuleFetcher = (appName: string, version: string, filePath: string) => Promise<string>;
export type ModuleUrlBuilder = (appName: string, version: string, filePath: string) => string | undefined;
export type ManifestUrlBuilder = (appName: string, version: string) => string | undefined;

export interface AppConfig {
  port: number;
  databaseUrl: string;
  fetchManifest: ManifestFetcher;
  fetchModule: ModuleFetcher;
  getModuleUrl?: ModuleUrlBuilder;
  getManifestUrl?: ManifestUrlBuilder;
}

/**
 * 平台阶段（瀑布图）
 */
export interface TraceSpan {
  name: string;
  duration: number;
  /** 附加诊断信息（如资源完整地址），渲染在 span 行下方 */
  detail?: string;
  children?: TraceSpan[];
}

/**
 * 用户应用日志（时间轴）
 */
export interface ExecutionLog {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  offsetMs: number;
}

/**
 * 一次请求 = 一条 Trace（输出到 stdout 的最终形态）
 *
 * spansJson / logsJson 序列化为 JSON 字符串，便于 ELK 等日志系统作为单字段索引，
 * 避免嵌套数组在日志收集时被拆散或深度受限。
 */
export interface Trace {
  traceId: string;
  appId: string;
  version: string;
  handler: string | null;
  endpoint: string;
  statusCode: number;
  duration: number;
  timestamp: string;
  clientIp: string;
  userAgent: string;
  requestBody?: string;
  responseBody?: string;
  error?: string;
  spansJson: string;   // JSON.stringify(TraceSpan[])
  logsJson: string;    // JSON.stringify(ExecutionLog[])
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/**
 * console 方法名 → ExecutionLog level 的映射
 */
export const CONSOLE_LEVEL_MAP: Record<string, LogLevel> = {
  log: 'INFO',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  debug: 'DEBUG',
};