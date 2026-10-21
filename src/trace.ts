import type { Trace, TraceSpan, ExecutionLog } from './types';

/**
 * 渲染 span 树为可读多行文本（├─/└─ 缩进）
 */
function renderSpans(spans: TraceSpan[], indent: string, lines: string[]): void {
  spans.forEach((span, i) => {
    const last = i === spans.length - 1;
    const branch = indent + (last ? '└─ ' : '├─ ');
    lines.push(`${branch}${span.name}  ${span.duration}ms`);
    if (span.detail) {
      lines.push(`${indent + (last ? '   ' : '│  ')}   ↳ ${span.detail}`);
    }
    if (span.children?.length) {
      renderSpans(span.children, indent + (last ? '   ' : '│  '), lines);
    }
  });
}

/**
 * 将 Trace 格式化为可读文本打印到控制台。
 * - 每个请求都打印
 * - error / requestBody / responseBody 仅在出错时展示
 */
export function printTrace(trace: Trace): void {
  const lines: string[] = [];
  const status = `${trace.statusCode}${trace.error ? ' ERROR' : ''}`;
  lines.push(`▶ ${trace.traceId}  ${trace.endpoint}  ${status}  ${trace.duration}ms  app=${trace.appId}@${trace.version}${trace.handler ? ` handler=${trace.handler}` : ''}`);

  try {
    const spans: TraceSpan[] = JSON.parse(trace.spansJson);
    renderSpans(spans, '', lines);
  } catch {
    // spansJson 解析失败不影响日志输出
  }

  try {
    const logs: ExecutionLog[] = JSON.parse(trace.logsJson);
    if (logs.length > 0) {
      lines.push('   logs:');
      for (const log of logs) {
        lines.push(`   [${log.level} +${log.offsetMs}ms] ${log.message}`);
      }
    }
  } catch {
    // logsJson 解析失败不影响日志输出
  }

  if (trace.error) {
    lines.push(`   error: ${trace.error}`);
    if (trace.requestBody) lines.push(`   requestBody: ${trace.requestBody}`);
    if (trace.responseBody) lines.push(`   responseBody: ${trace.responseBody}`);
  }

  console.log(lines.join('\n'));
}

/**
 * Span 构建器：内部带 _start 时间戳，最终通过 toJSON 输出干净的 TraceSpan
 */
export class SpanBuilder {
  readonly name: string;
  private _start: number;
  duration = 0;
  children: SpanBuilder[] = [];
  detail?: string;

  constructor(name: string) {
    this.name = name;
    this._start = Date.now();
  }

  end(): void {
    this.duration = Date.now() - this._start;
  }

  toJSON(): TraceSpan {
    if (this.children.length === 0) {
      return this.detail
        ? { name: this.name, duration: this.duration, detail: this.detail }
        : { name: this.name, duration: this.duration };
    }
    return {
      name: this.name,
      duration: this.duration,
      ...(this.detail ? { detail: this.detail } : {}),
      children: this.children.map((c) => c.toJSON()),
    };
  }
}

export interface TraceFields {
  appId: string;
  version: string;
  handler: string | null;
  endpoint: string;
  statusCode: number;
  clientIp: string;
  userAgent: string;
  requestBody?: string;
  responseBody?: string;
  error?: string;
  logs: ExecutionLog[];
}

/**
 * Trace 构建器：累积 spans[] 并在请求结束时输出最终 Trace
 */
export class TraceBuilder {
  readonly traceId: string;
  readonly timestamp: string;
  private _startMs: number;
  private _spans: SpanBuilder[] = [];

  constructor(traceId: string) {
    this.traceId = traceId;
    this._startMs = Date.now();
    this.timestamp = new Date(this._startMs).toISOString();
  }

  get startMs(): number {
    return this._startMs;
  }

  /**
   * 开启一个 span。不传 parent → 入根 spans[]；传 parent → 入 parent.children
   */
  start(name: string, parent?: SpanBuilder): SpanBuilder {
    const span = new SpanBuilder(name);
    if (parent) {
      parent.children.push(span);
    } else {
      this._spans.push(span);
    }
    return span;
  }

  end(span: SpanBuilder): void {
    span.end();
  }

  /**
   * 异步执行 fn 并记录为 span。fn 抛错时 span 仍会闭合（再向上抛）
   */
  async track<T>(name: string, fn: () => Promise<T> | T, parent?: SpanBuilder, detail?: string): Promise<T> {
    const span = this.start(name, parent);
    if (detail) span.detail = detail;
    try {
      return await fn();
    } finally {
      this.end(span);
    }
  }

  /**
   * 同步执行 fn 并记录为 span
   */
  trackSync<T>(name: string, fn: () => T, parent?: SpanBuilder): T {
    const span = this.start(name, parent);
    try {
      return fn();
    } finally {
      this.end(span);
    }
  }

  toJSON(fields: TraceFields): Trace {
    // 序列化 spans / logs 为 JSON 字符串：
    // - SpanBuilder → TraceSpan（剥离 _start 等内部字段）
    // - logs 浅拷贝，确保输出是纯对象（不受外部引用影响）
    const spans = this._spans.map((s) => s.toJSON());
    const logs = fields.logs.map((l) => ({ ...l }));

    return {
      traceId: this.traceId,
      appId: fields.appId,
      version: fields.version,
      handler: fields.handler,
      endpoint: fields.endpoint,
      statusCode: fields.statusCode,
      duration: Date.now() - this._startMs,
      timestamp: this.timestamp,
      clientIp: fields.clientIp,
      userAgent: fields.userAgent,
      requestBody: fields.requestBody,
      responseBody: fields.responseBody,
      error: fields.error,
      spansJson: JSON.stringify(spans),
      logsJson: JSON.stringify(logs),
    };
  }
}
