import { createApp } from './app';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { ManifestFetcher, ModuleFetcher, AppConfig } from './types';
import {
  createDefaultManifestFetcher,
  createDefaultModuleFetcher,
  createDefaultModuleUrlBuilder,
  createDefaultManifestUrlBuilder,
} from './loader';
import { initFileLogger } from './logger';

/**
 * 本地文件系统的 Manifest 获取器（用于开发和测试）
 */
function createLocalManifestFetcher(baseDir: string): ManifestFetcher {
  return async (appName: string, version: string) => {
    const manifestPath = join(baseDir, appName, version, 'server', 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Manifest not found at ${manifestPath}`);
    }
    const content = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  };
}

/**
 * 本地文件系统的模块获取器（用于开发和测试）
 */
function createLocalModuleFetcher(baseDir: string): ModuleFetcher {
  return async (appName: string, version: string, filePath: string) => {
    const modulePath = join(baseDir, appName, version, 'server', filePath);
    if (!existsSync(modulePath)) {
      throw new Error(`Module not found at ${modulePath}`);
    }
    return readFileSync(modulePath, 'utf-8');
  };
}

/**
 * 本地文件系统的路径构造器（用于诊断日志的 attributes）
 */
function createLocalManifestUrlBuilder(baseDir: string) {
  return (appName: string, version: string) =>
    join(baseDir, appName, version, 'server', 'manifest.json');
}

function createLocalModuleUrlBuilder(baseDir: string) {
  return (appName: string, version: string, filePath: string) =>
    join(baseDir, appName, version, 'server', filePath);
}

/**
 * 异步获取配置
 */
function getConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:123456@localhost:5432/lf_test";
  const ossBaseUrl = process.env.OSS_BASE_URL;
  const localDevDir = process.env.LOCAL_DEV_DIR || join(process.cwd(), 'apps');

  let fetchManifest: ManifestFetcher;
  let fetchModule: ModuleFetcher;
  let getModuleUrl: import('./types').ModuleUrlBuilder | undefined;
  let getManifestUrl: import('./types').ManifestUrlBuilder | undefined;

  if (ossBaseUrl) {
    // 使用 OSS
    fetchManifest = createDefaultManifestFetcher(ossBaseUrl);
    fetchModule = createDefaultModuleFetcher(ossBaseUrl);
    getModuleUrl = createDefaultModuleUrlBuilder(ossBaseUrl);
    getManifestUrl = createDefaultManifestUrlBuilder(ossBaseUrl);
    console.log(`Using OSS storage: ${ossBaseUrl}`);
  } else {
    // 使用本地文件系统（开发模式）
    fetchManifest = createLocalManifestFetcher(localDevDir);
    fetchModule = createLocalModuleFetcher(localDevDir);
    getModuleUrl = createLocalModuleUrlBuilder(localDevDir);
    getManifestUrl = createLocalManifestUrlBuilder(localDevDir);
    console.log(`Using local development storage: ${localDevDir}`);
  }

   return {
    port: parseInt(process.env.PORT || '3001', 10),
    databaseUrl,
    fetchManifest,
    fetchModule,
    getModuleUrl,
    getManifestUrl,
  };
}

initFileLogger();

createApp(getConfig()).then(app => {
  console.log(`Gateway server started`);
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
