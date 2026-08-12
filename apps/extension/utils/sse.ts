import type { MockResponseAction, SseEvent } from '@req-freedom/shared';
import { DEFAULT_SSE_EVENT_DELAY_MS, SseEndBehavior } from '@req-freedom/shared';

/** SSE 响应必须使用的 MIME 类型。 */
export const SSE_CONTENT_TYPE = 'text/event-stream; charset=utf-8';

/** SSE 协议中可被导入为事件配置的字段名。 */
const SSE_IMPORT_FIELDS = new Set(['event', 'data', 'id', 'retry']);

/** 动态变量解析函数。 */
export type SseValueResolver = (value: string) => string;

/** Mock EventSource 的生命周期回调。 */
export interface MockEventSourceCallbacks {
  /** EventSource 成功进入 OPEN 状态时调用。 */
  onOpen?: () => void;
  /** 创建后、派发 open 事件前的额外等待时间。 */
  initialDelayMs?: number;
}

/**
 * 把从 Network Response 等位置复制的原始 text/event-stream 内容解析为规则事件。
 *
 * 注释与未知字段会被忽略；多条 data 行按协议用换行拼接。为适配复制时经常缺少末尾空行的情况，
 * 最后一段有效事件也会被导入。仅包含 id / retry 等控制字段、没有 data 字段的段落不会生成事件。
 * @param source 原始 SSE 响应文本
 * @returns 按原始顺序解析出的事件列表
 */
export function parseSseEventStream(source: string): SseEvent[] {
  /** 已完成解析的事件列表。 */
  const events: SseEvent[] = [];
  /** 统一为 LF，并移除复制内容开头可能携带的 UTF-8 BOM。 */
  const normalizedSource = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  /** 当前事件的自定义事件名。 */
  let eventName: string | undefined;
  /** 当前事件的显式 ID。 */
  let eventId: string | undefined;
  /** 当前事件的重连间隔。 */
  let retryMs: number | undefined;
  /** 当前事件按出现顺序收集的 data 行。 */
  let dataLines: string[] = [];
  /** 当前段落是否至少出现过一个 data 字段。 */
  let hasDataField = false;

  /** 完成当前事件并重置段落状态。 */
  const dispatchEvent = (): void => {
    if (hasDataField) {
      /** 从当前协议段落构造的规则事件。 */
      const parsedEvent: SseEvent = {
        data: dataLines.join('\n'),
        ...(eventName ? { event: eventName } : {}),
        ...(eventId !== undefined ? { id: eventId } : {}),
        ...(retryMs !== undefined ? { retryMs } : {}),
      };
      events.push(parsedEvent);
    }
    eventName = undefined;
    eventId = undefined;
    retryMs = undefined;
    dataLines = [];
    hasDataField = false;
  };

  // 人工复制的响应可能没有最终空行，因此额外补一个空行统一触发最后一段的收尾。
  /** 含人工结束空行的协议行列表。 */
  const lines = [...normalizedSource.split('\n'), ''];
  for (const line of lines) {
    if (line === '') {
      dispatchEvent();
      continue;
    }
    if (line.startsWith(':')) {
      continue;
    }
    /** 字段名与字段值之间第一个冒号的位置。 */
    const separatorIndex = line.indexOf(':');
    /** 当前协议行的字段名。 */
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    if (!SSE_IMPORT_FIELDS.has(field)) {
      continue;
    }
    /** 冒号后的原始字段值。 */
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    /** SSE 只忽略冒号后的至多一个 ASCII 空格。 */
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'data') {
      dataLines.push(value);
      hasDataField = true;
    } else if (field === 'event') {
      eventName = value || undefined;
    } else if (field === 'id') {
      // 协议规定含 NUL 的 id 行无效；空 id 则保留，用于显式清空 lastEventId。
      if (!value.includes('\0')) {
        eventId = value;
      }
    } else if (/^\d+$/.test(value)) {
      /** retry 字段解析出的非负整数。 */
      const parsedRetryMs = Number(value);
      if (Number.isSafeInteger(parsedRetryMs)) {
        retryMs = parsedRetryMs;
      }
    }
  }

  return events;
}

/**
 * 把可能含换行的 SSE 单行字段收敛成一行，避免意外注入额外协议字段。
 * @param value 字段原值
 * @returns 移除 CR、LF 与 NUL 后的单行文本
 */
function toSingleLine(value: string): string {
  return value.replace(/[\r\n\0]+/g, '');
}

/**
 * 等待指定毫秒数，并确保零延迟事件也让出一个宏任务，避免循环流占满微任务队列。
 * @param delayMs 等待时间
 * @returns 等待完成的 Promise
 */
function wait(delayMs: number): Promise<void> {
  /** 收敛后的非负等待时间。 */
  const safeDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
  return new Promise((resolve) => setTimeout(resolve, safeDelayMs));
}

