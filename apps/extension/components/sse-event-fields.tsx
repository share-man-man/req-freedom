import { useTranslation } from 'react-i18next';
import type { SseEvent } from '@req-freedom/shared';
import { DEFAULT_SSE_EVENT_DELAY_MS } from '@req-freedom/shared';
import { Input } from '@/components/ui/input';
import { parseOptionalNonNegativeNumber } from '@/utils/number-input';

/** SSE 事件元数据输入属性。 */
interface SseEventFieldsProps {
  /** 当前事件快照。 */
  value: SseEvent;
  /** 是否禁用全部输入。 */
  disabled?: boolean;
  /** 是否展示自动发送使用的事件间隔。 */
  showDelay?: boolean;
  /** 是否使用 popup 连接卡片中的紧凑尺寸。 */
  compact?: boolean;
  /** 事件字段变化回调。 */
  onChange: (patch: Partial<SseEvent>) => void;
}

/**
 * 编辑 SSE 事件名、ID、retry 与可选发送间隔。
 * @param props 当前事件、展示模式和字段变化回调
 */
export function SseEventFields({
  value,
  disabled = false,
  showDelay = false,
  compact = false,
  onChange,
}: SseEventFieldsProps) {
  const { t } = useTranslation();
  /** 紧凑模式输入框样式。 */
  const inputClassName = compact ? 'h-7 min-w-0 px-2 text-[11px]' : undefined;
  return (
    <div className={`grid gap-1.5 ${compact ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem]' : 'grid-cols-2'}`}>
      <Input
        value={value.event ?? ''}
        aria-label={t('ruleEditor.mockActionEditor.sseEventName')}
        placeholder={t('ruleEditor.mockActionEditor.sseEventName')}
        disabled={disabled}
        className={inputClassName}
        onChange={(event) => onChange({ event: event.target.value || undefined })}
      />
      <Input
        value={value.id ?? ''}
        aria-label={t('ruleEditor.mockActionEditor.sseEventId')}
        placeholder={t('ruleEditor.mockActionEditor.sseEventId')}
        disabled={disabled}
        className={inputClassName}
        onChange={(event) => onChange({ id: event.target.value || undefined })}
      />
      <Input
        type="number"
        min={0}
        value={value.retryMs ?? ''}
        aria-label={t('ruleEditor.mockActionEditor.sseRetryMs')}
        placeholder={t('ruleEditor.mockActionEditor.sseRetryMs')}
        disabled={disabled}
        className={inputClassName}
        onChange={(event) => onChange({
          retryMs: parseOptionalNonNegativeNumber(event.target.value),
        })}
      />
      {showDelay && (
        <Input
          type="number"
          min={0}
          value={value.delayMs ?? ''}
          aria-label={t('ruleEditor.mockActionEditor.sseDelayMs')}
          placeholder={t('ruleEditor.mockActionEditor.sseDelayMs', {
            defaultDelayMs: DEFAULT_SSE_EVENT_DELAY_MS,
          })}
          disabled={disabled}
          className={inputClassName}
          onChange={(event) => onChange({
            delayMs: parseOptionalNonNegativeNumber(event.target.value),
          })}
        />
      )}
    </div>
  );
}
