import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MockResponseAction, SseDebugSession, SseEvent } from '@req-freedom/shared';
import { LoadStatus, SseDebugSendKind } from '@req-freedom/shared';
import { SseEventFields } from '@/components/sse-event-fields';
import { Button } from '@/components/ui/button';
import { createSseSendNextCommand } from '@/utils/sse-debug';

/** SSE 连接列表属性。 */
interface SseConnectionListProps {
  /** 当前规则中已保存的手动 SSE Mock 动作。 */
  action: MockResponseAction;
  /** 当前标签页中该规则可展示的连接。 */
  connections: SseDebugSession[];
  /** 当前页面会话的读取状态。 */
  loadStatus: LoadStatus;
  /** 当前正在提交命令的会话 ID。 */
  pendingSessionId: string | null;
  /** 最近一次命令失败的会话 ID。 */
  failedSessionId: string | null;
  /** 发送下一条事件。 */
  onSendNext: (action: MockResponseAction, session: SseDebugSession, event: SseEvent) => void;
  /** 重新读取当前页面会话。 */
  onRetry: () => void;
}

/**
 * 手动 SSE 规则展开后的逐连接控制列表。
 * @param props 已保存动作、连接状态与控制回调
 */
export function SseConnectionList({
  action,
  connections,
  loadStatus,
  pendingSessionId,
  failedSessionId,
  onSendNext,
  onRetry,
}: SseConnectionListProps) {
  const { t } = useTranslation();
  /** 各连接、各事件游标在当前 popup 会话中的临时事件快照。 */
  const [eventDrafts, setEventDrafts] = useState<Record<string, SseEvent>>({});
  if (loadStatus === LoadStatus.Error) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-7 w-full text-xs" onClick={onRetry}>
        {t('popup.retry')}
      </Button>
    );
  }
  if (connections.length === 0) {
    return (
      <div className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
        {loadStatus === LoadStatus.Loading && <Loader2 className="size-3 animate-spin" />}
        {t('popup.sseWaiting')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {connections.map((session) => {
        /** 当前连接依据已保存事件与运行时游标生成的发送命令。 */
        const command = createSseSendNextCommand(action, session);
        /** 当前连接是否正在执行发送命令。 */
        const sending = session.id === pendingSessionId;
        /** 当前连接建立后确认的预设事件总数。 */
        const eventCount = session.eventCount;
        /** 当前连接已经发送的事件数量。 */
        const sentCount = Math.min(session.nextEventIndex, eventCount);
        /** 当前连接建立时间。 */
        const connectedTime = new Date(session.connectedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        /** 当前连接是否为最近一次命令失败的目标。 */
        const failed = failedSessionId === session.id;
        /** 当前连接、当前游标对应的临时消息键。 */
        const draftKey = `${session.id}:${session.nextEventIndex}`;
        /** 输入框展示并将在本次发送中使用的事件快照。 */
        const eventDraft = command ? eventDrafts[draftKey] ?? command.event : undefined;
        /** 当前连接是否已发完预设事件、正在编辑追加的自定义事件。 */
        const customEvent = command?.kind === SseDebugSendKind.Custom;
        /** 当前连接按钮的状态文案。 */
        const buttonLabel = sending
          ? t('popup.sseSending')
          : command
            ? t(customEvent ? 'popup.sseSendCustom' : 'popup.sseSendNext')
            : t('popup.sseCompleted');
        /**
         * 合并当前连接、当前事件游标的临时字段。
         * @param patch 用户刚修改的事件字段
         */
        const updateEventDraft = (patch: Partial<SseEvent>): void => {
          if (!command) {
            return;
          }
          setEventDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: {
              ...(currentDrafts[draftKey] ?? command.event),
              ...patch,
            },
          }));
        };
        return (
          <div key={session.id} className="rounded-md border border-border bg-background/70 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <time dateTime={new Date(session.connectedAt).toISOString()}>{connectedTime}</time>
              <div className="flex items-center gap-1.5">
                <span>{t('popup.sseSentProgress', { sent: sentCount, total: eventCount })}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={`h-6 px-2 text-[11px] ${failed ? 'border-destructive/50 text-destructive' : ''}`}
                  title={failed ? t('popup.sseSendFailed') : undefined}
                  disabled={!command || sending}
                  onClick={() => {
                    if (eventDraft) {
                      onSendNext(action, session, eventDraft);
                    }
                  }}
                >
                  {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                  {buttonLabel}
                </Button>
              </div>
            </div>
            {eventDraft && (
              <div className="mt-1.5">
                <SseEventFields
                  value={eventDraft}
                  disabled={!command || sending}
                  compact
                  onChange={updateEventDraft}
                />
              </div>
            )}
            <div className="mt-1.5">
              <textarea
                value={eventDraft?.data ?? ''}
                aria-label={t('popup.sseMessageInput')}
                aria-invalid={failed || undefined}
                placeholder={!command
                  ? t('popup.sseCompleted')
                  : customEvent
                    ? t('popup.sseCustomMessageInput')
                    : undefined}
                disabled={!command || sending}
                className={`min-h-20 w-full resize-none rounded-md border bg-background px-2 py-1.5 font-mono text-[11px] leading-4 outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${failed ? 'border-destructive' : 'border-input'}`}
                onChange={(event) => updateEventDraft({ data: event.target.value })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
