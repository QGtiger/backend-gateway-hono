/**
 * Hello 路由处理器
 */
export default function handler(c) {
  const params = c.get('params') || {};
  const db = c.get('db');
  const appName = c.get('appName');
  const version = c.get('version');
  
  return {
    message: 'Hello from OSS Gateway!',
    timestamp: new Date().toISOString(),
    params,
    appName,
    version,
    hasDb: !!db,
  };
}