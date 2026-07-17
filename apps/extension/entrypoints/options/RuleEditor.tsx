import { useState } from 'react';
import { AlertCircle, CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Rule } from '@req-freedom/shared';
import { HeaderOperation, MatchType, RuleType } from '@req-freedom/shared';
import { injectParams, matchUrl } from '@req-freedom/core';
import {
  HEADER_OPERATION_LABELS,
  HEADER_TARGET_LABELS,
  MATCH_TYPE_LABELS,
  RULE_TYPE_LABELS,
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

interface RuleEditorProps {
  /** 待编辑的规则（编辑器内部维护草稿副本，保存前不影响外部） */
  rule: Rule;
  /** 是否为新建（决定标题文案与保存语义） */
  isNew: boolean;
  /** 保存回调，参数为编辑后的完整规则 */
  onSave: (rule: Rule) => void;
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
      return `请求延迟 ${rule.delayMs} 毫秒后继续`;
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
    case RuleType.Redirect:
      return rule.redirectUrl.trim() ? null : '重定向目标地址不能为空';
    case RuleType.MockResponse:
      return rule.statusCode >= 100 && rule.statusCode <= 599
        ? null
        : '状态码需在 100 - 599 之间';
    case RuleType.Delay:
      return Number.isFinite(rule.delayMs) && rule.delayMs >= 0 ? null : '延迟时长需为非负数字';
    default:
      return null;
  }
}

/**
 * 规则编辑表单（渲染在对话框内）：公共字段 + 按类型渲染的专属字段 + 命中测试
 */
export default function RuleEditor({ rule, isNew, onSave, onCancel }: RuleEditorProps) {
  /** 编辑中的草稿（深拷贝，避免直接修改外部对象） */
  const [draft, setDraft] = useState<Rule>(() => structuredClone(rule));
  /** 校验错误信息 */
  const [error, setError] = useState<string | null>(null);
  /** 测试输入的 URL */
  const [testUrl, setTestUrl] = useState<string>(() => guessTestUrl(rule.pattern, rule.matchType));
  /** 最近一次测试结果 */
  const [testResult, setTestResult] = useState<TestResult | null>(null);

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
    onSave(draft);
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
        <DialogTitle>{isNew ? '新建规则' : '编辑规则'}</DialogTitle>
        <Badge>{RULE_TYPE_LABELS[draft.type]}</Badge>
      </DialogHeader>

      {/* 可滚动的表单主体 */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
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
          <Input
            className="font-mono text-xs"
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
              placeholder="正则匹配时支持 \1 捕获组引用"
              value={draft.redirectUrl}
              onChange={(e) => setDraft({ ...draft, redirectUrl: e.target.value })}
            />
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
          <Field label="延迟时长(ms)">
            <Input
              type="number"
              min={0}
              value={draft.delayMs}
              onChange={(e) => setDraft({ ...draft, delayMs: Number(e.target.value) })}
            />
          </Field>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ---------- 命中测试：输入 URL 校验规则是否生效 ---------- */}
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <FlaskConical className="size-4 text-primary" />
            规则测试
          </div>
          <div className="flex gap-2">
            <Input
              className="h-8 font-mono text-xs"
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
