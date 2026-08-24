import { describe, expect, it } from 'vitest';
import type { MockResponseAction } from '@req-freedom/shared';
import {
  MockResponseDelivery,
  MockResponseMode,
  RuleActionType,
  SseEndBehavior,
} from '@req-freedom/shared';
import {
  createManualMockEventSource,
  createManualSseReadableStream,
  createMockEventSource,
  createSseReadableStream,
  formatSseEvent,
  parseSseEventStream,
} from './sse';

/**
 * 构造一条字段完整的 SSE Mock 动作。
 * @param overrides 需要覆盖的动作字段
 * @returns SSE Mock 动作
 */
function sseAction(overrides: Partial<MockResponseAction> = {}): MockResponseAction {
  return {
    type: RuleActionType.MockResponse,
    mode: MockResponseMode.Static,
    delivery: MockResponseDelivery.Sse,
    statusCode: 200,
    body: '',
    sseEvents: [{ data: 'hello', delayMs: 0 }],
    sseEndBehavior: SseEndBehavior.Close,
    ...overrides,
  };
}

/**
 * 读取字节流的全部内容。
 * @param stream 待读取的字节流
 * @returns UTF-8 解码后的完整文本
 */
async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  /** 流读取器。 */
  const reader = stream.getReader();
  /** 已读取的数据块。 */
  const chunks: Uint8Array[] = [];
  for (;;) {
    /** 下一段流数据。 */
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }
  /** 全部数据块的总字节数。 */
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  /** 拼接后的连续字节数组。 */
  const combined = new Uint8Array(totalLength);
  /** 当前写入偏移。 */
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

describe('formatSseEvent', () => {
  it('编码 event、id、retry 与多行 data，并解析动态变量', () => {
    expect(formatSseEvent(
      { event: 'update', id: '7', retryMs: 1500, delayMs: 0, data: 'a={{value}}\nb' },
      (value) => value.replace('{{value}}', '1'),
    )).toBe('event: update\nid: 7\nretry: 1500\ndata: a=1\ndata: b\n\n');
  });

  it('移除单行字段中的换行，避免注入额外协议字段', () => {
    expect(formatSseEvent({ event: 'x\ndata: injected', data: 'safe', delayMs: 0 }))
      .toBe('event: xdata: injected\ndata: safe\n\n');
  });

  it('保留空 id 字段以支持清空 lastEventId', () => {
    expect(formatSseEvent({ id: '', data: 'reset', delayMs: 0 }))
      .toBe('id: \ndata: reset\n\n');
  });
});

describe('parseSseEventStream', () => {
  it('解析从响应面板复制的多条事件', () => {
    /** 模拟用户从 Network Response 复制的原始 SSE 文本。 */
    const source = `id: 1
event: task.queued
data: {"seq":1,"type":"task.queued"}

id: 2
event: task.started
data: {"seq":2,"type":"task.started"}

id: 3
event: context.window.updated
data: {"seq":3,"type":"context.window.updated"}`;

    expect(parseSseEventStream(source)).toEqual([
      { id: '1', event: 'task.queued', data: '{"seq":1,"type":"task.queued"}' },
      { id: '2', event: 'task.started', data: '{"seq":2,"type":"task.started"}' },
      { id: '3', event: 'context.window.updated', data: '{"seq":3,"type":"context.window.updated"}' },
    ]);
  });

  it('兼容 CRLF、多行 data、注释、retry 与空字段值', () => {
    /** 覆盖常见协议细节的原始 SSE 文本。 */
    const source = '\uFEFF: keep-alive\r\nevent: update\r\nid:\r\nretry: 1500\r\ndata: first\r\ndata: second\r\n\r\n';

    expect(parseSseEventStream(source)).toEqual([
      { event: 'update', id: '', retryMs: 1500, data: 'first\nsecond' },
    ]);
  });

  it('忽略未知字段、非法 retry 以及没有 data 的控制段落', () => {
    /** 不应生成事件或字段的协议内容。 */
    const source = 'id: cursor-only\nretry: 2s\nunknown: value\n\ndata: accepted\n';

    expect(parseSseEventStream(source)).toEqual([{ data: 'accepted' }]);
  });
});

describe('createSseReadableStream', () => {
  it('按事件顺序输出 UTF-8 SSE 数据块并在 close 模式结束', async () => {
    /** 两条事件组成的测试动作。 */
    const action = sseAction({
      sseEvents: [
        { data: '第一条', delayMs: 0 },
        { event: 'done', data: 'ok', delayMs: 0 },
      ],
    });

    await expect(readStream(createSseReadableStream(action, (value) => value)))
      .resolves.toBe('data: 第一条\n\nevent: done\ndata: ok\n\n');
  });
});

