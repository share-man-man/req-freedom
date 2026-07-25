import { useTranslation } from 'react-i18next';
import { RuleExecutionChannel } from '@req-freedom/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getLabels } from '@/utils/labels';
import { RULE_TEMPLATES, type RuleTemplate, type RuleTemplateCategory } from '@/utils/templates';

/**
 * 按归类聚合模板，保持 RULE_TEMPLATES 中的原始顺序。
 * @returns 归类与其下模板的有序列表
 */
function groupTemplatesByCategory(): ReadonlyArray<{
  /** 归类枚举值 */
  category: RuleTemplateCategory;
  /** 该归类下的模板 */
  templates: RuleTemplate[];
}> {
  /** 归类 → 模板列表；用 Map 保证首次出现顺序即展示顺序。 */
  const buckets = new Map<RuleTemplateCategory, RuleTemplate[]>();
  for (const template of RULE_TEMPLATES) {
    /** 当前归类已有的模板列表。 */
    const list = buckets.get(template.category) ?? [];
    list.push(template);
    buckets.set(template.category, list);
  }
  return [...buckets.entries()].map(([category, templates]) => ({ category, templates }));
}

interface TemplateLibraryProps {
  /** 对话框是否打开。 */
  open: boolean;
  /** 关闭对话框的回调。 */
  onClose: () => void;
  /** 选用某个模板的回调（由外层实例化规则并打开编辑器）。 */
  onUse: (template: RuleTemplate) => void;
}

/**
 * 常用规则模板库：把「解除 CORS / 禁用缓存 / 强制 HTTPS / 移动端 UA」等高频需求做成一键预设。
 * 选用后不直接落库，而是把预填好的规则草稿交给规则编辑器，便于用户按需微调匹配范围再保存。
 * @param props 模板库参数
 */
export default function TemplateLibrary({ open, onClose, onUse }: TemplateLibraryProps) {
  const { t } = useTranslation();
  /** 按归类聚合后的模板分区。 */
  const sections = groupTemplatesByCategory();
  /** 各枚举展示名映射。 */
  const labels = getLabels(t);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('templateLibrary.title')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <p className="text-sm text-muted-foreground">{t('templateLibrary.hint')}</p>
          {sections.map(({ category, templates }) => (
            <section key={category} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.RULE_TEMPLATE_CATEGORY_LABELS[category]}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {templates.map((template) => (
                  <TemplateCard key={template.id} template={template} onUse={() => onUse(template)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TemplateCardProps {
  /** 卡片对应的模板。 */
  template: RuleTemplate;
  /** 点击「使用」后的回调。 */
  onUse: () => void;
}

/**
 * 单个模板卡片：展示名称、说明、执行通道与动作预览，并提供「使用」入口。
 * @param props 模板与使用回调
 */
function TemplateCard({ template, onUse }: TemplateCardProps) {
  const { t } = useTranslation();
  /** 模板走的执行通道文案。 */
  const channelLabel = template.rule.channel === RuleExecutionChannel.Dnr ? 'DNR' : t('templateLibrary.channelPagePatch');
  /** 翻译后的模板名。 */
  const name = t(template.nameKey);
  /** 各枚举展示名映射。 */
  const labels = getLabels(t);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-card p-4 shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <Badge variant="secondary" className="shrink-0 border-transparent bg-cyan-500/15 text-[var(--accent-cyan)]">
            {channelLabel}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t(template.descriptionKey)}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {template.rule.actions.map((action) => (
            <Badge key={action.type} variant="secondary" className="border-transparent bg-muted text-muted-foreground">
              {labels.RULE_ACTION_TYPE_LABELS[action.type]}
            </Badge>
          ))}
        </div>
        <Button size="sm" className="shrink-0" onClick={onUse}>
          {t('templateLibrary.use')}
        </Button>
      </div>
    </div>
  );
}
