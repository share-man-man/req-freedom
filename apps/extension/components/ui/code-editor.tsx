import { useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentRange,
  syntaxHighlighting,
} from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as editorPlaceholder,
} from '@codemirror/view';
import { cn } from '@/utils/cn';

/** 编辑器支持的代码语言；'text' 为无语法高亮的纯文本回退。 */
export type CodeEditorLanguage = 'json' | 'javascript' | 'css' | 'text';

/** CodeEditor 组件的属性。 */
interface CodeEditorProps {
  /** 受控的编辑器内容。 */
  value: string;
  /** 内容变更回调。 */
  onChange: (value: string) => void;
  /** 用于语法高亮与格式化的代码语言。 */
  language: CodeEditorLanguage;
  /** 空内容时显示的提示文字。 */
  placeholder?: string;
  /** 是否禁止编辑与格式化。 */
  disabled?: boolean;
  /** 附加到编辑器容器的样式类。 */
  className?: string;
  /** 编辑器的无障碍标签。 */
  ariaLabel?: string;
  /** 头部左上角自定义内容，传入时替代默认的语言名标签（如类型切换下拉）。 */
  headerStart?: ReactNode;
  /** 头部右上角自定义内容，渲染在「格式化」按钮左侧（如动态变量提示）。 */
  headerEnd?: ReactNode;
}

/** 编辑器语言的显示名称。 */
const CODE_EDITOR_LANGUAGE_LABELS: Readonly<Record<CodeEditorLanguage, string>> = {
  json: 'JSON',
  javascript: 'JavaScript',
  css: 'CSS',
  text: '文本',
};

/** CodeMirror 的基础按键与编辑能力。 */
const CODE_EDITOR_BASE_EXTENSIONS: readonly Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  history(),
  bracketMatching(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
];

/** 允许在组件挂载后异步加载并替换语言扩展的配置槽。 */
const CODE_EDITOR_LANGUAGE_COMPARTMENT = new Compartment();

/** 与扩展设置页设计令牌一致的 CodeMirror 外观。 */
const CODE_EDITOR_THEME = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    fontSize: '0.75rem',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.6',
    padding: '0.625rem 0',
  },
  '.cm-scroller': {
    maxHeight: '20rem',
    overflow: 'auto',
  },
  '.cm-line': {
    padding: '0 0.75rem',
  },
  '.cm-gutters': {
    color: 'var(--muted-foreground)',
    backgroundColor: 'var(--muted)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 10%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 28%, transparent)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--popover)',
  },
});

/**
 * 按需加载指定语言的 CodeMirror 扩展，避免未使用的语言进入主包。
 * @param language 目标代码语言。
 * @returns 对应语言的解析与高亮扩展。
 */
function loadLanguageExtension(language: CodeEditorLanguage): Promise<Extension> {
  switch (language) {
    case 'json':
      return import('@codemirror/lang-json').then((module) => module.json());
    case 'javascript':
      return import('@codemirror/lang-javascript').then((module) => module.javascript());
    case 'css':
      return import('@codemirror/lang-css').then((module) => module.css());
    case 'text':
      // 纯文本无需语言扩展，返回空以关闭高亮
      return Promise.resolve([]);
  }
}

/**
 * 用新内容替换编辑器全文。
 * @param view 已初始化的 CodeMirror 视图。
 * @param value 将写入编辑器的内容。
 */
function replaceEditorValue(view: EditorView, value: string) {
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: value,
    },
  });
}

/**
 * 内嵌代码编辑器：支持 JSON、JavaScript、CSS 高亮，并保持 React 受控值同步。
 * @param props 编辑器属性。
 */
