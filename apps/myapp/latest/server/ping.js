/**
 * Ping 处理器
 */
export default function handler(c) {
  return {
    message: 'pong',
    timestamp: new Date().toISOString(),
    headers: Object.fromEntries(c.req.raw.headers),
  };
}