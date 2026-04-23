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
 * 匹配请求路径与路由配置
 */
export function matchRoute(requestPath: string, routes: Route[]): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const patternParts = route.pattern.split('/').filter(Boolean);
    const pathParts = requestPath.split('/').filter(Boolean);
    
    if (patternParts.length !== pathParts.length && !route.pattern.includes('*')) {
      continue;
    }

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart.startsWith(':')) {
        const paramName = patternPart.slice(1);
        params[paramName] = pathPart;
      } else if (patternPart === '*') {
        // 通配符匹配剩余部分
        params['*'] = pathParts.slice(i).join('/');
        break;
      } else if (patternPart !== pathPart) {
        match = false;
        break;
      }
    }

    if (match) {
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