import { RuleActionType, RuleExecutionChannel } from '@req-freedom/shared';

/**
 * 执行通道对应的中性灰标签：与右侧彩色动作徽标区分开，避免同色误读。
 * 两档用不同深浅的前景灰底表达差异，具体是哪个通道由徽标文字（DNR / 页面补丁）说明。
 */
export const CHANNEL_BADGE_CLASS: Record<RuleExecutionChannel, string> = {
  [RuleExecutionChannel.Dnr]: 'bg-foreground/10 text-muted-foreground',
  [RuleExecutionChannel.PagePatch]: 'bg-foreground/[0.04] text-muted-foreground',
};

/**
 * 各动作类型对应的柔和标签颜色：15% 色底 + 随明暗翻转的强调文字（--accent-* 见 style.css），
 * 浅色/深色两套下都保证对比度与扫读性。
 *
 * 规则列表与请求日志共用同一套配色：同一个动作在两处必须是同一个颜色，否则对照着排查时
 * 需要重新建立映射。
 */
export const ACTION_BADGE_CLASS: Record<RuleActionType, string> = {
  [RuleActionType.Block]: 'bg-rose-500/15 text-[var(--accent-rose)]',
  [RuleActionType.Redirect]: 'bg-amber-500/15 text-[var(--accent-amber)]',
  [RuleActionType.InjectParams]: 'bg-indigo-500/15 text-[var(--accent-indigo)]',
  [RuleActionType.ModifyHeaders]: 'bg-cyan-500/15 text-[var(--accent-cyan)]',
  [RuleActionType.MockResponse]: 'bg-violet-500/15 text-[var(--accent-violet)]',
  [RuleActionType.Delay]: 'bg-orange-500/15 text-[var(--accent-orange)]',
  [RuleActionType.InsertScript]: 'bg-emerald-500/15 text-[var(--accent-emerald)]',
  [RuleActionType.ModifyRequestBody]: 'bg-pink-500/15 text-[var(--accent-pink)]',
};
