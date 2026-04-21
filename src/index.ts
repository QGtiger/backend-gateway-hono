import { createApp } from './app';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { ManifestFetcher, ModuleFetcher, AppConfig } from './types';
import { createDefaultManifestFetcher, createDefaultModuleFetcher } from './loader';

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
 * 异步获取配置
 */
function getConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:123456@localhost:5432/lf_test";
  const ossBaseUrl = process.env.OSS_BASE_URL;
  const localDevDir = process.env.LOCAL_DEV_DIR || join(process.cwd(), 'apps');

  let fetchManifest: ManifestFetcher;
  let fetchModule: ModuleFetcher;

  if (ossBaseUrl) {
    // 使用 OSS
    fetchManifest = createDefaultManifestFetcher(ossBaseUrl);
    fetchModule = createDefaultModuleFetcher(ossBaseUrl);
    console.log(`Using OSS storage: ${ossBaseUrl}`);
  } else {
    // 使用本地文件系统（开发模式）
    fetchManifest = createLocalManifestFetcher(localDevDir);
    fetchModule = createLocalModuleFetcher(localDevDir);
    console.log(`Using local development storage: ${localDevDir}`);
  }

   return {
    port: parseInt(process.env.PORT || '3001', 10),
    databaseUrl,
    fetchManifest,
    fetchModule,
  };
}

createApp(getConfig()).then(app => {
  console.log(`Gateway server started`);
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});