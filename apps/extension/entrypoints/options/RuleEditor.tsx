import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Check, CheckCircle2, ChevronDown, FlaskConical, Info, RefreshCw, Trash2, XCircle } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { BodyMatcher, Rule, RuleAction, RuleScope, ScopeTarget } from '@req-freedom/shared';
import { matchUrl } from '@req-freedom/core';
import {
  BodyMatchType,
  DEFAULT_DYNAMIC_MOCK_FUNCTION_CODE,
  DEFAULT_DYNAMIC_REQUEST_BODY_FUNCTION_CODE,
  DEFAULT_MOCK_BODY_TYPE,
  DEFAULT_MOCK_RESPONSE_MODE,
  DEFAULT_MOCK_STATUS,
  DEFAULT_NETWORK_THROTTLE_PRESET,
  DEFAULT_REQUEST_BODY_SOURCE_MODE,
  HeaderOperation,
  HeaderTarget,
  HttpMethod,
  InsertScriptCodeType,
  InsertScriptTiming,
  kilobitsPerSecondToKilobytesPerSecond,
  kilobytesPerSecondToKilobitsPerSecond,
  MatchType,
  MockBodyType,
  MockResponseMode,
  NETWORK_SPEED_DISPLAY_UNIT,
  NETWORK_THROTTLE_PRESET_SETTINGS,
  NetworkThrottlePreset,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
  RuleScopeType,
} from '@req-freedom/shared';
import { Button } from '@/components/ui/button';
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeEditor, type CodeEditorLanguage } from '@/components/ui/code-editor';
import { DynamicVariableHint } from '@/components/ui/dynamic-variable-hint';
import HeadersEditor from './HeadersEditor';
import KeyValueEditor from './KeyValueEditor';
import {
  BODY_MATCH_TYPE_LABELS,
  BODY_MATCH_VALUE_PLACEHOLDERS,
  INSERT_SCRIPT_CODE_TYPE_LABELS,
  INSERT_SCRIPT_TIMING_LABELS,
  MATCH_TYPE_LABELS,
  MOCK_BODY_TYPE_LABELS,
  MOCK_RESPONSE_MODE_LABELS,
  NETWORK_THROTTLE_PRESET_LABELS,
  REQUEST_BODY_MODE_LABELS,
  REQUEST_BODY_SOURCE_MODE_LABELS,
  RULE_ACTION_TYPE_LABELS,
  RULE_SCOPE_EMPTY_HINTS,
  RULE_SCOPE_TYPE_LABELS,
} from '@/utils/labels';

/** 供所属分组下拉选择的分组简要信息。 */
export interface GroupOption { id: string; name: string; }

interface RuleEditorProps {
  rule: Rule;
  isNew: boolean;
  groups: GroupOption[];
  groupId: string;
  onSave: (rule: Rule, groupId: string) => void;
  onCancel: () => void;
}

/** DNR 通道可用的动作。 */
const DNR_ACTIONS = [RuleActionType.Block, RuleActionType.Redirect, RuleActionType.InjectParams, RuleActionType.ModifyHeaders] as const;
/** 页面补丁通道可用的动作。 */
const PAGE_ACTIONS = [RuleActionType.MockResponse, RuleActionType.Delay, RuleActionType.ModifyRequestBody, RuleActionType.InsertScript] as const;
/** 不能在一次请求中同时执行的 DNR 路由动作。 */
const EXCLUSIVE_DNR_ACTIONS = [RuleActionType.Block, RuleActionType.Redirect, RuleActionType.InjectParams] as const;
/** 页面脚本注入以顶层文档 URL 命中，不能和按网络请求匹配的页面补丁动作混用。 */
const EXCLUSIVE_PAGE_ACTIONS = [RuleActionType.InsertScript] as const;
/** 可携带请求体的 HTTP 方法（改请求体动作专用）。 */
const BODY_METHODS = [HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete, HttpMethod.Options] as const;
/** 请求体条件下拉里「不启用」选项的哨兵值（不与任何 BodyMatchType 冲突）。 */
const BODY_MATCH_OFF = 'off';

/** 静态 Mock 响应体类型 → CodeEditor 高亮语言；HTML/XML/文本无内置高亮，回退纯文本。 */
const MOCK_BODY_TYPE_EDITOR_LANGUAGE: Record<MockBodyType, CodeEditorLanguage> = {
  [MockBodyType.Json]: 'json',
  [MockBodyType.Text]: 'text',
  [MockBodyType.Html]: 'text',
  [MockBodyType.Xml]: 'text',
  [MockBodyType.JavaScript]: 'javascript',
  [MockBodyType.Css]: 'css',
};

/** 动作的一句话说明，帮助用户在选择前理解各动作的作用。 */
const ACTION_DESCRIPTIONS: Record<RuleActionType, string> = {
  [RuleActionType.Block]: '直接阻断匹配到的请求',
  [RuleActionType.Redirect]: '把请求转发到另一个地址',
  [RuleActionType.InjectParams]: '向 URL 查询串追加或覆盖参数',
  [RuleActionType.ModifyHeaders]: '增删改请求头或响应头',
  [RuleActionType.MockResponse]: '拦截请求并返回自定义响应',
  [RuleActionType.Delay]: '为请求注入延迟与带宽限制',
  [RuleActionType.ModifyRequestBody]: '在请求发送前改写请求体',
  [RuleActionType.InsertScript]: '按页面 URL 注入 JS / CSS',
};

/** 动作分组元信息：以用户视角描述作用范围与组合规则，隐藏底层执行通道细节。 */
const ACTION_GROUPS: ReadonlyArray<{
  /** 组对应的执行通道。 */
  channel: RuleExecutionChannel;
  /** 组标题。 */
  title: string;
  /** 组作用范围提示。 */
  hint: string;
  /** 组内动作类型。 */
  types: readonly RuleActionType[];
  /** 组内动作的组合约束说明。 */
  note: string;
}> = [
  { channel: RuleExecutionChannel.Dnr, title: '网络层', hint: '作用于全部请求（含页面导航、静态资源），但读不到请求体', types: DNR_ACTIONS, note: '拦截 / 重定向 / 参数注入三选一，Header 改写可叠加' },
  { channel: RuleExecutionChannel.PagePatch, title: '页面内补丁', hint: '仅作用于页面脚本发起的 fetch / XHR，可读写请求体与响应', types: PAGE_ACTIONS, note: '返回值 Mock / 限速 / 改请求体可叠加；脚本注入需单独使用' },
];

/** 一次规则命中测试的结果。 */
interface TestResult {
  /** 测试的 URL 是否命中该规则。 */
  matched: boolean;
  /** 命中后各动作的效果预览（未命中时为空）。 */
  effect: string;
}

/**
 * 根据 pattern 猜一个默认测试 URL 预填到测试框，并补全协议头。
 *
 * 只有正则匹配才需要剥离元字符（此时 . * 等是语法而非字面量）；
 * 包含 / 相等 / 通配下这些字符是字面量，必须原样保留，否则预填 URL 反而不命中。
 * @param pattern 规则的匹配模式
 * @param matchType 匹配方式
 * @returns 供测试输入框预填的 URL
 */
function guessTestUrl(pattern: string, matchType: MatchType): string {
  /** 处理元字符后的裸串。 */
  let bare = pattern;
  if (matchType === MatchType.Regex) {
    // 正则：去掉转义符与常见元字符，还原成一个可能命中的普通 URL
    bare = pattern.replace(/\\/g, '').replace(/[.^$(|)?+[\]{}]/g, '').replace(/\*/g, '');
  } else if (matchType === MatchType.Wildcard) {
    // 通配：仅 * 是通配符，去掉即可（* 匹配任意长度，空串也命中）
    bare = pattern.replace(/\*/g, '');
  }
  return /^https?:\/\//.test(bare) ? bare : `https://${bare.replace(/^\/+/, '')}`;
}

