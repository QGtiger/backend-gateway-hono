/**
 * 文件日志持久化（winston + winston-daily-rotate-file）
 *
 * - 所有请求 Trace → logs/gateway-YYYY-MM-DD.jsonl
 * - 出错请求额外 → logs/error-YYYY-MM-DD.jsonl
 * - 按天滚动，保留 LOG_RETENTION_DAYS 天（默认 30），过期自动清理
 *
 * 控制台的可读 trace 树由 trace.ts 的 printTrace 负责，这里只管落盘。
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import type { Trace } from './types';

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');
const RETENTION_DAYS = process.env.LOG_RETENTION_DAYS || '30d';

let fileLogger: winston.Logger | null = null;
let initFailed = false;

/**
 * 启动时初始化：确保日志目录存在并创建 winston 实例。
 * 初始化失败只降级为不落盘（console.error 一次），不影响服务启动。
 */
export function initFileLogger(): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    fileLogger = winston.createLogger({
      transports: [
        new DailyRotateFile({
          dirname: LOG_DIR,
          filename: 'gateway-%DATE%.jsonl',
          datePattern: 'YYYY-MM-DD',
          maxFiles: RETENTION_DAYS,
          zippedArchive: true,
        }),
        new DailyRotateFile({
          dirname: LOG_DIR,
          level: 'error',
          filename: 'error-%DATE%.jsonl',
          datePattern: 'YYYY-MM-DD',
          maxFiles: RETENTION_DAYS,
          zippedArchive: true,
        }),
      ],
    });
  } catch (error) {
    initFailed = true;
    console.error('File logger init failed, persistence disabled:', error);
  }
}

/**
 * 将一条 Trace 落盘。
 * @param isError 为 true 时同时写入 error 文件
 */
export function writeTrace(trace: Trace, isError: boolean): void {
  if (!fileLogger) return;
  try {
    fileLogger.log({
      level: isError ? 'error' : 'info',
      message: JSON.stringify(trace),
    });
  } catch (error) {
    console.error('Write trace to file failed:', error);
  }
}
