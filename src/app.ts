import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { matchRoute, extractAppInfo } from "./utils";
import type { AppEnv, AppConfig } from "./types";
import { ManifestManager, ModuleManager } from "./loader";

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
  const {
    port = 3000,
    databaseUrl: connectionString,
    fetchManifest,
    fetchModule,
  } = config;

  const app = new Hono<AppEnv>();

  // 初始化数据库连接
  let dbPool: Pool | null = null;
  let db: NodePgDatabase | null = null;

  if (connectionString) {
    dbPool = new Pool({
      connectionString,
      ssl: false,
    });

    db = drizzle(dbPool);
    await db.execute(sql`SELECT 1`);
    console.log("Database connection established");
  }

  // 初始化管理器
  const manifestManager = new ManifestManager(fetchManifest);
  const moduleManager = new ModuleManager(fetchModule);

  // 数据库中间件
  app.use("*", async (c, next) => {
    if (db) {
      c.set("db", db);
    }
    await next();
  });

  // 错误处理中间件
  app.onError((err, c) => {
    console.error("[API ERROR]", err);
    return c.json({
      success: false,
      error: err.message || String(err),
      message: err instanceof Error ? err.message : String(err),
    });
  });

  // 404 处理
  app.notFound((c) => c.json({ success: false, message: "Not found" }));

  // 注册 API 路由处理器
  app.all("/api/*", async (c) => {
    const appInfo = extractAppInfo(c);
    const { appName, version } = appInfo;

    if (!appName || !version) {
      throw new Error("Missing appName or version");
    }

    // 设置到上下文中
    c.set("appName", appName);
    c.set("version", version);

    // 获取请求路径（移除 /api 前缀）
    const requestPath = c.req.path.replace(/^\/api/, "") || "/";

    // 获取 manifest 和路由
    const manifest = await manifestManager.getManifest(appName, version);
    const routes = manifest.routes;

    // 匹配路由
    const match = matchRoute(requestPath, routes);

    if (!match) {
      return c.json({ success: false, message: "Route not found" });
    }

    // 加载并执行模块
    const module = await moduleManager.getModule(
      appName,
      version,
      match.route.file
    );

    if (typeof module.default !== "function") {
      throw new Error(`Module ${match.route.file} does not export a function`);
    }

    // 设置路径参数到上下文
    c.set("params", match.params);

    // 执行路由处理器
    const result = await module.default(c);

    // 返回标准化响应
    return toResponse(c, result);
  });

  // 启动服务器
  const server = serve({ fetch: app.fetch, port });

  // 优雅关闭处理
  const shutdown = async () => {
    console.log("Shutting down server...");
    if (dbPool) {
      await dbPool.end();
      console.log("Database connection closed");
    }
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`Gateway server is running on port ${port}`);

  return app;
}