/**
 * 取得 SSE Mock 实际使用的事件列表。
 *
 * 手工构造的不完整规则没有 sseEvents 时，将历史 body 作为单条 message 事件，避免返回空流。
 * @param action SSE Mock 动作
 * @returns 至少一条事件的列表
 */
function getSseEvents(action: MockResponseAction): SseEvent[] {
  if (action.sseEvents && action.sseEvents.length > 0) {
    return action.sseEvents;
  }
  return [{ data: action.body }];
}

/**
 * 把单条事件编码为 text/event-stream 数据块。
 * @param event 待编码事件
 * @param resolveValue 动态变量解析器
 * @returns 以空行结尾的 SSE 数据块
 */
export function formatSseEvent(
  event: SseEvent,
  resolveValue: SseValueResolver = (value) => value,
): string {
  /** 编码后的协议行。 */
  const lines: string[] = [];
  if (event.event) {
    lines.push(`event: ${toSingleLine(resolveValue(event.event))}`);
  }
  if (event.id !== undefined) {
    lines.push(`id: ${toSingleLine(resolveValue(event.id))}`);
  }
  if (event.retryMs !== undefined && Number.isFinite(event.retryMs) && event.retryMs >= 0) {
    lines.push(`retry: ${Math.trunc(event.retryMs)}`);
  }
  /** 解析动态变量并统一换行符后的 data 内容。 */
  const data = resolveValue(event.data).replace(/\r\n?/g, '\n');
  for (const line of data.split('\n')) {
    lines.push(`data: ${line}`);
  }
  return `${lines.join('\n')}\n\n`;
}

/**
 * 创建供 fetch Mock 返回的 SSE 字节流。
 * @param action SSE Mock 动作
 * @param resolveValue 动态变量解析器
 * @returns 按事件延迟逐块交付的响应流
 */
export function createSseReadableStream(
  action: MockResponseAction,
  resolveValue: SseValueResolver,
): ReadableStream<Uint8Array> {
  /** 实际发送的事件列表。 */
  const events = getSseEvents(action);
  /** 事件发送结束后的行为。 */
  const endBehavior = action.sseEndBehavior ?? SseEndBehavior.Close;
  /** UTF-8 编码器；SSE 规范固定使用 UTF-8。 */
  const encoder = new TextEncoder();
  /** 下一条待发送事件的下标。 */
  let eventIndex = 0;
  /** 流是否已被消费方取消。 */
  let cancelled = false;
  /** 解除“保持连接”状态中挂起 pull 的函数。 */
  let releaseKeepOpen: (() => void) | undefined;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) {
        return;
      }
      if (eventIndex >= events.length) {
        if (endBehavior === SseEndBehavior.Loop) {
          eventIndex = 0;
        } else if (endBehavior === SseEndBehavior.KeepOpen) {
          await new Promise<void>((resolve) => {
            releaseKeepOpen = resolve;
          });
          return;
        } else {
          controller.close();
          return;
        }
      }
      /** 本次要发送的事件。 */
      const event = events[eventIndex];
      eventIndex += 1;
      await wait(event.delayMs ?? DEFAULT_SSE_EVENT_DELAY_MS);
      if (!cancelled) {
        controller.enqueue(encoder.encode(formatSseEvent(event, resolveValue)));
      }
    },
    cancel() {
      cancelled = true;
      releaseKeepOpen?.();
    },
  });
}

/** 模拟浏览器原生 EventSource 的最小可观察行为。 */
class MockSseEventSource extends EventTarget {
  /** 尚未建立连接。 */
  static readonly CONNECTING = 0;
  /** 连接已打开。 */
  static readonly OPEN = 1;
  /** 连接已关闭。 */
  static readonly CLOSED = 2;

  /** 尚未建立连接。 */
  readonly CONNECTING = MockSseEventSource.CONNECTING;
  /** 连接已打开。 */
  readonly OPEN = MockSseEventSource.OPEN;
  /** 连接已关闭。 */
  readonly CLOSED = MockSseEventSource.CLOSED;
  /** 绝对化后的事件流地址。 */
  readonly url: string;
  /** 是否携带跨源凭证。 */
  readonly withCredentials: boolean;
  /** 当前连接状态。 */
  readyState = MockSseEventSource.CONNECTING;
  /** open 事件属性监听器。 */
  onopen: ((this: EventSource, event: Event) => unknown) | null = null;
  /** message 事件属性监听器。 */
  onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;
  /** error 事件属性监听器。 */
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;

