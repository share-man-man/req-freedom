import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileJson,
  FolderPlus,
  Upload,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Rule } from '@req-freedom/shared';
import { RuleActionType } from '@req-freedom/shared';
import {
  createRuleFromCurl,
  parseCurlRequest,
  parseHarRules,
  RULE_IMPORT_WARNING,
} from '@req-freedom/core';
import type {
  RuleImportCandidate,
  RuleImportWarningCode,
} from '@req-freedom/core';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import RuleEditor, {
  normalizeRuleDraft,
  validateRule,
  type GroupOption,
  type ValidationError,
} from './RuleEditor';

/** HAR 批量导入时用于表示“创建新分组”的临时值。 */
export const HAR_IMPORT_NEW_GROUP = '__req-freedom:har-new-group__';

/** HAR 批量保存参数。 */
export interface HarImportCommit {
  /** 目标分组 ID，临时值表示创建新分组。 */
  targetGroupId: string;
  /** 新分组名称。 */
  newGroupName: string;
  /** 是否导入后立即启用。 */
  enableImmediately: boolean;
  /** 已选中且通过校验的规则。 */
  rules: Rule[];
}

interface CurlImportDialogProps {
  /** 取消导入。 */
  onCancel: () => void;
  /** 解析成功后进入原有单条规则编辑器。 */
  onContinue: (rule: Rule) => void;
}

interface ConfigImportDialogProps {
  /** 打开 ReqFreedom Tab 时自动回填的本地配置 JSON。 */
  initialContent: string;
  /** 取消导入。 */
  onCancel: () => void;
  /** 校验并保存配置文本；返回 false 表示用户取消了覆盖确认。 */
  onImport: (content: string) => Promise<boolean>;
}

/** ReqFreedom 配置导入允许的文件扩展名。 */
const CONFIG_IMPORT_ACCEPT = '.json,application/json';

/**
 * ReqFreedom 配置导入：支持拖拽/选择 JSON 文件，也支持直接粘贴 JSON。
 * @param props 取消与导入回调
 */
