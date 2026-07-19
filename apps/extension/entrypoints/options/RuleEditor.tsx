import { useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, FlaskConical, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Rule } from '@req-freedom/shared';
import {
  HeaderOperation,
  InsertScriptCodeType,
  InsertScriptTiming,
  kilobitsPerSecondToKilobytesPerSecond,
  kilobytesPerSecondToKilobitsPerSecond,
  MatchType,
  NETWORK_SPEED_DISPLAY_UNIT,
  NETWORK_THROTTLE_PRESET_SETTINGS,
  NetworkThrottlePreset,
  RequestBodyMode,
  RuleType,
} from '@req-freedom/shared';
import { getNetworkThrottleSettings, injectParams, matchUrl } from '@req-freedom/core';
import {
  HEADER_OPERATION_LABELS,
  HEADER_TARGET_LABELS,
  INSERT_SCRIPT_CODE_TYPE_LABELS,
  INSERT_SCRIPT_TIMING_LABELS,
  MATCH_TYPE_LABELS,
  NETWORK_THROTTLE_PRESET_LABELS,
  REQUEST_BODY_MODE_LABELS,
  RULE_TYPE_LABELS,
  RULE_TYPE_SCOPE_HINTS,
} from '@/utils/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import HeadersEditor from './HeadersEditor';
import KeyValueEditor from './KeyValueEditor';

/** 供「所属分组」下拉选择的分组精简信息 */
export interface GroupOption {
  /** 分组 ID */
  id: string;
  /** 分组名称 */
  name: string;
}

