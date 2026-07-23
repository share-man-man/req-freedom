import { browser, type Browser } from 'wxt/browser';
import type { RuleScope } from '@req-freedom/shared';
import { RuleScopeType } from '@req-freedom/shared';

/** 浏览器标签类型别名，简化书写。 */
type Tab = Browser.tabs.Tab;

/**
 * 把一条规则的作用域解析成一组目标 tabId
 *
 * DNR session 规则只认 tabIds 条件（没有 window / group 条件），因此窗口 / 标签组作用域都要
 * 先展开成它当前包含的标签页集合。解析基于传入的标签快照，调用方负责在标签事件后重新查询与重算。
 * @param scope 规则作用域条件（缺省或 AllTabs 表示不限制，返回空数组）
 * @param tabs 当前全部标签页快照（一次 browser.tabs.query 的结果）
 * @returns 命中作用域的 tabId 列表（去重）；无匹配时为空数组
 */
export function resolveScopeTabIds(scope: RuleScope | undefined, tabs: Tab[]): number[] {
  if (!scope || scope.type === RuleScopeType.AllTabs) {
    return [];
  }
  /** 作用域目标对象的 ID 集合。 */
  const targetIds = new Set(scope.targets.map((target) => target.id));
  /** 命中作用域的标签页。 */
  const matched = tabs.filter((tab) => {
    if (tab.id === undefined) {
      return false;
    }
    switch (scope.type) {
      case RuleScopeType.Tab:
        return targetIds.has(tab.id);
      case RuleScopeType.Window:
        return targetIds.has(tab.windowId);
      case RuleScopeType.TabGroup:
        // 未归组的标签 groupId 为 TAB_GROUP_ID_NONE，不会落在任何分组作用域内
        return targetIds.has(tab.groupId);
      default:
        return false;
    }
  });
  return [...new Set(matched.map((tab) => tab.id as number))];
}

/**
 * 查询当前全部标签页
 * @returns 全部标签页列表
 */
export function queryAllTabs(): Promise<Tab[]> {
  return browser.tabs.query({});
}