export function ConfigImportDialog({ initialContent, onCancel, onImport }: ConfigImportDialogProps) {
  const { t } = useTranslation();
  /** 隐藏文件选择框。 */
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 待导入的 JSON 文本。 */
  const [content, setContent] = useState(initialContent);
  /** 最近选择或拖入的文件名。 */
  const [fileName, setFileName] = useState('');
  /** 文件是否正悬停在拖放区域。 */
  const [dragging, setDragging] = useState(false);
  /** 读取、校验或保存错误。 */
  const [error, setError] = useState<string | null>(null);
  /** 是否正在保存配置。 */
  const [saving, setSaving] = useState(false);

  /**
   * 读取配置文件到编辑区。
   * @param file 用户选择或拖入的 JSON 文件
   */
  const loadFile = async (file: File): Promise<void> => {
    try {
      /** 文件中的原始文本。 */
      const nextContent = await file.text();
      setContent(nextContent);
      setFileName(file.name);
      setError(null);
    } catch {
      setError(t('ruleImport.config.readFailure'));
    }
  };

  /**
   * 从文件选择框读取配置。
   * @param event 文件选择事件
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    /** 用户刚选择的文件。 */
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadFile(file);
  };

  /**
   * 接收拖入的配置文件。
   * @param event 文件拖放事件
   */
  const handleDrop = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragging(false);
    /** 用户拖入的第一个文件。 */
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  /** 校验并保存当前 JSON。 */
  const handleImport = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onImport(content);
    } catch (cause) {
      /** 可直接展示给用户的导入失败原因。 */
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept={CONFIG_IMPORT_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <p className="text-sm text-muted-foreground">{t('ruleImport.config.hint')}</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-7 text-center transition-colors outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 ${
            dragging
              ? 'border-primary bg-primary/10'
              : 'border-border bg-muted/20 hover:border-primary/60 hover:bg-primary/5'
          }`}
        >
          <Upload className="size-6 text-primary" />
          <span className="text-sm font-medium">
            {fileName || t('ruleImport.config.dropTitle')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('ruleImport.config.dropHint')}
          </span>
        </button>
        <div className="space-y-2">
          <Label htmlFor="config-import-content">{t('ruleImport.config.pasteLabel')}</Label>
          <textarea
            id="config-import-content"
            className="min-h-64 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder={t('ruleImport.config.pastePlaceholder')}
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setFileName('');
              setError(null);
            }}
          />
        </div>
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('ruleEditor.cancel')}</Button>
        <Button disabled={!content.trim() || saving} onClick={() => void handleImport()}>
          {saving ? t('ruleImport.config.importing') : t('ruleImport.config.import')}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * cURL 单条导入：只负责解析请求与选择目标动作，后续继续复用原有单条编辑交互。
 * @param props 取消与继续回调
 */
export function CurlImportDialog({ onCancel, onContinue }: CurlImportDialogProps) {
  const { t } = useTranslation();
  /** cURL 文本。 */
  const [content, setContent] = useState('');
  /** 解析错误代码。 */
  const [error, setError] = useState<string | null>(null);

  /**
   * 解析 cURL 并打开单条规则编辑器。
   */
  const handleContinue = (): void => {
    try {
      /** 解析出的 HTTP 请求。 */
      const request = parseCurlRequest(content);
      // cURL 的价值是「拿到一个真实请求」，落到 Mock 才能立刻改响应；
      // 需要重定向的话在编辑器里换动作即可，不必在导入阶段先做选择。
      /** 固定按返回值 Mock 生成的规则草稿。 */
      const rule = createRuleFromCurl(request, RuleActionType.MockResponse);
      onContinue(rule);
    } catch (cause) {
      /** core 返回的稳定错误代码。 */
      const code = cause instanceof Error ? cause.message : 'unknown';
      setError(t(`ruleImport.errors.${code}`, { defaultValue: code }));
    }
  };

  return (
    <div className="flex max-h-[82vh] min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <p className="text-sm text-muted-foreground">{t('ruleImport.curl.hint')}</p>
        <div className="space-y-2">
          <Label htmlFor="curl-import-content">{t('ruleImport.curl.command')}</Label>
          <textarea
            id="curl-import-content"
            className="min-h-64 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder="curl 'https://example.com/api' -H 'Accept: application/json'"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setError(null);
            }}
          />
        </div>
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('ruleEditor.cancel')}</Button>
        <Button disabled={!content.trim()} onClick={handleContinue}>
          {t('ruleImport.curl.continue')}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** 批量候选的 UI 状态。 */
interface BatchCandidateState {
  /** core 生成的候选元数据。 */
  candidate: RuleImportCandidate;
  /** 是否导入。 */
  selected: boolean;
  /** 当前编辑中的规则草稿。 */
  rule: Rule;
  /** 保存校验错误。 */
  error: ValidationError | null;
}

interface HarImportDialogProps {
  /** 当前可选分组。 */
  groups: GroupOption[];
  /** 取消导入。 */
  onCancel: () => void;
  /** 提交批量规则。 */
  onCommit: (commit: HarImportCommit) => Promise<void>;
}

/**
 * 把警告代码翻译成展示文案。
 * @param t 翻译函数
 * @param warning 警告代码
 * @returns 当前语言文案
 */
function getWarningText(
  t: ReturnType<typeof useTranslation>['t'],
  warning: RuleImportWarningCode,
): string {
  return t(`ruleImport.warnings.${warning}`);
}

/**
 * HAR 批量导入：文件解析、统一分组选择、逐条手风琴编辑和一次性提交。
 * @param props 分组选项与关闭、提交回调
 */
export function HarImportDialog({ groups, onCancel, onCommit }: HarImportDialogProps) {
  const { t } = useTranslation();
  /** 隐藏文件输入。 */
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 文件名。 */
  const [fileName, setFileName] = useState('');
  /** 待解析的 HAR JSON 文本。 */
  const [content, setContent] = useState('');
  /** 文件是否正悬停在拖放区域。 */
  const [dragging, setDragging] = useState(false);
  /** 批量候选状态。 */
  const [items, setItems] = useState<BatchCandidateState[]>([]);
  /** 当前展开的候选规则 ID。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 目标分组。 */
  const [targetGroupId, setTargetGroupId] = useState(HAR_IMPORT_NEW_GROUP);
  /** 新建分组名称。 */
  const [newGroupName, setNewGroupName] = useState(t('ruleImport.har.defaultGroupName'));
  /** 是否导入后立即启用。 */
  const [enableImmediately, setEnableImmediately] = useState(false);
  /** 文件解析或提交错误。 */
  const [error, setError] = useState<string | null>(null);
  /** 是否正在提交。 */
  const [saving, setSaving] = useState(false);

  /**
   * 解析 HAR 文本并生成规则候选。
   * @param nextContent HAR JSON 原始文本
   * @param sourceName 可选的来源文件名，用于生成默认分组名
   */
  const parseContent = (nextContent: string, sourceName = ''): void => {
    try {
      /** core 生成的规则候选。 */
      const candidates = parseHarRules(nextContent);
      /** 重复请求默认不选，防止同一 URL + 方法产生互相覆盖的规则。 */
      const nextItems = candidates.map((candidate) => ({
        candidate,
        selected: !candidate.warnings.includes(RULE_IMPORT_WARNING.DuplicateRequest),
        rule: candidate.rule,
        error: null,
      }));
      setItems(nextItems);
      setExpandedId(nextItems[0]?.rule.id ?? null);
      setError(candidates.length === 0 ? t('ruleImport.har.noCandidates') : null);
      setNewGroupName(
        sourceName.replace(/\.har$/i, '').trim() || t('ruleImport.har.defaultGroupName'),
      );
    } catch (cause) {
      /** core 返回的稳定错误代码。 */
      const code = cause instanceof Error ? cause.message : 'unknown';
      setItems([]);
      setExpandedId(null);
      setError(t(`ruleImport.errors.${code}`, { defaultValue: code }));
    }
  };

  /**
   * 读取并解析选择或拖入的 HAR 文件。
   * @param file 用户提供的 HAR 文件
   */
  const loadFile = async (file: File): Promise<void> => {
    try {
      /** HAR 文件中的原始文本。 */
      const nextContent = await file.text();
      setContent(nextContent);
      setFileName(file.name);
      parseContent(nextContent, file.name);
    } catch {
      setItems([]);
      setExpandedId(null);
      setError(t('ruleImport.har.readFailure'));
    }
  };

  /**
   * 选择并解析 HAR 文件。
   * @param event 文件选择事件
   */
  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    /** 用户选择的文件。 */
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadFile(file);
  };

  /**
   * 接收拖入的 HAR 文件。
   * @param event 文件拖放事件
   */
  const handleDrop = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragging(false);
    /** 用户拖入的第一个文件。 */
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  /**
   * 更新指定候选。
   * @param id 候选规则 ID
   * @param patch 状态增量
   */
  const updateItem = (id: string, patch: Partial<BatchCandidateState>): void => {
    setItems((previous) =>
      previous.map((item) =>
        item.rule.id === id ? { ...item, ...patch, error: patch.error ?? null } : item,
      ),
    );
  };

  /**
   * 校验全部选中规则并一次性提交。
   */
  const handleCommit = async (): Promise<void> => {
    /** 选中的候选项。 */
    const selectedItems = items.filter((item) => item.selected);
    if (
      selectedItems.length === 0 ||
      (targetGroupId === HAR_IMPORT_NEW_GROUP && !newGroupName.trim())
    ) {
      setError(t('ruleImport.har.selectionRequired'));
      return;
    }
    /** 已找到的首条错误规则 ID。 */
    let firstErrorId: string | null = null;
    /** 写入校验结果后的状态。 */
    const validatedItems = items.map((item) => {
      if (!item.selected) {
        return { ...item, error: null };
      }
      /** 归一化后的规则。 */
      const normalized = normalizeRuleDraft(item.rule);
      /** 当前规则校验错误。 */
      const validation = validateRule(t, normalized);
      if (validation && firstErrorId === null) {
        firstErrorId = item.rule.id;
      }
      return { ...item, rule: normalized, error: validation };
    });
    setItems(validatedItems);
    if (firstErrorId) {
      setExpandedId(firstErrorId);
      setError(t('ruleImport.har.fixErrors'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      /** 最终提交的规则列表。 */
      const rules = validatedItems
        .filter((item) => item.selected)
        .map((item) => item.rule);
      await onCommit({
        targetGroupId,
        newGroupName: newGroupName.trim(),
        enableImmediately,
        rules,
      });
    } catch (cause) {
      /** 存储失败提示。 */
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(t('ruleImport.har.saveFailure', { message }));
    } finally {
      setSaving(false);
    }
  };

  /** 已选规则数量。 */
  const selectedCount = items.filter((item) => item.selected).length;
  /** 已选响应体总字节数。 */
  const selectedBytes = items
    .filter((item) => item.selected)
    .reduce((total, item) => total + item.candidate.bodyBytes, 0);

  return (
    <div className="flex max-h-[88vh] min-h-0 flex-1 flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".har,application/json"
        className="hidden"
        onChange={handleFile}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <p className="text-sm text-muted-foreground">{t('ruleImport.har.chooseHint')}</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-7 text-center transition-colors outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 ${
            dragging
              ? 'border-primary bg-primary/10'
              : 'border-border bg-muted/20 hover:border-primary/60 hover:bg-primary/5'
          }`}
        >
          <FileJson className="size-6 text-primary" />
          <span className="text-sm font-medium">
            {fileName || t('ruleImport.har.dropTitle')}
          </span>
          <span className="text-xs text-muted-foreground">{t('ruleImport.har.dropHint')}</span>
        </button>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="har-import-content">{t('ruleImport.har.pasteLabel')}</Label>
            <Button
              variant="outline"
              size="sm"
              disabled={!content.trim()}
              onClick={() => parseContent(content)}
            >
              {t('ruleImport.har.parse')}
            </Button>
          </div>
          <textarea
            id="har-import-content"
            className="min-h-40 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder={t('ruleImport.har.pastePlaceholder')}
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setFileName('');
              setItems([]);
              setExpandedId(null);
              setError(null);
            }}
          />
        </div>

        {items.length > 0 && (
          <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {t('ruleImport.har.summary', {
              selected: selectedCount,
              total: items.length,
              size: Math.ceil(selectedBytes / 1024),
            })}
          </p>
        )}

        {items.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4">
              <div className="space-y-2">
                <Label>{t('ruleImport.har.group')}</Label>
                <Select value={targetGroupId} onValueChange={setTargetGroupId}>
                  <SelectTrigger
                    className={
                      targetGroupId === HAR_IMPORT_NEW_GROUP
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : undefined
                    }
                  >
                    {targetGroupId === HAR_IMPORT_NEW_GROUP ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <FolderPlus className="size-4 shrink-0" />
                        <span className="truncate">{newGroupName}</span>
                      </span>
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value={HAR_IMPORT_NEW_GROUP}
                      className="border border-primary/20 bg-primary/5 text-primary focus:bg-primary/10 focus:text-primary"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FolderPlus
                          className="size-4 shrink-0"
                          aria-label={t('ruleImport.har.newGroup')}
                        />
                        <span className="truncate">{newGroupName}</span>
                      </span>
                    </SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('ruleImport.har.groupName')}</Label>
                <Input
                  value={newGroupName}
                  disabled={targetGroupId !== HAR_IMPORT_NEW_GROUP}
                  onChange={(event) => setNewGroupName(event.target.value)}
                />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enableImmediately}
                  onChange={(event) => setEnableImmediately(event.target.checked)}
                />
                <span>{t('ruleImport.har.enableImmediately')}</span>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t('ruleImport.har.disabledHint')}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setItems((previous) =>
                      previous.map((item) => ({ ...item, selected: true })),
                    )
                  }
                >
                  {t('ruleImport.har.selectAll')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setItems((previous) =>
                      previous.map((item) => ({ ...item, selected: false })),
                    )
                  }
                >
                  {t('ruleImport.har.selectNone')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {items.map((item) => {
                /** 当前项是否展开。 */
                const expanded = expandedId === item.rule.id;
                return (
                  <div
                    key={item.rule.id}
                    className={`overflow-hidden rounded-lg border ${item.error ? 'border-destructive' : 'border-border'}`}
                  >
                    <div className="flex items-center gap-2 bg-muted/20 px-3 py-2">
                      <button
                        type="button"
                        className="flex size-5 items-center justify-center rounded border border-input"
                        aria-label={t('ruleImport.har.toggleSelection')}
                        aria-pressed={item.selected}
                        onClick={() =>
                          updateItem(item.rule.id, { selected: !item.selected })
                        }
                      >
                        {item.selected && <Check className="size-3.5 text-primary" />}
                      </button>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : item.rule.id)}
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
                        />
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {item.rule.methods[0]}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {item.rule.name}
                        </span>
                        <span className="max-w-72 truncate font-mono text-xs text-muted-foreground">
                          {item.rule.pattern}
                        </span>
                        {(item.error || item.candidate.warnings.length > 0) && (
                          <AlertTriangle
                            className={`size-4 shrink-0 ${item.error ? 'text-destructive' : 'text-warning'}`}
                          />
                        )}
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t border-border">
                        <div className="space-y-2 border-b border-border px-4 py-4">
                          <Label>{t('ruleEditor.name')}</Label>
                          <Input
                            value={item.rule.name}
                            aria-invalid={item.error?.field === 'name'}
                            onChange={(event) =>
                              updateItem(item.rule.id, {
                                rule: { ...item.rule, name: event.target.value },
                              })
                            }
                          />
                          {item.error?.field === 'name' && (
                            <p className="text-xs text-destructive">{item.error.message}</p>
                          )}
                          {item.candidate.warnings.map((warning) => (
                            <p key={warning} className="text-xs text-warning">
                              {getWarningText(t, warning)}
                            </p>
                          ))}
                        </div>
                        <RuleEditor
                          key={item.rule.id}
                          rule={item.rule}
                          isNew
                          groups={[]}
                          groupId={targetGroupId}
                          embedded
                          showGroup={false}
                          showName={false}
                          externalError={item.error}
                          onDraftChange={(rule) => updateItem(item.rule.id, { rule })}
                          onSave={() => undefined}
                          onCancel={() => undefined}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('ruleEditor.cancel')}</Button>
        <Button
          disabled={selectedCount === 0 || saving}
          onClick={() => void handleCommit()}
        >
          <Terminal />
          {saving ? t('ruleImport.har.saving') : t('ruleImport.har.importSelected')}
        </Button>
      </DialogFooter>
    </div>
  );
}
