import { matchRoute } from "./utils";
import type { AppConfig, ExecutionLog } from "./types";
import { ManifestManager, ModuleManager, requestLogStore } from "./loader";
import { RouterConfigManager } from "./router-config-manager";
import { writeTrace } from "./logger";
import { TraceBuilder, printTrace } from "./trace";
import { ServerError } from "@lightfish/server/shared";

import { nanoid } from "nanoid";
import { createHonoApp } from "@lightfish/server/shared";

const BODY_LIMIT = 4096;

function truncate(s: string, limit: number): string {
  return s.length > limit ? s.slice(0, limit) + "...truncated" : s;
}

/**
 * 从 c.req.raw.clone() 读取请求体（不影响 handler 后续读取），超长截断
 */
async function readRequestBody(c: {
  req: {
    method: string;
    header: (k: string) => string | undefined;
    raw: Request;
  };
}): Promise<string | undefined> {
  try {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD") return undefined;
    const ct = c.req.header("content-type") || "";
    if (!ct.includes("json") && !ct.includes("text") && !ct.includes("form"))
      return undefined;
    const clone = c.req.raw.clone();
    const text = await clone.text();
    if (!text) return undefined;
    return truncate(text, BODY_LIMIT);
  } catch {
    return undefined;
  }
}

function safeStringifyResult(result: unknown): string | undefined {
  try {
    if (result instanceof Response) {
      return `<Response ${result.status}>`;
    }
    return truncate(JSON.stringify(result), BODY_LIMIT);
  } catch {
    return undefined;
  }
}

/**
 * 创建并启动 API 服务器
 */
export async function createApp(config: AppConfig) {
  const { port, databaseUrl, fetchManifest, fetchModule, getManifestUrl, getModuleUrl } = config;

  // 初始化管理器
  const manifestManager = new ManifestManager(fetchManifest);
  const moduleManager = new ModuleManager(fetchModule);
  const routerConfigManager = new RouterConfigManager();

  const app = await createHonoApp({
    port,
    databaseUrl,
    async dynamicRouteExecutor(
      c,
      requestPath,
      { checkRouteModule, appName, version },
    ) {
      if (!appName || !version) {
        throw new Error("Missing appName or version");
      }

      const traceId = `req-${appName}-${nanoid(8)}`;
      const trace = new TraceBuilder(traceId);
      const logs: ExecutionLog[] = [];
      const startMs = trace.startMs;

      let statusCode = 200;
      let handler: string | null = null;
      let responseBody: string | undefined;
      let errorMessage: string | undefined;

      // 接收 HTTP 请求 span：从 executor 进入到第一个真实动作之前
      const recvSpan = trace.start("接收 HTTP 请求");

      const requestBody = await readRequestBody(c);

      trace.end(recvSpan);

      try {
        // 如果 version 为 latest，则从配置中心获取
        if (version === "latest") {
          version = await trace.track(`解析版本 (配置中心)`, async () => {
            const configVersion = await routerConfigManager.getVersion(appName);
            if (configVersion !== null) {
              console.log(
                `Version from config center for ${appName}: ${configVersion}`,
              );
              return String(configVersion);
            }
            return version;
          });
        }

        // @ts-ignore
        c.set("appName", appName);
        // @ts-ignore
        c.set("version", version);

        // span: 读取路由表（缓存命中标注 + 资源完整地址）
        const manifestCached = manifestManager.isCached(appName, version);
        const { value: manifest } = await trace.track(
          manifestCached ? "读取路由表 manifest.json (缓存)" : "读取路由表 manifest.json",
          () => manifestManager.getManifest(appName, version),
          undefined,
          getManifestUrl?.(appName, version),
        );

        // span: 匹配路由
        const routeMatch = await trace.track(`匹配路由 ${requestPath}`, () =>
          matchRoute(requestPath, manifest.routes),
        );

        if (!routeMatch) {
          statusCode = 404;
          throw new Error(`Route ${requestPath} not found`);
        }

        handler = routeMatch.route.file;

        // span: 加载模块（缓存命中标注 + 资源完整地址）
        const moduleCached = moduleManager.isCached(
          appName,
          version,
          routeMatch.route.file,
        );
        const { value: module } = await trace.track(
          moduleCached ? `加载模块 ${handler} (缓存)` : `加载模块 ${handler}`,
          () => moduleManager.getModule(appName, version, routeMatch.route.file),
          undefined,
          getModuleUrl?.(appName, version, routeMatch.route.file),
        );

        checkRouteModule(module);

        if (typeof module.default !== "function") {
          throw new Error(
            `Route module ${routeMatch.route.file} does not export a default function`,
          );
        }

        // 设置路径参数到上下文
        c.set("params", routeMatch.params);

        // 清空 drizzle CasingCache，避免跨版本同名表的列缓存碰撞
        // （getColumnCasing 对旧版本未缓存的列返回 undefined → escapeName(undefined) 报错）
        (c.get("db") as any)?.dialect?.casing?.clearCache?.();

        // span: 沙箱初始化 & 执行（nested）
        const execSpan = trace.start("沙箱初始化 & 执行");
        let result: unknown;
        try {
          // 子 span: 执行 handler —— 进入 ALS 作用域，捕获 console
          result = await trace.track(
            `执行 ${handler}`,
            () =>
              requestLogStore.run({ logs, startMs }, () => module.default(c)),
            execSpan,
          );

          // 子 span: 序列化响应
          await trace.track(
            "序列化响应",
            async () => {
              responseBody = safeStringifyResult(result);
            },
            execSpan,
          );
        } finally {
          trace.end(execSpan);
        }

        return result;
      } catch (error) {
        if (error instanceof ServerError) {
          statusCode = error.code;
        } else if (statusCode === 200) {
          statusCode = 500;
        }
        errorMessage = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        // span: 返回响应（标记性 span，反映 executor 即将退出）
        trace.start("返回响应").end();

        const traceObj = trace.toJSON({
          appId: appName,
          version,
          handler,
          endpoint: `${c.req.method} ${c.req.path}`,
          statusCode,
          clientIp:
            c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
            c.req.header("x-real-ip") ||
            "",
          userAgent: c.req.header("user-agent") || "",
          requestBody,
          responseBody,
          error: errorMessage,
          logs,
        });

        printTrace(traceObj);
        writeTrace(traceObj, !!errorMessage);
      }
    },
  });
  // 健康检查路由
  app.get("/health", (c) => c.json({ status: "ok" }));

  // 刷新配置中心缓存
  app.get("/refresh-config", async (c) => {
    try {
      await routerConfigManager.refreshConfig();
      return c.json({ status: "ok", message: "配置已刷新" });
    } catch (error) {
      console.error("Failed to refresh config:", error);
      return c.json(
        { status: "error", message: "配置刷新失败" },
        500 as any
      );
    }
  });

  return app;
}