describe('createManualSseReadableStream', () => {
  it('收到 send 前不输出，并且每次只写入一条最新事件', async () => {
    /** 动态变量每次解析时使用的当前值。 */
    let currentValue = 'first';
    /** 由测试逐条控制的 SSE 字节流。 */
    const handle = createManualSseReadableStream((value) =>
      value.replace('{{value}}', currentValue),
    );
    /** 流读取器。 */
    const reader = handle.stream.getReader();
    /** 首次读取是否已经完成。 */
    let firstReadSettled = false;
    /** 在 send 前发起、应保持挂起的首次读取。 */
    const firstRead = reader.read().then((result) => {
      firstReadSettled = true;
      return result;
    });

    await Promise.resolve();
    expect(firstReadSettled).toBe(false);
    expect(handle.send({ data: '{{value}}', delayMs: 60_000 })).toBe(true);
    await expect(firstRead).resolves.toMatchObject({ done: false });

    currentValue = 'second';
    expect(handle.send({ event: 'update', data: '{{value}}' })).toBe(true);
    /** 第二次读取到的事件数据块。 */
    const secondRead = await reader.read();
    expect(new TextDecoder().decode(secondRead.value)).toBe(
      'event: update\ndata: second\n\n',
    );

    expect(handle.close()).toBe(true);
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(handle.send({ data: 'late' })).toBe(false);
  });

  it('消费方取消流时只通知一次并拒绝后续写入', async () => {
    /** 取消回调的执行次数。 */
    let cancelCount = 0;
    /** 带取消回调的受控流。 */
    const handle = createManualSseReadableStream((value) => value, {
      onCancel: () => {
        cancelCount += 1;
      },
    });
    /** 用于模拟 fetch 消费方的读取器。 */
    const reader = handle.stream.getReader();

    await reader.cancel();

    expect(cancelCount).toBe(1);
    expect(handle.send({ data: 'late' })).toBe(false);
    expect(handle.close()).toBe(false);
  });
});

describe('createMockEventSource', () => {
  it('派发 open、message 与自定义事件，并在发送完成后关闭', async () => {
    /** 两条事件组成的 EventSource 动作。 */
    const action = sseAction({
      sseEvents: [
        { id: '1', data: 'hello', delayMs: 0 },
        { event: 'done', data: 'complete', delayMs: 0 },
      ],
    });
    /** 被测 Mock EventSource。 */
    const source = createMockEventSource('https://example.com/events', undefined, action, (value) => value);
    /** 实际收到的事件记录。 */
    const received: string[] = [];
    /** 自定义结束事件到达时解除的等待。 */
    const done = new Promise<void>((resolve) => {
      source.addEventListener('done', (event) => {
        received.push(`done:${event.data}`);
        resolve();
      });
    });
    source.addEventListener('open', () => received.push('open'));
    source.addEventListener('message', (event) => received.push(`message:${event.data}:${event.lastEventId}`));

    await done;
    // 事件监听器在 dispatchEvent 内同步执行；让发送循环完成本轮状态切换后再断言 CLOSED。
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual(['open', 'message:hello:1', 'done:complete']);
    expect(source.readyState).toBe(source.CLOSED);
  });

  it('手动连接在 open 后只派发显式 send 的事件', async () => {
    /** 两条事件组成、但不应自动派发的 EventSource 动作。 */
    const action = sseAction({
      sseEvents: [
        { data: 'configured', delayMs: 0 },
        { event: 'done', data: 'configured-done', delayMs: 0 },
      ],
    });
    /** 实际收到的事件记录。 */
    const received: string[] = [];
    /** 连接关闭回调次数。 */
    let closeCount = 0;
    /** 被测手动 Mock EventSource 与控制句柄。 */
    const handle = createManualMockEventSource(
      'https://example.com/events',
      undefined,
      action,
      (value) => value.replace('{{value}}', 'latest'),
      { onClose: () => { closeCount += 1; } },
    );
    /** 页面可观察到的 EventSource 对象。 */
    const source = handle.eventSource;
    /** 等待异步 open 事件。 */
    const opened = new Promise<void>((resolve) => source.addEventListener('open', () => resolve()));
    source.addEventListener('message', (event) => received.push(String(event.data)));

    await opened;
    expect(received).toEqual([]);
    expect(handle.send({ data: '{{value}}', delayMs: 60_000 })).toBe(true);
    expect(received).toEqual(['latest']);
    expect(handle.close()).toBe(true);
    expect(handle.close()).toBe(false);
    expect(closeCount).toBe(1);
    expect(source.readyState).toBe(source.CLOSED);
  });

  it('页面在 open 监听器中同步关闭时不登记可控制会话', async () => {
    /** 手动会话打开回调的次数。 */
    let openCallbackCount = 0;
    /** 手动会话关闭回调的次数。 */
    let closeCallbackCount = 0;
    /** 被测手动 Mock EventSource 与控制句柄。 */
    const handle = createManualMockEventSource(
      'https://example.com/events',
      undefined,
      sseAction(),
      (value) => value,
      {
        onOpen: () => { openCallbackCount += 1; },
        onClose: () => { closeCallbackCount += 1; },
      },
    );
    /** open 监听器完成同步关闭后解除的等待。 */
    const closedOnOpen = new Promise<void>((resolve) => {
      handle.eventSource.addEventListener('open', () => {
        handle.eventSource.close();
        resolve();
      });
    });

    await closedOnOpen;

    expect(openCallbackCount).toBe(0);
    expect(closeCallbackCount).toBe(1);
    expect(handle.eventSource.readyState).toBe(handle.eventSource.CLOSED);
  });
});