/**
 * 计算单个动作命中后的效果预览文案（仅用于测试展示，不真正发请求）。
 * @param action 命中的动作
 * @returns 人类可读的效果描述
 */
function describeAction(action: RuleAction): string {
  switch (action.type) {
    case RuleActionType.Block: return '拦截：请求被直接阻断';
    case RuleActionType.Redirect: return `重定向 → ${action.redirectUrl}`;
    case RuleActionType.InjectParams: {
      /** 注入参数的键值对预览。 */
      const pairs = Object.entries(action.params).map(([key, value]) => `${key}=${value}`);
      return `注入参数：${pairs.length ? pairs.join('&') : '（空）'}`;
    }
    case RuleActionType.ModifyHeaders: return `改写 Header：${action.headers.length} 项`;
    case RuleActionType.MockResponse: return `Mock 返回 HTTP ${action.statusCode}`;
    case RuleActionType.Delay: return `限速：${NETWORK_THROTTLE_PRESET_LABELS[action.throttlePreset]}`;
    case RuleActionType.ModifyRequestBody: return `改请求体（${REQUEST_BODY_SOURCE_MODE_LABELS[action.sourceMode]}）`;
    case RuleActionType.InsertScript: return `注入 ${INSERT_SCRIPT_CODE_TYPE_LABELS[action.codeType]}（${INSERT_SCRIPT_TIMING_LABELS[action.timing]}）`;
  }
}

/**
 * 汇总命中后全部动作的效果预览。
 * @param rule 规则草稿
 * @returns 各动作效果的合并描述；无动作时为提示文案
 */
function describeEffect(rule: Rule): string {
  if (rule.actions.length === 0) return '尚未配置任何动作';
  return rule.actions.map(describeAction).join('；');
}

interface FieldProps { label: string; children: ReactNode; error?: string; innerRef?: Ref<HTMLDivElement>; }

/**
 * 两栏表单字段。
 * @param props 字段标签、控件、校验错误与滚动锚点 ref
 */