export function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
  disabled = false,
  className,
  ariaLabel,
  headerStart,
  headerEnd,
}: CodeEditorProps) {
  /** CodeMirror 挂载节点。 */
  const containerRef = useRef<HTMLDivElement>(null);
  /** CodeMirror 视图实例。 */
  const viewRef = useRef<EditorView | null>(null);
  /** 最新受控值，供更新监听器区分外部同步与用户输入。 */
  const valueRef = useRef(value);
  /** 最新变更回调，避免因回调身份变化而重新创建编辑器。 */
  const onChangeRef = useRef(onChange);
  /** JSON 格式化失败时显示的错误提示。 */
  const [formatError, setFormatError] = useState<string | null>(null);

  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    /** 编辑器实际挂载节点。 */
    const container = containerRef.current;
    if (!container) {
      return;
    }

    /** 初始编辑器状态。 */
    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        ...CODE_EDITOR_BASE_EXTENSIONS,
        CODE_EDITOR_THEME,
        CODE_EDITOR_LANGUAGE_COMPARTMENT.of([]),
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? `${CODE_EDITOR_LANGUAGE_LABELS[language]} 编辑器` }),
        ...(placeholder ? [editorPlaceholder(placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return;
          }
          /** 更新后的编辑器内容。 */
          const nextValue = update.state.doc.toString();
          if (nextValue !== valueRef.current) {
            onChangeRef.current(nextValue);
          }
        }),
      ],
    });
    /** 已挂载的 CodeMirror 视图。 */
    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    void loadLanguageExtension(language).then((languageExtension) => {
      if (viewRef.current === view) {
        view.dispatch({
          effects: CODE_EDITOR_LANGUAGE_COMPARTMENT.reconfigure(languageExtension),
        });
      }
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, disabled, language, placeholder]);

  useEffect(() => {
    /** 当前编辑器视图。 */
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) {
      return;
    }
    replaceEditorValue(view, value);
  }, [value]);

  /**
   * 格式化当前编辑内容：JSON 做完整序列化，JS/CSS 按语言规则重新缩进。
   */
  function handleFormat() {
    /** 当前编辑器视图。 */
    const view = viewRef.current;
    if (!view || disabled) {
      return;
    }
    setFormatError(null);

    if (language === 'json') {
      try {
        /** 规范化后的 JSON 文本。 */
        const formattedValue = JSON.stringify(JSON.parse(view.state.doc.toString()), null, 2);
        replaceEditorValue(view, formattedValue);
      } catch {
        setFormatError('JSON 格式无效，无法格式化。');
      }
      return;
    }

    /** 根据语言语法树生成的整段缩进修改。 */
    const indentationChanges = indentRange(view.state, 0, view.state.doc.length);
    view.dispatch({ changes: indentationChanges });
  }

  return (
    // 根节点不裁剪溢出，让头部内的浮层（如动态变量提示）能超出编辑器边界显示；
    // 裁剪只收窄到下方内容区，避免 CodeMirror 内容溢出圆角。
    <div className={cn('relative rounded-md border border-input bg-background shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/35', className)}>
      <div className="flex items-center justify-between rounded-t-md border-b border-border bg-muted/60 px-2.5 py-1.5">
        {/* 头部左上角：默认展示语言名，caller 可用 headerStart 换成类型切换等控件 */}
        {headerStart ?? (
          <span className="font-mono text-[11px] font-medium text-muted-foreground">
            {CODE_EDITOR_LANGUAGE_LABELS[language]}
          </span>
        )}
        {/* 头部右上角：自定义内容（如动态变量提示）在前，格式化按钮在后 */}
        <div className="flex items-center gap-1">
          {headerEnd}
          {/* 纯文本无可格式化的语法结构，隐藏格式化按钮 */}
          {language !== 'text' && (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={handleFormat}
            >
              格式化
            </button>
          )}
        </div>
      </div>
      {/* 仅裁剪内容区，让 CodeMirror 内容与错误条贴合底部圆角 */}
      <div className="overflow-hidden rounded-b-md">
        <div ref={containerRef} />
        {formatError && <p className="border-t border-destructive/25 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{formatError}</p>}
      </div>
    </div>
  );
}
