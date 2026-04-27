import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { matchRoute, extractAppInfo } from "./utils";
import type { AppEnv, AppConfig } from "./types";
import { ManifestManager, ModuleManager } from "./loader";
import { cors } from "hono/cors";

import { createHonoApp } from "@lightfish/server/shared";

/**
 * 将处理器返回值转换为标准响应格式
 */
function toResponse(
  c: { json: (data: unknown) => Response },
  result: unknown
): Response {
  if (result instanceof Response) {
    return result;
  }
  return c.json({
    success: true,
    data: result,
  });
}

/**
 * 创建并启动 API 服务器
 */
export async function createApp(config: AppConfig) {
  const { port, databaseUrl, fetchManifest, fetchModule } = config;

  // 初始化管理器
  const manifestManager = new ManifestManager(fetchManifest);
  const moduleManager = new ModuleManager(fetchModule);

  const app = await createHonoApp({
    port,
    databaseUrl,
    async dynamicRouteExecutor(c, requestPath) {
      const appInfo = extractAppInfo(c);
      const { appName, version } = appInfo;

      if (!appName || !version) {
        throw new Error("Missing appName or version");
      }

      // 设置到上下文中
      // @ts-ignore
      c.set("appName", appName);
      // @ts-ignore
      c.set("version", version);

      // 获取 manifest 和路由
      const manifest = await manifestManager.getManifest(appName, version);
      const routes = manifest.routes;

      // 匹配路由
      const match = matchRoute(requestPath, routes);

      if (!match) {
        throw new Error(`Route ${requestPath} not found`);
      }

      // 加载并执行模块
      const module = await moduleManager.getModule(
        appName,
        version,
        match.route.file
      );

      if (typeof module.default !== "function") {
        throw new Error(
          `Route module ${match.route.file} does not export a default function`
        );
      }

      // 设置路径参数到上下文
      c.set("params", match.params);

      // 执行路由处理器
      return module.default(c);
    },
  });
  // 健康检查路由
  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