function Field({ label, children, error, innerRef }: FieldProps) {
  // 标签与表单项等高（h-9）且顶对齐：行不再整体垂直居中，标签固定贴合首行控件高度
  return <div ref={innerRef} className="grid grid-cols-[80px_1fr] items-start gap-4"><Label className={`flex h-9 items-center ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{label}</Label><div>{children}{error && <p className="mt-1 text-xs text-destructive">{error}</p>}</div></div>;
}

/**
 * 判断动作是否能在当前请求方法集合下执行。
 * @param type 动作类型
 * @param methods 规则当前选择的 HTTP 方法
 * @returns 当前方法组合支持该动作时返回 true
 */
function isActionSupportedByMethods(type: RuleActionType, methods: HttpMethod[]): boolean {
  /** 空数组表示全部方法，因此包含 GET 与 HEAD。 */
  const hasBodylessMethod = methods.length === 0 || methods.includes(HttpMethod.Get) || methods.includes(HttpMethod.Head);
  if (type === RuleActionType.ModifyRequestBody) {
    return !hasBodylessMethod;
  }
  if (type === RuleActionType.InsertScript) {
    return methods.length === 0 || methods.includes(HttpMethod.Get);
  }
  return true;
}

/**
 * 创建动作默认值。
 * @param type 动作类型
 * @returns 对应的动作草稿
 */
function createAction(type: RuleActionType): RuleAction {
  /** 默认限速档位对应的固定参数。 */
  const defaultPresetSettings = NETWORK_THROTTLE_PRESET_SETTINGS[DEFAULT_NETWORK_THROTTLE_PRESET];
  switch (type) {
    case RuleActionType.Block: return { type };
    case RuleActionType.Redirect: return { type, redirectUrl: 'https://example.com/target' };
    case RuleActionType.InjectParams: return { type, params: { debug: '1' } };
    case RuleActionType.ModifyHeaders: return { type, headers: [{ target: HeaderTarget.Request, operation: HeaderOperation.Set, header: 'X-Req-Freedom', value: '1' }] };
    case RuleActionType.MockResponse: return { type, mode: DEFAULT_MOCK_RESPONSE_MODE, bodyType: DEFAULT_MOCK_BODY_TYPE, statusCode: DEFAULT_MOCK_STATUS, body: '{\n  "code": 0\n}', functionCode: DEFAULT_DYNAMIC_MOCK_FUNCTION_CODE };
    case RuleActionType.Delay: return { type, throttlePreset: DEFAULT_NETWORK_THROTTLE_PRESET, ...defaultPresetSettings };
    case RuleActionType.ModifyRequestBody: return { type, sourceMode: DEFAULT_REQUEST_BODY_SOURCE_MODE, mode: RequestBodyMode.MergeJson, content: '{\n  "injectedBy": "req-freedom"\n}', functionCode: DEFAULT_DYNAMIC_REQUEST_BODY_FUNCTION_CODE };
    case RuleActionType.InsertScript: return { type, codeType: InsertScriptCodeType.JavaScript, timing: InsertScriptTiming.DocumentEnd, code: "console.log('injected by req-freedom');" };
  }
}

/**
 * 判断字符串是否为带 http/https 协议的绝对 URL。
 *
 * DNR 的 redirect.url 只接受绝对地址，相对路径会导致整批规则被 Chrome 拒绝。
 * @param value 待判断的字符串
 * @returns 是绝对 http(s) URL 时返回 true
 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    /** 解析后的 URL 对象，非绝对地址会抛错。 */
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 判断字符串是否为合法 JSON。
 * @param value 待判断的字符串
 * @returns 能被 JSON.parse 解析时返回 true
 */
function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** 校验错误：定位到具体表单项的锚点 key 与提示文案。 */
interface ValidationError {
  /** 出错字段的锚点 key，用于标红与滚动定位。'actions' / 'name' / 'pattern' / 'methods' 或 `action:<类型>`。 */
  field: string;
  /** 展示给用户的错误说明。 */
  message: string;
}

/**
 * 生成动作卡片的错误锚点 key。
 * @param type 动作类型
 * @returns 与 ActionEditor 注册 ref 一致的 key
 */
function actionFieldKey(type: RuleActionType): string {
  return `action:${type}`;
}

/**
 * 校验规则草稿。
 * @param rule 待保存的规则
 * @returns 首个校验错误（含定位字段），合法时为 null
 */
function validateRule(rule: Rule): ValidationError | null {
  if (rule.actions.length === 0) return { field: 'actions', message: '至少选择一个动作' };
  if (!rule.name.trim()) return { field: 'name', message: '规则名称不能为空' };
  if (!rule.pattern.trim()) return { field: 'pattern', message: '匹配内容不能为空' };
  if (rule.matchType === MatchType.Regex) { try { new RegExp(rule.pattern); } catch { return { field: 'pattern', message: '正则表达式语法错误' }; } }
  /** 是否有不允许 body 的方法。 */
  const hasBodylessMethod = rule.methods.length === 0 || rule.methods.includes(HttpMethod.Get) || rule.methods.includes(HttpMethod.Head);
  if (hasBodylessMethod && rule.actions.some((action) => action.type === RuleActionType.ModifyRequestBody)) return { field: 'methods', message: '改请求体需选择 POST / PUT / PATCH / DELETE / OPTIONS' };
  if (rule.bodyMatch !== undefined) {
    if (!rule.bodyMatch.value.trim()) return { field: 'bodyMatch', message: '请求体匹配值不能为空' };
    if (rule.bodyMatch.type === BodyMatchType.Regex) { try { new RegExp(rule.bodyMatch.value); } catch { return { field: 'bodyMatch', message: '请求体匹配正则语法错误' }; } }
  }
  // 作用域限定了范围（非全部标签页）时，必须至少选中一个目标对象，否则规则永远命不中
  if (rule.scope !== undefined && rule.scope.type !== RuleScopeType.AllTabs && rule.scope.targets.length === 0) {
    return { field: 'scope', message: `请至少选择一个${RULE_SCOPE_TYPE_LABELS[rule.scope.type].replace('指定', '')}` };
  }
  /** 当前选择的 DNR 路由动作数量。 */
  const exclusiveDnrCount = rule.actions.filter((action) => EXCLUSIVE_DNR_ACTIONS.includes(action.type as (typeof EXCLUSIVE_DNR_ACTIONS)[number])).length;
  if (exclusiveDnrCount > 1) return { field: 'actions', message: '拦截、重定向和参数注入只能选择其中一项' };
  for (const action of rule.actions) {
    if (action.type === RuleActionType.Redirect) {
      if (!action.redirectUrl.trim()) return { field: actionFieldKey(action.type), message: '重定向目标不能为空' };
      // 正则匹配可用 \1 等捕获组动态拼装目标，无法静态判定为合法 URL，此处放行
      if (rule.matchType !== MatchType.Regex && !isAbsoluteHttpUrl(action.redirectUrl)) return { field: actionFieldKey(action.type), message: '重定向目标需为绝对地址，如 http://127.0.0.1:4317/api/redirect-target.json' };
    }
    if (action.type === RuleActionType.InsertScript && !action.code.trim()) return { field: actionFieldKey(action.type), message: '注入代码不能为空' };
    if (action.type === RuleActionType.MockResponse) {
      if (action.statusCode < 100 || action.statusCode > 599) return { field: actionFieldKey(action.type), message: 'Mock 状态码需在 100 - 599 之间' };
      // 扩展页禁用 eval，无法在保存时静态执行/编译校验动态函数；以完整命名函数模板降低写错概率，运行期错误由运行时兜底
      if (action.mode === MockResponseMode.Dynamic && !action.functionCode?.trim()) return { field: actionFieldKey(action.type), message: '动态 Mock 函数不能为空' };
    }
    if (action.type === RuleActionType.ModifyRequestBody) {
      if (action.sourceMode === RequestBodySourceMode.Static && !action.content.trim()) return { field: actionFieldKey(action.type), message: '请求体内容不能为空' };
      if (action.sourceMode === RequestBodySourceMode.Dynamic && !action.functionCode?.trim()) return { field: actionFieldKey(action.type), message: '请求体函数不能为空' };
    }
  }
  return null;
}

/**
 * 规则编辑器：先选「执行动作」明确要做什么，再配「命中条件」明确对谁生效。
 * 执行通道由动作类型自动推导，方法可选集随动作收敛，用户无需感知底层通道。
 * @param props 编辑器参数
 */
export default function RuleEditor({ rule, isNew, groups, groupId, onSave, onCancel }: RuleEditorProps) {
  /** 编辑中的规则草稿。 */
  const [draft, setDraft] = useState<Rule>(() => structuredClone(rule));
  /** 保存目标分组。 */
  const [targetGroupId, setTargetGroupId] = useState(groupId);
  /** 表单校验错误（含定位字段）。 */
  const [error, setError] = useState<ValidationError | null>(null);
  /** 主从面板中当前聚焦、正在配置的动作类型；null 表示尚无动作。 */
  const [focusedActionType, setFocusedActionType] = useState<RuleActionType | null>(() => draft.actions[0]?.type ?? null);
  /** 左栏当前展示的执行通道 tab（网络层 / 页面内补丁）。 */
  const [channelTab, setChannelTab] = useState<RuleExecutionChannel>(() => draft.channel);
  /** 高级条件面板（请求体匹配 / 作用域）是否展开；已配置任一条件时默认展开。 */
  const [advancedOpen, setAdvancedOpen] = useState(() => draft.bodyMatch !== undefined || draft.scope !== undefined);
  // 草稿或目标分组一经改动即清除上次校验错误，避免用户修好后仍残留旧提示
  useEffect(() => { setError(null); }, [draft, targetGroupId]);
  /** 各校验字段的滚动锚点：key 与 validateRule 返回的 field 对齐。 */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  /**
   * 生成注册某个字段锚点的 ref 回调。
   * @param key 字段锚点 key
   * @returns 写入 fieldRefs 的 ref 回调
   */
  const registerField = (key: string) => (element: HTMLElement | null): void => { fieldRefs.current[key] = element; };
  /**
   * 替换或新增单个动作。
   * @param next 下一个动作
   */
  const setAction = (next: RuleAction): void => setDraft({ ...draft, actions: draft.actions.some((action) => action.type === next.type) ? draft.actions.map((action) => action.type === next.type ? next : action) : [...draft.actions, next] });
  /**
   * 切换请求方法；方法可选集已由动作收敛，此处只做纯粹的增删。
   * @param method 目标方法
   */
  const toggleMethod = (method: HttpMethod): void => {
    /** 切换后的方法列表。 */
    const methods = draft.methods.includes(method) ? draft.methods.filter((item) => item !== method) : [...draft.methods, method];
    setDraft({ ...draft, methods });
  };
  // 请求体条件仅页面补丁通道能读到请求体；按页面 URL 命中的脚本注入也没有可匹配的请求体
  /** 当前规则是否支持请求体匹配条件。 */
  const supportsBodyMatch = draft.channel === RuleExecutionChannel.PagePatch && !draft.actions.some((action) => action.type === RuleActionType.InsertScript);
  /**
   * 更新请求体匹配条件；传 undefined 表示关闭条件。
   * @param bodyMatch 新的请求体匹配条件
   */
  const setBodyMatch = (bodyMatch: BodyMatcher | undefined): void => setDraft({ ...draft, bodyMatch });
  /**
   * 更新作用域条件；传 undefined 表示不限制（全部标签页）。
   * @param scope 新的作用域条件
   */
  const setScope = (scope: RuleScope | undefined): void => setDraft({ ...draft, scope });
  /**
   * 切换动作显示；动作所属通道由动作类型自动推导，并同步收敛请求方法。
   * @param type 动作类型
   */
  const toggleAction = (type: RuleActionType): void => {
    /** 该动作所属的执行通道。 */
    const channel = DNR_ACTIONS.includes(type as (typeof DNR_ACTIONS)[number])
      ? RuleExecutionChannel.Dnr
      : RuleExecutionChannel.PagePatch;
    /** 当前动作是否已启用。 */
    const active = draft.actions.some((action) => action.type === type);
    if (active) {
      setDraft({ ...draft, actions: draft.actions.filter((action) => action.type !== type) });
      return;
    }
    // 新增动作后聚焦到它、并把左栏 tab 切到其所属通道，主从面板右侧立即展示其配置
    setFocusedActionType(type);
    setChannelTab(channel);
    if (type === RuleActionType.InsertScript) {
      setDraft({ ...draft, channel: RuleExecutionChannel.PagePatch, methods: [HttpMethod.Get], actions: [createAction(type)] });
      return;
    }
    /** 去除不能与按请求匹配动作共存的脚本注入动作。 */
    const compatibleActions = draft.actions.filter((action) => !EXCLUSIVE_PAGE_ACTIONS.includes(action.type as (typeof EXCLUSIVE_PAGE_ACTIONS)[number]));
    /** 选择改请求体后，自动收敛为可携带 body 的 POST 请求。 */
    const methods = type === RuleActionType.ModifyRequestBody && !isActionSupportedByMethods(type, draft.methods)
      ? [HttpMethod.Post]
      : draft.methods;
    if (channel !== draft.channel) {
      setDraft({ ...draft, channel, methods, actions: [createAction(type)] });
      return;
    }
    /** 新的动作集合。 */
    const actions = EXCLUSIVE_DNR_ACTIONS.includes(type as (typeof EXCLUSIVE_DNR_ACTIONS)[number])
      ? [...compatibleActions.filter((action) => !EXCLUSIVE_DNR_ACTIONS.includes(action.type as (typeof EXCLUSIVE_DNR_ACTIONS)[number])), createAction(type)]
      : [...compatibleActions, createAction(type)];
    setDraft({ ...draft, methods, actions });
  };
  /**
   * 从动作配置卡中删除动作。
   * @param type 要删除的动作类型
   */
  const removeAction = (type: RuleActionType): void => {
    setDraft({ ...draft, actions: draft.actions.filter((action) => action.type !== type) });
  };
  /**
   * 执行保存。
   */
  const handleSave = (): void => {
    // 通道 / 动作变化后可能残留不再适用的请求体条件，保存前统一剥离，避免带着隐藏条件落库
    /** 剥离不适用请求体条件后的规则草稿。 */
    const normalized = { ...draft };
    if (!supportsBodyMatch) delete normalized.bodyMatch;
    // 作用域为「全部标签页」等价于不限制，归一化为无作用域，避免落库空目标条件
    if (normalized.scope && normalized.scope.type === RuleScopeType.AllTabs) delete normalized.scope;
    /** 校验结果。 */
    const validation = validateRule(normalized);
    if (validation) {
      setError(validation);
      // 出错项在高级面板内（请求体匹配 / 作用域）时先展开面板，否则字段未挂载滚不到、也看不见标红
      if (validation.field === 'bodyMatch' || validation.field === 'scope') {
        setAdvancedOpen(true);
      }
      // 出错项是某个动作时，先聚焦它、并把左栏 tab 切到其通道——右侧仅挂载当前 tab 的聚焦动作，不切过去就滚不到
      if (validation.field.startsWith('action:')) {
        /** 出错动作的类型。 */
        const erroredType = validation.field.slice('action:'.length) as RuleActionType;
        setFocusedActionType(erroredType);
        setChannelTab(DNR_ACTIONS.includes(erroredType as (typeof DNR_ACTIONS)[number]) ? RuleExecutionChannel.Dnr : RuleExecutionChannel.PagePatch);
      }
      // 等标红渲染后再滚动定位到出错项，居中显示便于用户立即看到
      requestAnimationFrame(() => fieldRefs.current[validation.field]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    onSave(normalized, targetGroupId);
  };

  /** 高级面板内已配置的条件摘要，折叠时显示，便于发现隐藏其中的条件。 */
  const advancedSummary = [
    ...(supportsBodyMatch && draft.bodyMatch ? ['请求体匹配'] : []),
    ...(draft.scope ? [RULE_SCOPE_TYPE_LABELS[draft.scope.type]] : []),
  ].join(' · ');

  return <div className="flex max-h-[82vh] min-h-0 flex-1 flex-col overflow-hidden">
    <DialogHeader><DialogTitle>{isNew ? '新建规则' : '编辑规则'}</DialogTitle></DialogHeader>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">

      {/* 基本信息：所属分组与规则名称同行排列 */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="所属分组"><Select value={targetGroupId} onValueChange={setTargetGroupId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="规则名称" error={error?.field === 'name' ? error.message : undefined} innerRef={registerField('name')}><Input aria-invalid={error?.field === 'name'} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      </div>

      {/* 第一步：这条规则要做什么（动作工作台自带通道标签页，无需额外标题） */}
      <section className="space-y-4">
        <div ref={registerField('actions')}>
          <ActionWorkbench
            draft={draft}
            focusedType={focusedActionType}
            channelTab={channelTab}
            onChannelTab={setChannelTab}
            onToggle={toggleAction}
            onFocus={setFocusedActionType}
            onChange={setAction}
            onRemove={removeAction}
            errorField={error?.field}
            errorMessage={error?.message}
            registerField={registerField}
          />
          {error?.field === 'actions' && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
        </div>
      </section>

      {/* 第二步：对哪些请求生效 */}
      <section className="space-y-4">
        {/* 匹配方式与匹配内容各占一行，与请求方法 / 请求体匹配的行式布局保持一致 */}
        <Field label="匹配方式"><Select value={draft.matchType} onValueChange={(value) => setDraft({ ...draft, matchType: value as MatchType })}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger><SelectContent>{Object.values(MatchType).map((type) => <SelectItem key={type} value={type}>{MATCH_TYPE_LABELS[type]}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="匹配内容" error={error?.field === 'pattern' ? error.message : undefined} innerRef={registerField('pattern')}>
          <div className="flex items-center gap-2">
            <Input className="flex-1" aria-invalid={error?.field === 'pattern'} value={draft.pattern} onChange={(event) => setDraft({ ...draft, pattern: event.target.value })} />
            <MatchTester draft={draft} />
          </div>
        </Field>
        <Field label="请求方法" error={error?.field === 'methods' ? error.message : undefined} innerRef={registerField('methods')}><MethodPicker draft={draft} onToggle={toggleMethod} onSelectAll={() => setDraft({ ...draft, methods: [] })} /></Field>

        {/* 高级（选填）：请求体匹配 / 作用域，默认折叠，收纳不常用的收敛条件 */}
        <div className="rounded-lg border border-border">
          <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={advancedOpen}>
            <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${advancedOpen ? '' : '-rotate-90'}`} />
            <span className="text-sm font-medium">高级</span>
            <span className="text-xs text-muted-foreground">选填</span>
            {/* 折叠时展示已配置条件摘要，避免隐藏在里面的条件被忽略 */}
            {!advancedOpen && advancedSummary && <span className="ml-auto truncate text-xs text-primary">{advancedSummary}</span>}
          </button>
          {advancedOpen && (
            <div className="space-y-4 border-t border-border px-3 py-4">
              {supportsBodyMatch && (
                <Field label="请求体匹配" error={error?.field === 'bodyMatch' ? error.message : undefined} innerRef={registerField('bodyMatch')}>
                  <BodyMatchEditor value={draft.bodyMatch} invalid={error?.field === 'bodyMatch'} onChange={setBodyMatch} />
                </Field>
              )}
              <Field label="作用域" error={error?.field === 'scope' ? error.message : undefined} innerRef={registerField('scope')}>
                <ScopeEditor value={draft.scope} invalid={error?.field === 'scope'} onChange={setScope} />
              </Field>
            </div>
          )}
        </div>
      </section>
    </div>
    <DialogFooter><Button variant="outline" onClick={onCancel}>取消</Button><Button onClick={handleSave}>保存</Button></DialogFooter>
  </div>;
}

