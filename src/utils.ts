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