  /** SSE Mock 动作。 */
  private readonly action: MockResponseAction;
  /** 动态变量解析器。 */
  private readonly resolveValue: SseValueResolver;
  /** 生命周期回调。 */
  private readonly callbacks: MockEventSourceCallbacks;
  /** 最后一次派发事件的 ID。 */
  private lastEventId = '';
  /** 解除“保持连接”状态的等待函数。 */
  private releaseKeepOpen: (() => void) | undefined;

  /**
   * 创建 Mock EventSource，并在当前调用栈结束后异步建立连接。
   * @param url 事件流地址
   * @param init EventSource 初始化参数
   * @param action SSE Mock 动作
   * @param resolveValue 动态变量解析器
   * @param callbacks 生命周期回调
   */
  constructor(
    url: string,
    init: EventSourceInit | undefined,
    action: MockResponseAction,
    resolveValue: SseValueResolver,
    callbacks: MockEventSourceCallbacks,
  ) {
    super();
    this.url = url;
    this.withCredentials = init?.withCredentials === true;
    this.action = action;
    this.resolveValue = resolveValue;
    this.callbacks = callbacks;
    queueMicrotask(() => void this.start());
  }

  /** 关闭连接并取消后续事件。 */
  close(): void {
    this.readyState = MockSseEventSource.CLOSED;
    this.releaseKeepOpen?.();
  }

  /** 建立连接并按规则发送事件。 */
  private async start(): Promise<void> {
    await wait(this.callbacks.initialDelayMs ?? 0);
    if (this.readyState === MockSseEventSource.CLOSED) {
      return;
    }
    // 原生 EventSource 只接受 2xx text/event-stream；非成功状态直接进入失败关闭态。
    if (this.action.statusCode < 200 || this.action.statusCode >= 300) {
      this.readyState = MockSseEventSource.CLOSED;
      /** 连接失败事件。 */
      const errorEvent = new Event('error');
      this.dispatchEvent(errorEvent);
      this.onerror?.call(this as unknown as EventSource, errorEvent);
      return;
    }
    this.readyState = MockSseEventSource.OPEN;
    /** 连接成功事件。 */
    const openEvent = new Event('open');
    this.dispatchEvent(openEvent);
    this.onopen?.call(this as unknown as EventSource, openEvent);
    this.callbacks.onOpen?.();
    await this.dispatchEvents();
  }

  /** 按结束行为发送一轮或多轮事件。 */
  private async dispatchEvents(): Promise<void> {
    /** 实际发送的事件列表。 */
    const events = getSseEvents(this.action);
    /** 事件发送结束后的行为。 */
    const endBehavior = this.action.sseEndBehavior ?? SseEndBehavior.Close;
    do {
      for (const event of events) {
        await wait(event.delayMs ?? DEFAULT_SSE_EVENT_DELAY_MS);
        if (this.readyState === MockSseEventSource.CLOSED) {
          return;
        }
        this.dispatchMessage(event);
      }
    } while (endBehavior === SseEndBehavior.Loop && this.readyState === MockSseEventSource.OPEN);

    if (endBehavior === SseEndBehavior.KeepOpen) {
      await new Promise<void>((resolve) => {
        this.releaseKeepOpen = resolve;
      });
      return;
    }
    this.readyState = MockSseEventSource.CLOSED;
  }

  /**
   * 把一条规则事件转换为 MessageEvent 并派发。
   * @param event 待派发事件
   */
  private dispatchMessage(event: SseEvent): void {
    /** 解析后的事件类型。 */
    const eventType = event.event ? toSingleLine(this.resolveValue(event.event)) : 'message';
    /** 本条事件解析后的 ID。 */
    const eventId = event.id ? toSingleLine(this.resolveValue(event.id)) : this.lastEventId;
    if (event.id) {
      this.lastEventId = eventId;
    }
    /** 与原生 EventSource 一致的消息事件。 */
    const messageEvent = new MessageEvent(eventType, {
      data: this.resolveValue(event.data),
      origin: new URL(this.url).origin,
      lastEventId: eventId,
    });
    this.dispatchEvent(messageEvent);
    if (eventType === 'message') {
      this.onmessage?.call(this as unknown as EventSource, messageEvent);
    }
  }
}

/**
 * 创建命中 SSE Mock 时返回给页面的 EventSource 兼容对象。
 * @param url 绝对事件流地址
 * @param init EventSource 初始化参数
 * @param action SSE Mock 动作
 * @param resolveValue 动态变量解析器
 * @param callbacks 生命周期回调
 * @returns 可供页面订阅和关闭的 EventSource 对象
 */
export function createMockEventSource(
  url: string,
  init: EventSourceInit | undefined,
  action: MockResponseAction,
  resolveValue: SseValueResolver,
  callbacks: MockEventSourceCallbacks = {},
): EventSource {
  return new MockSseEventSource(url, init, action, resolveValue, callbacks) as unknown as EventSource;
}