interface RuleEditorProps {
  /** 待编辑的规则（编辑器内部维护草稿副本，保存前不影响外部） */
  rule: Rule;
  /** 是否为新建（决定标题文案与保存语义） */
  isNew: boolean;
  /** 可选分组列表（用于「所属分组」选择与移动规则） */
  groups: GroupOption[];
  /** 规则当前所属分组 ID */
  groupId: string;
  /** 保存回调，参数为编辑后的完整规则与目标分组 ID */
  onSave: (rule: Rule, groupId: string) => void;
  /** 返回规则类型选择器的回调，参数为当前选择的目标分组 ID */
  onBackToTypePicker: (groupId: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

interface FieldProps {
  /** 字段标题 */
  label: string;
  /** 字段控件 */
  children: ReactNode;
}

/** 一次规则命中测试的结果 */
interface TestResult {
  /** 测试的 URL 是否命中该规则 */
  matched: boolean;
  /** 命中后规则产生的效果预览（未命中时为空） */
  effect: string;
}

/**
 * 表单字段：左标题右控件的两栏布局
 * @param label 字段标题
 * @param children 字段控件
 */
function Field({ label, children }: FieldProps) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-4">
      <Label className="pt-2 text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * 根据 pattern 猜一个默认测试 URL 预填到测试框，并补全协议头
 *
 * 只有正则匹配才需要剥离元字符（此时 . * 等是语法而非字面量）；
 * 包含 / 相等 / 通配下这些字符是字面量，必须原样保留，否则预填 URL 反而不命中。
 * @param pattern 规则的匹配模式
 * @param matchType 匹配方式
 * @returns 供测试输入框预填的 URL
 */
function guessTestUrl(pattern: string, matchType: MatchType): string {
  /** 处理元字符后的裸串 */
  let bare = pattern;
  if (matchType === MatchType.Regex) {
    // 正则：去掉转义符与常见元字符，还原成一个可能命中的普通 URL
    bare = pattern.replace(/\\/g, '').replace(/[.^$(|)?+\[\]{}]/g, '').replace(/\*/g, '');
  } else if (matchType === MatchType.Wildcard) {
    // 通配：仅 * 是通配符，去掉即可（* 匹配任意长度，空串也命中）
    bare = pattern.replace(/\*/g, '');
  }
  return /^https?:\/\//.test(bare) ? bare : `https://${bare.replace(/^\/+/, '')}`;
}

/**
 * 计算规则命中某 URL 后的效果预览文案（仅用于测试展示，不真正发请求）
 * @param rule 规则草稿
 * @param url 测试 URL
 * @returns 人类可读的效果描述
 */
function describeEffect(rule: Rule, url: string): string {
  switch (rule.type) {
    case RuleType.Block:
      return '请求会被直接拦截阻断';
    case RuleType.Redirect: {
      // 正则匹配时把 \1 等捕获组引用替换为实际捕获内容，还原真实重定向目标
      if (rule.matchType === MatchType.Regex) {
        try {
          /** 正则在测试 URL 上的匹配结果 */
          const groups = new RegExp(rule.pattern).exec(url);
          if (groups) {
            return `重定向到 ${rule.redirectUrl.replace(/\\(\d)/g, (_, d) => groups[Number(d)] ?? '')}`;
          }
        } catch {
          // 正则非法时降级为原样展示目标
        }
      }
      return `重定向到 ${rule.redirectUrl}`;
    }
    case RuleType.InjectParams:
      return `注入参数后 → ${injectParams(url, rule.params)}`;
    case RuleType.ModifyHeaders: {
      /** 各修改项的文字描述 */
      const items = rule.headers.map(
        (h) =>
          `${HEADER_TARGET_LABELS[h.target]}「${h.header || '?'}」${HEADER_OPERATION_LABELS[h.operation]}${
            h.operation === HeaderOperation.Remove ? '' : ` = ${h.value ?? ''}`
          }`,
      );
      return items.length ? items.join('；') : '未配置任何 Header 修改项';
    }
    case RuleType.MockResponse:
      return `返回 HTTP ${rule.statusCode}，响应体：${rule.body.slice(0, 80)}${rule.body.length > 80 ? '…' : ''}`;
    case RuleType.Delay:
      /** 当前规则实际生效的网络参数。 */
      const settings = getNetworkThrottleSettings(rule);
      /** 网络限速效果的各项说明。 */
      const descriptions = [
        settings.latencyMs > 0 ? `网络延迟 ${settings.latencyMs}ms` : '',
        settings.downloadKbps > 0
          ? `下行 ${kilobitsPerSecondToKilobytesPerSecond(settings.downloadKbps)} ${NETWORK_SPEED_DISPLAY_UNIT}`
          : '',
        settings.uploadKbps > 0
          ? `上行 ${kilobitsPerSecondToKilobytesPerSecond(settings.uploadKbps)} ${NETWORK_SPEED_DISPLAY_UNIT}`
          : '',
      ].filter(Boolean);
      return descriptions.length ? descriptions.join('，') : '不限制网络带宽';
    case RuleType.InsertScript:
      return `在 ${INSERT_SCRIPT_TIMING_LABELS[rule.timing]} 注入 ${
        INSERT_SCRIPT_CODE_TYPE_LABELS[rule.codeType]
      }：${rule.code.slice(0, 80)}${rule.code.length > 80 ? '…' : ''}`;
    case RuleType.ModifyRequestBody: {
      /** 改写内容的截断预览。 */
      const preview = `${rule.content.slice(0, 80)}${rule.content.length > 80 ? '…' : ''}`;
      return rule.mode === RequestBodyMode.Replace
        ? `整体替换请求体为：${preview}`
        : `将 JSON 深合并进请求体：${preview}`;
    }
  }
}

/**
 * 判断字符串是否为带 http/https 协议的绝对 URL
 *
 * DNR 的 redirect.url 只接受绝对地址（相对路径会导致整批规则被 Chrome 拒绝）。
 * @param value 待判断的字符串
 * @returns 是绝对 http(s) URL 时返回 true
 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    /** 解析后的 URL 对象，非绝对地址会抛错 */
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 校验规则草稿的合法性
 * @param rule 待校验的规则
 * @returns 错误信息；合法时返回 null
 */
function validateRule(rule: Rule): string | null {
  if (!rule.name.trim()) {
    return '规则名称不能为空';
  }
  if (!rule.pattern.trim()) {
    return '匹配内容不能为空';
  }
  // 正则匹配方式需要保证表达式可编译
  if (rule.matchType === MatchType.Regex) {
    try {
      new RegExp(rule.pattern);
    } catch {
      return '正则表达式语法错误';
    }
  }
  switch (rule.type) {
    case RuleType.Redirect: {
      if (!rule.redirectUrl.trim()) {
        return '重定向目标地址不能为空';
      }
      // 正则匹配可用 \1 等捕获组动态拼装目标，无法静态判定为合法 URL，此处放行
      if (rule.matchType !== MatchType.Regex && !isAbsoluteHttpUrl(rule.redirectUrl)) {
        return '重定向目标需为绝对地址，如 http://127.0.0.1:4317/api/redirect-target.json';
      }
      return null;
    }
    case RuleType.MockResponse:
      return rule.statusCode >= 100 && rule.statusCode <= 599
        ? null
        : '状态码需在 100 - 599 之间';
    case RuleType.Delay:
      if (!Object.values(NetworkThrottlePreset).includes(rule.throttlePreset)) {
        return '网络档位不合法';
      }
      if (
        !Number.isFinite(rule.latencyMs) ||
        rule.latencyMs < 0 ||
        !Number.isFinite(rule.downloadKbps) ||
        rule.downloadKbps < 0 ||
        !Number.isFinite(rule.uploadKbps) ||
        rule.uploadKbps < 0
      ) {
        return '网络延迟与上下行带宽需为非负数字';
      }
      return null;
    case RuleType.InsertScript:
      return rule.code.trim() ? null : '注入代码不能为空';
    case RuleType.ModifyRequestBody:
      if (!rule.content.trim()) {
        return '改写内容不能为空';
      }
      // JSON 深合并模式必须保证补丁本身是合法 JSON，否则运行时会被静默跳过
      if (rule.mode === RequestBodyMode.MergeJson) {
        try {
          JSON.parse(rule.content);
        } catch {
          return 'JSON 深合并模式下改写内容需为合法 JSON';
        }
      }
      return null;
    default:
      return null;
  }
}

/**
 * 规则编辑表单（渲染在对话框内）：公共字段 + 按类型渲染的专属字段 + 命中测试
 */
export default function RuleEditor({
  rule,
  isNew,
  groups,
  groupId,
  onSave,
  onBackToTypePicker,
  onCancel,
}: RuleEditorProps) {
  /** 编辑中的草稿（深拷贝，避免直接修改外部对象） */
  const [draft, setDraft] = useState<Rule>(() => structuredClone(rule));
  /** 规则目标所属分组（可在编辑时改为其他分组以移动规则） */
  const [targetGroupId, setTargetGroupId] = useState<string>(groupId);
  /** 校验错误信息 */
  const [error, setError] = useState<string | null>(null);
  /** 测试输入的 URL */
  const [testUrl, setTestUrl] = useState<string>(() => guessTestUrl(rule.pattern, rule.matchType));
  /** 最近一次测试结果 */
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  /**
   * 切换网络限速档位；选择预设时统一写入预设值，避免规则内出现展示档位与实际参数不一致。
   * @param value 下拉框选中的网络档位
   */
  const handleThrottlePresetChange = (value: string): void => {
    /** 下拉框传入的合法网络档位。 */
    const throttlePreset = value as NetworkThrottlePreset;
    if (draft.type !== RuleType.Delay) {
      return;
    }
    if (throttlePreset === NetworkThrottlePreset.Custom) {
      setDraft({
        ...draft,
        throttlePreset,
        latencyMs: draft.latencyMs,
        downloadKbps: draft.downloadKbps,
        uploadKbps: draft.uploadKbps,
      });
      return;
    }
    /** 所选预设对应的统一网络参数。 */
    const settings = NETWORK_THROTTLE_PRESET_SETTINGS[throttlePreset];
    setDraft({
      ...draft,
      throttlePreset,
      latencyMs: settings.latencyMs,
      downloadKbps: settings.downloadKbps,
      uploadKbps: settings.uploadKbps,
    });
  };

  /**
   * 校验并提交保存
   */
  const handleSave = (): void => {
    /** 草稿的校验结果 */
    const message = validateRule(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(draft, targetGroupId);
  };

  /**
   * 用当前草稿对测试 URL 做一次命中判断，并生成效果预览
   */
  const handleTest = (): void => {
    /** 测试 URL 是否命中草稿的匹配条件 */
    const matched = matchUrl(testUrl, draft.matchType, draft.pattern);
    setTestResult({
      matched,
      effect: matched ? describeEffect(draft, testUrl) : '',
    });
  };

  return (
    <>
      <DialogHeader>
        {isNew && (
          <button
            type="button"
            className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="返回选择类型"
            aria-label="返回选择类型"
            onClick={() => onBackToTypePicker(targetGroupId)}
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        <DialogTitle>{isNew ? '新建规则' : '编辑规则'}</DialogTitle>
        <Badge>{RULE_TYPE_LABELS[draft.type]}</Badge>
        <span
          className="group relative flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="悬停查看规则说明"
        >
          <Info className="size-3.5" aria-hidden="true" />
          <span
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs leading-5 text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
          >
            {RULE_TYPE_SCOPE_HINTS[draft.type]}
          </span>
        </span>
      </DialogHeader>

      {/* 可滚动的表单主体 */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <Field label="所属分组">
          <Select value={targetGroupId} onValueChange={setTargetGroupId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            改选其他分组即可把该规则移动过去。
          </p>
        </Field>

        <Field label="规则名称">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>

        <Field label="匹配方式">
          <Select
            value={draft.matchType}
            onValueChange={(value) => setDraft({ ...draft, matchType: value as MatchType })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(MatchType).map((matchType) => (
                <SelectItem key={matchType} value={matchType}>
                  {MATCH_TYPE_LABELS[matchType]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="匹配内容">
          <Textarea
            autoResize
            className="break-all font-mono text-xs"
            placeholder="如 example.com/api 或 https://api\.example\.com/(.*)"
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          />
        </Field>

        {/* ---------- 按规则类型渲染专属字段 ---------- */}

        {draft.type === RuleType.Redirect && (
          <Field label="重定向目标">
            <Input
              className="font-mono text-xs"
              placeholder={
                draft.matchType === MatchType.Regex
                  ? '需为绝对地址，支持 \\1 捕获组引用'
                  : '需为绝对地址，如 http://127.0.0.1:4317/api/redirect-target.json'
              }
              value={draft.redirectUrl}
              onChange={(e) => setDraft({ ...draft, redirectUrl: e.target.value })}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              必须填写含协议的绝对地址（http:// 或 https://），相对路径不生效。
            </p>
          </Field>
        )}

        {draft.type === RuleType.InjectParams && (
          <Field label="注入参数">
            <KeyValueEditor
              initialValue={draft.params}
              onChange={(params) => setDraft({ ...draft, params })}
            />
          </Field>
        )}

        {draft.type === RuleType.ModifyHeaders && (
          <Field label="Header 修改项">
            <HeadersEditor
              value={draft.headers}
              onChange={(headers) => setDraft({ ...draft, headers })}
            />
          </Field>
        )}

        {draft.type === RuleType.MockResponse && (
          <>
            <Field label="状态码">
              <Input
                type="number"
                min={100}
                max={599}
                value={draft.statusCode}
                onChange={(e) => setDraft({ ...draft, statusCode: Number(e.target.value) })}
              />
            </Field>
            <Field label="额外延迟(ms)">
              <Input
                type="number"
                min={0}
                value={draft.delayMs ?? 0}
                onChange={(e) => setDraft({ ...draft, delayMs: Number(e.target.value) })}
              />
            </Field>
            <Field label="响应体">
              <Textarea
                className="font-mono text-xs"
                rows={6}
                placeholder='{"code": 0, "data": {}}'
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </Field>
            <Field label="附加响应头">
              <KeyValueEditor
                initialValue={draft.responseHeaders ?? {}}
                onChange={(responseHeaders) => setDraft({ ...draft, responseHeaders })}
              />
            </Field>
          </>
        )}

        {draft.type === RuleType.Delay && (
          <>
            <Field label="网络档位">
              <Select
                value={draft.throttlePreset}
                onValueChange={handleThrottlePresetChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(NetworkThrottlePreset).map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {NETWORK_THROTTLE_PRESET_LABELS[preset]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {draft.throttlePreset === NetworkThrottlePreset.Custom && (
              <>
                <Field label="网络延迟(ms)">
                  <Input
                    type="number"
                    min={0}
                    value={draft.latencyMs}
                    onChange={(e) => setDraft({ ...draft, latencyMs: Number(e.target.value) })}
                  />
                </Field>
                <Field label={`下行(${NETWORK_SPEED_DISPLAY_UNIT})`}>
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={kilobitsPerSecondToKilobytesPerSecond(draft.downloadKbps)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        downloadKbps: kilobytesPerSecondToKilobitsPerSecond(Number(e.target.value)),
                      })
                    }
                  />
                </Field>
                <Field label={`上行(${NETWORK_SPEED_DISPLAY_UNIT})`}>
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={kilobitsPerSecondToKilobytesPerSecond(draft.uploadKbps)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        uploadKbps: kilobytesPerSecondToKilobitsPerSecond(Number(e.target.value)),
                      })
                    }
                  />
                </Field>
                <p className="-mt-2 text-right text-xs text-muted-foreground">
                  与 Chrome Network 面板的 {NETWORK_SPEED_DISPLAY_UNIT} 单位一致；0 表示不限制。
                </p>
              </>
            )}

          </>
        )}

        {draft.type === RuleType.InsertScript && (
          <>
            <Field label="代码类型">
              <Select
                value={draft.codeType}
                onValueChange={(value) =>
                  setDraft({ ...draft, codeType: value as InsertScriptCodeType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(InsertScriptCodeType).map((codeType) => (
                    <SelectItem key={codeType} value={codeType}>
                      {INSERT_SCRIPT_CODE_TYPE_LABELS[codeType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="注入时机">
              <Select
                value={draft.timing}
                onValueChange={(value) => setDraft({ ...draft, timing: value as InsertScriptTiming })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(InsertScriptTiming).map((timing) => (
                    <SelectItem key={timing} value={timing}>
                      {INSERT_SCRIPT_TIMING_LABELS[timing]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={draft.codeType === InsertScriptCodeType.Css ? 'CSS 代码' : 'JS 代码'}>
              <Textarea
                className="font-mono text-xs"
                rows={8}
                placeholder={
                  draft.codeType === InsertScriptCodeType.Css
                    ? 'body { filter: grayscale(1); }'
                    : "console.log('injected by req-freedom');"
                }
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
            </Field>
          </>
        )}

        {draft.type === RuleType.ModifyRequestBody && (
          <>
            <Field label="改写模式">
              <Select
                value={draft.mode}
                onValueChange={(value) => setDraft({ ...draft, mode: value as RequestBodyMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(RequestBodyMode).map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {REQUEST_BODY_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={draft.mode === RequestBodyMode.Replace ? '新请求体' : 'JSON 补丁'}>
              <Textarea
                className="font-mono text-xs"
                rows={8}
                placeholder={
                  draft.mode === RequestBodyMode.Replace
                    ? '{"code": 0, "data": {}}'
                    : '{"variables": {"first": 100}}'
                }
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {draft.mode === RequestBodyMode.Replace
                  ? '用上面的内容整体替换原请求体，原内容会被丢弃。'
                  : '把上面的 JSON 深合并进原请求体（原体须为 JSON 对象）；同名字段覆盖，对象递归合并。原体或补丁非合法 JSON 时不改写。'}
              </p>
            </Field>
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* 分隔编辑表单与独立的命中测试工具，避免两者视觉上混为同一区块。 */}
        <div aria-hidden="true" className="border-t border-border" />

        {/* ---------- 命中测试：输入 URL 校验规则是否生效 ---------- */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <FlaskConical className="size-4 text-primary" />
            规则测试
          </div>
          <div className="flex items-start gap-2">
            <Textarea
              autoResize
              className="break-all font-mono text-xs"
              placeholder="输入一个 URL 测试是否命中"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
            />
            <Button variant="secondary" size="sm" className="shrink-0" onClick={handleTest}>
              测试
            </Button>
          </div>
          {testResult && (
            <div
              className={`flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs leading-relaxed ${
                testResult.matched
                  ? 'bg-success/10 text-success'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {testResult.matched ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span className="min-w-0 break-all">
                {testResult.matched ? (
                  <>
                    <strong className="font-medium">命中</strong>：{testResult.effect}
                  </>
                ) : (
                  '未命中，该 URL 不会被此规则处理'
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={handleSave}>保存</Button>
      </DialogFooter>
    </>
  );
}
