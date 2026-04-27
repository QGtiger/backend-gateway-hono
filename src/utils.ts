import type { Route } from './types';

/**
 * 从请求头中提取 appName 和 version
 */
export function extractAppInfo(c: any): { appName: string; version: string } {
  const appName = c.req.header('X-App-Name');
  const version = c.req.header('X-Version');
  
  if (!appName || !version) {
    throw new Error('Missing X-App-Name or X-Version header');
  }
  
  return { appName, version };
}

/**
 * 匹配请求路径到路由
 * @param requestPath 请求路径，如 /users/123
 * @param routes 路由数组
 * @returns 匹配到的路由和参数，未匹配到则返回 null
 */
export function matchRoute(requestPath: string, routes: Route[]): { route: Route; params: Record<string, string> } | null {
  // 按优先级排序：静态路径优先，动态参数少的优先
  const sortedRoutes = [...routes].sort((a, b) => {
    const aDynamic = (a.pattern.match(/:/g) || []).length;
    const bDynamic = (b.pattern.match(/:/g) || []).length;
    return aDynamic - bDynamic;
  });

  for (const route of sortedRoutes) {
    const regex = new RegExp(
      '^' + route.pattern.replace(/:([^/]+)/g, '([^/]+)') + '$'
    );
    const match = requestPath.match(regex);

    if (match) {
      const params: Record<string, string> = {};
      route.params.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { route, params };
    }
  }

  return null;
}

// 并发协调器
export class SuperTask<T = any> {
  private taskQueue: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    fn: () => Promise<T>;
  }> = [];
  private runningTasks: number = 0;
  constructor(private maxConcurrency: number = 20) {
  }

  /**
   * 执行任务
   * @param fn 任务函数
   * @returns 任务结果
   */
  async run(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ resolve, reject, fn });
      this.processTask();
    });
  }

  /**
   * 处理任务
   */
  private processTask() {
    while (this.runningTasks < this.maxConcurrency && this.taskQueue.length > 0) {
      const { resolve, reject, fn } = this.taskQueue.shift()!;
      this.runningTasks++;
      Promise.resolve(fn()).then(resolve, reject).finally(() => {
        this.runningTasks--;
        this.processTask();
      });
    }
  }
}