interface MatchTesterProps {
  /** 当前规则草稿，用于命中判断与效果预览。 */
  draft: Rule;
}

/**
 * 命中测试：匹配内容右侧的「测试」按钮，点开后弹出气泡，气泡内输入测试路径并执行命中判断。
 * @param props 命中测试参数
 */
function MatchTester({ draft }: MatchTesterProps) {
  /** 气泡是否展开。 */
  const [open, setOpen] = useState(false);
  /** 测试输入的 URL（首次按当前匹配模式预填）。 */
  const [testUrl, setTestUrl] = useState(() => guessTestUrl(draft.pattern, draft.matchType));
  /** 最近一次测试结果；null 表示尚未测试。 */
  const [result, setResult] = useState<TestResult | null>(null);
  /** 测试区根节点，用于点击外部时收起气泡。 */
  const rootRef = useRef<HTMLDivElement>(null);

  // 气泡展开时，点击气泡外部或按 Esc 收起
  useEffect(() => {
    if (!open) return;
    /** 点击测试区外部则收起气泡。 */
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    /** 按 Esc 收起气泡。 */
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /** 用当前草稿对测试 URL 做命中判断并生成效果预览。 */
  const handleTest = (): void => {
    /** 测试 URL 是否命中草稿的匹配条件。 */
    const matched = matchUrl(testUrl, draft.matchType, draft.pattern);
    setResult({ matched, effect: matched ? describeEffect(draft) : '' });
  };

  return <div ref={rootRef} className="relative shrink-0">
    <Button type="button" variant="outline" size="icon" aria-label="命中测试" title="命中测试" onClick={() => setOpen((value) => !value)}>
      <FlaskConical className="size-4" />
    </Button>
    {open && (
      <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            className="h-8 flex-1 font-mono text-xs"
            placeholder="输入测试路径 / URL"
            value={testUrl}
            onChange={(event) => setTestUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') handleTest(); }}
          />
          <Button type="button" size="sm" className="shrink-0" onClick={handleTest}>测试</Button>
        </div>
        {result && (
          <div className={`mt-2 flex items-start gap-1.5 text-xs leading-relaxed ${result.matched ? 'text-success' : 'text-muted-foreground'}`}>
            {result.matched ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
            <span className="min-w-0 break-all">
              {result.matched
                ? <><strong className="font-medium text-foreground">命中</strong>：{result.effect}</>
                : '未命中，该 URL 不会被此规则处理'}
            </span>
          </div>
        )}
      </div>
    )}
  </div>;
}

interface ActionWorkbenchProps {
  /** 当前规则草稿。 */
  draft: Rule;
  /** 当前聚焦、正在配置的动作类型。 */
  focusedType: RuleActionType | null;
  /** 左栏当前展示的执行通道 tab。 */
  channelTab: RuleExecutionChannel;
  /** 切换执行通道 tab 的回调。 */
  onChannelTab: (channel: RuleExecutionChannel) => void;
  /** 勾选 / 取消动作的回调。 */
  onToggle: (type: RuleActionType) => void;
  /** 切换聚焦动作的回调。 */
  onFocus: (type: RuleActionType) => void;
  /** 动作字段更新回调。 */
  onChange: (action: RuleAction) => void;
  /** 删除动作的回调。 */
  onRemove: (type: RuleActionType) => void;
  /** 当前校验错误定位的字段 key。 */
  errorField?: string;
  /** 当前校验错误文案。 */
  errorMessage?: string;
  /** 注册字段滚动锚点的工厂。 */
  registerField: (key: string) => (element: HTMLElement | null) => void;
}

/**
 * 动作工作台：左列把「选择器」与「已选动作 master」合二为一——按作用范围分组列出全部动作，
 * 勾选态即选中态，点击已选行切换右列配置（detail）。右列只渲染聚焦动作的编辑器，高度只由单个动作决定。
 * @param props 工作台参数
 */
function ActionWorkbench({ draft, focusedType, channelTab, onChannelTab, onToggle, onFocus, onChange, onRemove, errorField, errorMessage, registerField }: ActionWorkbenchProps) {
  /** 当前 tab 对应的动作分组。 */
  const currentGroup = ACTION_GROUPS.find((group) => group.channel === channelTab) ?? ACTION_GROUPS[0];
  /** 实际聚焦的动作类型：focusedType 缺省或已被移除时回退到首个动作。 */
  const activeType = draft.actions.some((action) => action.type === focusedType) ? focusedType : draft.actions[0]?.type ?? null;
  /** 当前聚焦的动作对象。 */
  const focusedAction = draft.actions.find((action) => action.type === activeType);
  // 选中动作与通道一一对应，右列只在「当前 tab 属于聚焦动作所在通道」时渲染其编辑器，否则给引导
  /** 右列要渲染的动作对象；聚焦动作不在当前 tab 时为空。 */
  const activeAction = focusedAction && currentGroup.types.includes(focusedAction.type) ? focusedAction : undefined;
  /** 聚焦动作的校验错误文案。 */
  const activeError = activeAction && errorField === actionFieldKey(activeAction.type) ? errorMessage : undefined;
  return <div className="rounded-lg border border-border">
    {/* 通道 tab：横跨整个面板作为标题头，网络层 / 页面内补丁二选一 */}
    <div className="flex gap-1 border-b border-border px-2 pt-2">
      {ACTION_GROUPS.map((group) => {
        /** 该通道是否为当前 tab。 */
        const activeTab = group.channel === channelTab;
        /** 选中动作落在「另一个（非当前）」通道时，用小圆点提示选择在别的 tab。 */
        const hasSelection = !activeTab && draft.actions.length > 0 && draft.channel === group.channel;
        return <button key={group.channel} type="button" onClick={() => onChannelTab(group.channel)} className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${activeTab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {group.title}
          {/* 通道说明 + 组合约束：文字右侧 info 图标，悬停浮出气泡 */}
          <span className="group/hint relative inline-flex">
            <Info className="size-3 text-muted-foreground" />
            <span className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-64 space-y-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/hint:opacity-100">
              <span className="block">{group.hint}</span>
              <span className="block text-muted-foreground">{group.note}</span>
            </span>
          </span>
          {hasSelection && <span className="size-1.5 rounded-full bg-primary" />}
          {/* 当前 tab 的底部下划线，压在面板顶边上 */}
          {activeTab && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
        </button>;
      })}
    </div>
    {/* 双栏：左列该通道动作清单（选择器 + master），右列聚焦动作配置（detail） */}
    <div className="grid grid-cols-[224px_1fr] gap-4 p-3">
      <div className="flex flex-col border-r border-border pr-3">
        <div className="flex flex-col gap-0.5">
          {currentGroup.types.map((type) => {
            /** 该动作已选中的动作对象（未选中为空）。 */
            const selectedAction = draft.actions.find((action) => action.type === type);
            /** 该动作是否为当前聚焦项。 */
            const active = type === activeType;
            /** 该动作是否存在校验错误。 */
            const hasError = errorField === actionFieldKey(type);
            // 行本身不能嵌套按钮，故拆成「主区按钮 + 删除按钮」两个兄弟节点，外层 div 承载选中/悬停底色
            return <div key={type} className={`group flex items-center rounded-md pr-1 transition-colors ${active ? 'bg-primary/10' : 'hover:bg-muted/50'}`}>
              {/* 主区：未选中 → 勾选并聚焦（onToggle 内部会聚焦）；已选中 → 仅切换聚焦 */}
              <button type="button" onClick={() => selectedAction ? onFocus(type) : onToggle(type)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left">
                {hasError
                  ? <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                  : <Check className={`size-3.5 shrink-0 ${selectedAction ? 'text-primary' : 'text-transparent'}`} />}
                <span className={`truncate text-sm font-medium ${selectedAction ? 'text-foreground' : 'text-muted-foreground'}`}>{RULE_ACTION_TYPE_LABELS[type]}</span>
                {/* 动作说明移入 hover 气泡：默认展示动作用途，已选时展示当前配置预览 */}
                <span className="group/desc relative inline-flex shrink-0">
                  <Info className="size-3 text-muted-foreground" />
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-56 rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/desc:opacity-100">
                    {selectedAction ? describeAction(selectedAction) : ACTION_DESCRIPTIONS[type]}
                  </span>
                </span>
              </button>
              {/* 删除入口：仅已选动作可删；聚焦行常显，其余行悬停浮现 */}
              {selectedAction && (
                <button type="button" title={`删除${RULE_ACTION_TYPE_LABELS[type]}`} onClick={() => onRemove(type)} className={`shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:text-destructive ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">删除动作</span>
                </button>
              )}
            </div>;
          })}
        </div>
      </div>
      {/* 右列：聚焦动作的参数编辑器（detail）；当前 tab 未选任何动作时给出引导 */}
      <div className="min-w-0">
        {activeAction
          ? <ActionEditor key={activeAction.type} action={activeAction} onChange={onChange} error={activeError} innerRef={registerField(actionFieldKey(activeAction.type))} />
          : <div className="flex h-full min-h-[120px] items-center justify-center text-center text-xs text-muted-foreground">{`勾选一个「${currentGroup.title}」动作开始配置`}</div>}
      </div>
    </div>
  </div>;
}

interface MethodPickerProps {
  /** 当前规则草稿。 */
  draft: Rule;
  /** 单个方法切换回调。 */
  onToggle: (method: HttpMethod) => void;
  /** 选择「全部方法」（清空方法列表）回调。 */
  onSelectAll: () => void;
}

/**
 * 请求方法选择器：可选集随已选动作收敛，用户不会构造出非法组合。
 * @param props 方法选择器参数
 */
function MethodPicker({ draft, onToggle, onSelectAll }: MethodPickerProps) {
  /** 当前是否仅为按页面 URL 命中的脚本注入。 */
  const isScriptOnly = draft.actions.length === 1 && draft.actions[0].type === RuleActionType.InsertScript;
  if (isScriptOnly) {
    return <p className="pt-2 text-sm text-muted-foreground">脚本注入按页面 URL 命中，无需配置请求方法。</p>;
  }
  /** 当前是否包含改请求体动作。 */
  const hasRequestBody = draft.actions.some((action) => action.type === RuleActionType.ModifyRequestBody);
  /** 依据动作收敛后的可选方法集：改请求体仅保留可携带 body 的方法。 */
  const methods: readonly HttpMethod[] = hasRequestBody ? BODY_METHODS : Object.values(HttpMethod);
  return <div>
    <div className="flex flex-wrap gap-2">
      {!hasRequestBody && <Button size="sm" variant={draft.methods.length === 0 ? 'default' : 'outline'} onClick={onSelectAll}>全部</Button>}
      {methods.map((method) => <Button key={method} size="sm" variant={draft.methods.includes(method) ? 'default' : 'outline'} onClick={() => onToggle(method)}>{method}</Button>)}
    </div>
    {hasRequestBody && <p className="mt-1.5 text-xs text-muted-foreground">改请求体只作用于可携带请求体的方法，已自动排除 GET / HEAD 与「全部」。</p>}
  </div>;
}

interface BodyMatchEditorProps {
  /** 当前请求体匹配条件；undefined 表示未启用。 */
  value?: BodyMatcher;
  /** 值输入框是否标红（校验失败）。 */
  invalid?: boolean;
  /** 条件变更回调；传 undefined 表示关闭条件。 */
  onChange: (value: BodyMatcher | undefined) => void;
}

/**
 * 请求体命中条件编辑器：在 URL + 方法之外，按请求体子串 / 正则 / GraphQL 操作名进一步收敛。
 * 选「不限制请求体」即关闭条件；切换匹配方式时保留已填的匹配值。
 * @param props 请求体条件、校验标红与变更回调
 */
function BodyMatchEditor({ value, invalid, onChange }: BodyMatchEditorProps) {
  return <div className="space-y-1.5">
    <div className="flex items-center gap-2">
      <Select value={value?.type ?? BODY_MATCH_OFF} onValueChange={(next) => onChange(next === BODY_MATCH_OFF ? undefined : { type: next as BodyMatchType, value: value?.value ?? '' })}>
        <SelectTrigger className="w-40 shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={BODY_MATCH_OFF}>不限制请求体</SelectItem>
          {Object.values(BodyMatchType).map((type) => <SelectItem key={type} value={type}>{BODY_MATCH_TYPE_LABELS[type]}</SelectItem>)}
        </SelectContent>
      </Select>
      {value && <Input className="flex-1 font-mono text-xs" aria-invalid={invalid} placeholder={BODY_MATCH_VALUE_PLACEHOLDERS[value.type]} value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })} />}
    </div>
    <p className="text-xs text-muted-foreground">只按页面脚本 fetch / XHR 的请求体收敛；GraphQL 同 URL 的多个操作可用「操作名」精确区分。</p>
  </div>;
}

/** 作用域选择器里一个可勾选的目标对象。 */
interface ScopeOption {
  /** 目标对象的浏览器运行时 ID（tabId / windowId / tabGroup id）。 */
  id: number;
  /** 展示标签。 */
  label: string;
  /** 次要说明（如 URL、标签页数、分组颜色）。 */
  hint?: string;
}

/**
 * 加载指定作用域类型当前可选的目标对象。
 * @param type 作用域类型
 * @returns 当前打开的标签页 / 窗口 / 标签组选项列表
 */
async function loadScopeOptions(type: RuleScopeType): Promise<ScopeOption[]> {
  if (type === RuleScopeType.Tab) {
    /** 当前全部标签页。 */
    const tabs = await browser.tabs.query({});
    return tabs
      .filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined)
      .map((tab) => ({ id: tab.id, label: tab.title?.trim() || tab.url || `标签页 #${tab.id}`, hint: tab.url }));
  }
  if (type === RuleScopeType.Window) {
    /** 当前全部窗口（含标签页以便统计数量）。 */
    const windows = await browser.windows.getAll({ populate: true });
    return windows
      .filter((win): win is typeof win & { id: number } => win.id !== undefined)
      .map((win, index) => ({
        id: win.id,
        label: `窗口 ${index + 1}`,
        hint: `${win.tabs?.length ?? 0} 个标签页${win.focused ? ' · 当前' : ''}`,
      }));
  }
  if (type === RuleScopeType.TabGroup) {
    // tabGroups 在部分浏览器（如 Firefox）不可用，缺失时返回空列表
    if (!browser.tabGroups) return [];
    /** 当前全部标签组。 */
    const groups = await browser.tabGroups.query({});
    return groups.map((group) => ({ id: group.id, label: group.title?.trim() || '未命名标签组', hint: group.color }));
  }
  return [];
}

interface ScopeEditorProps {
  /** 当前作用域条件；undefined 表示全部标签页（不限制）。 */
  value?: RuleScope;
  /** 目标列表是否标红（校验失败）。 */
  invalid?: boolean;
  /** 作用域变更回调；传 undefined 表示不限制。 */
  onChange: (value: RuleScope | undefined) => void;
}

/**
 * 作用域选择器：把规则的生效范围限定到具体的标签页 / 窗口 / 标签组。
 *
 * 编辑器是整页、没有「当前标签」上下文，故实时查询当前打开的对象供勾选；ID 是会话级的，
 * 已选但当前已关闭的目标仍保留展示并标注失效，方便用户识别与清理。
 * @param props 作用域条件、校验标红与变更回调
 */
function ScopeEditor({ value, invalid, onChange }: ScopeEditorProps) {
  /** 当前作用域类型（缺省为全部标签页）。 */
  const type = value?.type ?? RuleScopeType.AllTabs;
  /** 当前已选目标对象。 */
  const targets = value?.targets ?? [];
  /** 当前类型下可选的目标对象。 */
  const [options, setOptions] = useState<ScopeOption[]>([]);
  /** 是否正在加载可选对象。 */
  const [loading, setLoading] = useState(false);

  /**
   * 加载某个作用域类型当前可选的目标对象。
   * @param nextType 作用域类型
   */
  const refresh = useCallback(async (nextType: RuleScopeType): Promise<void> => {
    if (nextType === RuleScopeType.AllTabs) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      setOptions(await loadScopeOptions(nextType));
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 类型变化时重新拉取可选对象
  useEffect(() => { void refresh(type); }, [type, refresh]);

  /**
   * 切换作用域类型。
   * @param next 目标类型
   */
  const handleTypeChange = (next: string): void => {
    /** 切换后的作用域类型。 */
    const nextType = next as RuleScopeType;
    if (nextType === RuleScopeType.AllTabs) {
      onChange(undefined);
      return;
    }
    // 不同类型的 ID 空间不通用，切换类型时清空已选目标
    onChange({ type: nextType, targets: [] });
  };

  /**
   * 勾选 / 取消一个目标对象。
   * @param option 目标对象
   */
  const toggleTarget = (option: ScopeOption): void => {
    if (type === RuleScopeType.AllTabs) return;
    /** 该对象是否已选中。 */
    const exists = targets.some((target) => target.id === option.id);
    /** 切换后的目标列表。 */
    const nextTargets: ScopeTarget[] = exists
      ? targets.filter((target) => target.id !== option.id)
      : [...targets, { id: option.id, label: option.label }];
    onChange({ type, targets: nextTargets });
  };

  /** 当前可选对象的 ID 集合，用于识别已选但已关闭的目标。 */
  const availableIds = new Set(options.map((option) => option.id));
  /** 已选但当前不在可选列表里的目标（可能已关闭 / 失效）。 */
  const staleTargets = targets.filter((target) => !availableIds.has(target.id));
  /** 合并可选对象与失效已选目标后的展示行。 */
  const rows: Array<ScopeOption & { stale: boolean }> = [
    ...options.map((option) => ({ ...option, stale: false })),
    ...staleTargets.map((target) => ({ id: target.id, label: target.label, hint: undefined, stale: true })),
  ];

  return <div className="space-y-1.5">
    <div className="flex items-center gap-2">
      <Select value={type} onValueChange={handleTypeChange}>
        <SelectTrigger className="w-40 shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.values(RuleScopeType).map((scopeType) => <SelectItem key={scopeType} value={scopeType}>{RULE_SCOPE_TYPE_LABELS[scopeType]}</SelectItem>)}
        </SelectContent>
      </Select>
      {type !== RuleScopeType.AllTabs && (
        <Button type="button" variant="outline" size="icon" title="刷新列表" onClick={() => void refresh(type)}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      )}
    </div>
    {type !== RuleScopeType.AllTabs && (
      <div className={`max-h-48 overflow-y-auto rounded-md border ${invalid ? 'border-destructive' : 'border-border'}`}>
        {loading && rows.length === 0
          ? <p className="px-3 py-4 text-center text-xs text-muted-foreground">加载中…</p>
          : rows.length === 0
            ? <p className="px-3 py-4 text-center text-xs text-muted-foreground">没有可选对象，请先打开对应的标签页 / 窗口 / 标签组</p>
            : rows.map((row) => {
                /** 该对象是否已选中。 */
                const selected = targets.some((target) => target.id === row.id);
                return <button key={row.id} type="button" onClick={() => toggleTarget(row)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50">
                  <Check className={`size-3.5 shrink-0 ${selected ? 'text-primary' : 'text-transparent'}`} />
                  <span className="min-w-0 flex-1 truncate text-sm" title={row.hint ?? row.label}>{row.label}</span>
                  {row.stale
                    ? <span className="shrink-0 text-[11px] text-warning">已关闭</span>
                    : row.hint && <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">{row.hint}</span>}
                </button>;
              })}
      </div>
    )}
    <p className="text-xs text-muted-foreground">
      {type === RuleScopeType.AllTabs
        ? '默认对所有标签页生效。限定作用域可避免把敏感 Header（如 Authorization）误发到其他站点。'
        : `${RULE_SCOPE_EMPTY_HINTS[type]}；对象 ID 为会话级，浏览器重启后需重新选择。`}
    </p>
  </div>;
}

interface ActionEditorProps {
  /** 当前动作。 */
  action: RuleAction;
  /** 动作字段更新回调。 */
  onChange: (action: RuleAction) => void;
  /** 该动作的校验错误文案，非空时卡片标红。 */
  error?: string;
  /** 滚动定位锚点。 */
  innerRef?: Ref<HTMLDivElement>;
}

/**
 * 判断动作的取值字段是否需要在「标题行」展示动态变量提示。
 *
 * 仅覆盖非代码编辑器的取值字段：重定向 URL、注入参数值、Header 值。
 * 静态 Mock 响应体与静态改请求体也支持动态变量，但它们用 CodeEditor，提示改放在编辑器右上角（headerEnd）。
 * @param action 当前动作
 * @returns 需要在标题行展示提示时返回 true
 */
function actionSupportsDynamicVariables(action: RuleAction): boolean {
  switch (action.type) {
    case RuleActionType.Redirect:
    case RuleActionType.InjectParams:
    case RuleActionType.ModifyHeaders:
      return true;
    default:
      return false;
  }
}

/**
 * 单一动作的参数编辑器。删除入口已移至左栏动作行，故此处只留标题与参数。
 * @param props 动作、更新回调、校验错误与滚动锚点
 */
function ActionEditor({ action, onChange, error, innerRef }: ActionEditorProps) {
  // 常态无边框（外层主从面板已提供边框），仅出错时标红，避免双层边框
  return <div ref={innerRef} className={`min-w-0 ${error ? 'rounded-lg border border-destructive px-3 py-2' : ''}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{RULE_ACTION_TYPE_LABELS[action.type]}</span>{actionSupportsDynamicVariables(action) && <DynamicVariableHint />}</div><div className="mt-3">
    {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
    {action.type === RuleActionType.Redirect && <Input aria-invalid={!!error} value={action.redirectUrl} onChange={(event) => onChange({ ...action, redirectUrl: event.target.value })} />}
    {action.type === RuleActionType.InjectParams && <KeyValueEditor initialValue={action.params} onChange={(params) => onChange({ ...action, params })} />}
    {action.type === RuleActionType.ModifyHeaders && <HeadersEditor value={action.headers} onChange={(headers) => onChange({ ...action, headers })} />}
    {action.type === RuleActionType.MockResponse && <MockActionEditor action={action} onChange={onChange} />}
    {action.type === RuleActionType.Delay && <DelayActionEditor action={action} onChange={onChange} />}
    {action.type === RuleActionType.ModifyRequestBody && <RequestBodyActionEditor action={action} onChange={onChange} />}
    {action.type === RuleActionType.InsertScript && <InsertScriptActionEditor action={action} onChange={onChange} />}
  </div></div>;
}

/** Mock 参数编辑器。 */
function MockActionEditor({ action, onChange }: { action: Extract<RuleAction, { type: RuleActionType.MockResponse }>; onChange: (action: RuleAction) => void; }) {
  /** 当前是否为静态响应体模式。 */
  const isStatic = action.mode === MockResponseMode.Static;
  /** 静态模式的响应体类型（缺省 JSON，兼容旧数据）。 */
  const bodyType = action.bodyType ?? DEFAULT_MOCK_BODY_TYPE;
  /** 仅在 JSON 类型下才把「非合法 JSON」当作提示——其他类型本就允许任意文本。 */
  const invalidJsonBody = isStatic && bodyType === MockBodyType.Json && action.body.trim().length > 0 && !isValidJson(action.body);
  /** 编辑器高亮语言：动态模式为 JS；静态模式按响应体类型映射（HTML/XML/文本回退纯文本）。 */
  const editorLanguage: CodeEditorLanguage = isStatic ? MOCK_BODY_TYPE_EDITOR_LANGUAGE[bodyType] : 'javascript';
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <Select value={action.mode} onValueChange={(value) => onChange({ ...action, mode: value as MockResponseMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.values(MockResponseMode).map((mode) => <SelectItem key={mode} value={mode}>{MOCK_RESPONSE_MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select>
      <Input type="number" value={action.statusCode} onChange={(event) => onChange({ ...action, statusCode: Number(event.target.value) })} />
    </div>
    {/* 静态模式：把响应体类型下拉塞进编辑器左上角（替代语言名标签），切换后同步驱动高亮与交付时的 Content-Type */}
    <CodeEditor
      language={editorLanguage}
      value={isStatic ? action.body : action.functionCode ?? ''}
      onChange={(next) => onChange(isStatic ? { ...action, body: next } : { ...action, functionCode: next })}
      headerStart={isStatic
        ? <Select value={bodyType} onValueChange={(value) => onChange({ ...action, bodyType: value as MockBodyType })}>
            <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1 py-0 text-[11px] font-medium text-muted-foreground shadow-none hover:text-foreground focus:border-0 focus:ring-0" aria-label="响应体类型"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.values(MockBodyType).map((type) => <SelectItem key={type} value={type}>{MOCK_BODY_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
          </Select>
        : undefined}
      headerEnd={isStatic ? <DynamicVariableHint /> : undefined}
    />
    {invalidJsonBody && <p className="text-xs text-warning">响应体不是合法 JSON；若要返回其他格式，请切换上方「响应体类型」。</p>}
    {!isStatic && <p className="text-xs text-muted-foreground">动态代码可读取 req.url、req.method、req.headers、req.query、req.body、req.json。</p>}
  </div>;
}

/** 限速参数编辑器。 */
function DelayActionEditor({ action, onChange }: { action: Extract<RuleAction, { type: RuleActionType.Delay }>; onChange: (action: RuleAction) => void; }) {
  /**
   * 切换预设并同步对应参数。
   * @param value 预设值
   */
  const changePreset = (value: string): void => {
    /** 新预设。 */
    const preset = value as NetworkThrottlePreset;
    /** 非自定义预设的固定参数。 */
    const settings = preset === NetworkThrottlePreset.Custom ? undefined : NETWORK_THROTTLE_PRESET_SETTINGS[preset];
    onChange({ ...action, throttlePreset: preset, ...(settings ?? {}) });
  };
  /**
   * 手动修改延迟/带宽字段。预设档位在运行时只认固定常量，因此任何手填都必须同步切到「自定义」，否则填入的值会被静默忽略。
   * @param patch 待写入的字段增量（latencyMs / downloadKbps / uploadKbps）
   */
  const editField = (patch: Partial<Pick<typeof action, 'latencyMs' | 'downloadKbps' | 'uploadKbps'>>): void => {
    onChange({ ...action, throttlePreset: NetworkThrottlePreset.Custom, ...patch });
  };
  // 右栏 detail 列偏窄，四列并排会把「下行(KB/s)」等标签挤到放不下，改 2×2 每格更从容
  return <div className="grid grid-cols-2 gap-3">
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">网络档位</Label><Select value={action.throttlePreset} onValueChange={changePreset}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.values(NetworkThrottlePreset).map((preset) => <SelectItem key={preset} value={preset}>{NETWORK_THROTTLE_PRESET_LABELS[preset]}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">延迟(ms)</Label><Input type="number" min={0} value={action.latencyMs} onChange={(event) => editField({ latencyMs: Number(event.target.value) })} /></div>
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{`下行(${NETWORK_SPEED_DISPLAY_UNIT})`}</Label><Input type="number" min={0} step="0.1" value={kilobitsPerSecondToKilobytesPerSecond(action.downloadKbps)} onChange={(event) => editField({ downloadKbps: kilobytesPerSecondToKilobitsPerSecond(Number(event.target.value)) })} /></div>
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{`上行(${NETWORK_SPEED_DISPLAY_UNIT})`}</Label><Input type="number" min={0} step="0.1" value={kilobitsPerSecondToKilobytesPerSecond(action.uploadKbps)} onChange={(event) => editField({ uploadKbps: kilobytesPerSecondToKilobitsPerSecond(Number(event.target.value)) })} /></div>
  </div>;
}

/** 请求体参数编辑器。 */
function RequestBodyActionEditor({ action, onChange }: { action: Extract<RuleAction, { type: RuleActionType.ModifyRequestBody }>; onChange: (action: RuleAction) => void; }) {
  return <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Select value={action.sourceMode} onValueChange={(value) => onChange({ ...action, sourceMode: value as RequestBodySourceMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.values(RequestBodySourceMode).map((mode) => <SelectItem key={mode} value={mode}>{REQUEST_BODY_SOURCE_MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select>{action.sourceMode === RequestBodySourceMode.Static && <Select value={action.mode} onValueChange={(value) => onChange({ ...action, mode: value as RequestBodyMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.values(RequestBodyMode).map((mode) => <SelectItem key={mode} value={mode}>{REQUEST_BODY_MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select>}</div><CodeEditor language={action.sourceMode === RequestBodySourceMode.Dynamic ? 'javascript' : 'json'} value={action.sourceMode === RequestBodySourceMode.Dynamic ? action.functionCode ?? '' : action.content} onChange={(next) => onChange(action.sourceMode === RequestBodySourceMode.Dynamic ? { ...action, functionCode: next } : { ...action, content: next })} headerEnd={action.sourceMode === RequestBodySourceMode.Static ? <DynamicVariableHint /> : undefined} /><p className="text-xs text-muted-foreground">仅作用于 fetch / XHR 的可带请求体方法；异常或返回 undefined 时保留原请求体。</p></div>;
}

/** 脚本注入参数编辑器。 */
function InsertScriptActionEditor({ action, onChange }: { action: Extract<RuleAction, { type: RuleActionType.InsertScript }>; onChange: (action: RuleAction) => void; }) {
  return <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Select value={action.codeType} onValueChange={(value) => onChange({ ...action, codeType: value as InsertScriptCodeType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.values(InsertScriptCodeType).map((codeType) => <SelectItem key={codeType} value={codeType}>{INSERT_SCRIPT_CODE_TYPE_LABELS[codeType]}</SelectItem>)}</SelectContent></Select><Select value={action.timing} onValueChange={(value) => onChange({ ...action, timing: value as InsertScriptTiming })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.values(InsertScriptTiming).map((timing) => <SelectItem key={timing} value={timing}>{INSERT_SCRIPT_TIMING_LABELS[timing]}</SelectItem>)}</SelectContent></Select></div><CodeEditor language={action.codeType === InsertScriptCodeType.Css ? 'css' : 'javascript'} value={action.code} onChange={(next) => onChange({ ...action, code: next })} /></div>;
}
