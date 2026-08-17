/**
 * 按 URL 参数在页面上完成必要的点击，并对外报告"可以拍了"（项目无关）。
 *
 * 商店素材里最有价值的往往是要点开才看得到的界面（详情弹窗、二级视图），
 * 而截图脚本是无头的、点不了。这里用查询参数代替人手点击。
 *
 * 页面就绪后置 `window.__assetReady = true`，让截图脚本知道该拍了——
 * 固定 sleep 在慢机器上会拍到骨架屏，在快机器上又白等。
 *
 * 支持的参数（可组合，按出现顺序执行）：
 *   ?click=<可访问名>
 *       点击第一个可访问名包含该文本的按钮 / 链接。
 *   ?clickIn=<行内文本>::<按钮可访问名>
 *       在包含「行内文本」的最小容器内点击指定按钮。
 *       列表里每行都有同名的「编辑」按钮时用这个，直接按文本搜容器
 *       会命中整张表格，拿到的永远是第一行的按钮。
 *   ?ready=<CSS 选择器>
 *       等该选择器命中后才算就绪；不给则点击完成即算就绪。
 *   ?settle=<毫秒>
 *       就绪前额外等待，留给弹窗动画、代码高亮等异步渲染。默认 600。
 */
(function () {
  'use strict';

  /** 页面 URL 上的查询参数。 */
  const params = new URLSearchParams(location.search);
  /** 依次要执行的点击指令。 */
  const steps = [
    ...params.getAll('click').map((value) => ({ kind: 'click', value })),
    ...params.getAll('clickIn').map((value) => ({ kind: 'clickIn', value })),
  ];
  /** 就绪判定使用的 CSS 选择器。 */
  const readySelector = params.get('ready');
  /** 就绪前的额外等待时间（毫秒）。 */
  const settleMs = Number(params.get('settle') ?? 600);

  /** 供截图脚本轮询的就绪标记。 */
  window.__assetReady = false;

  /** 轮询查找元素的最长等待时间（毫秒）。 */
  const WAIT_TIMEOUT_MS = 8000;
  /** 轮询间隔（毫秒）。 */
  const POLL_INTERVAL_MS = 100;
  /** 无需交互时，等页面渲染完再报就绪的时间（毫秒）。 */
  const IDLE_SETTLE_MS = 800;

  if (steps.length === 0 && !readySelector) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.__assetReady = true;
      }, IDLE_SETTLE_MS);
    });
    return;
  }

  /**
   * 读取元素的可访问名称，用于按文案定位控件。
   * @param element 目标元素
   * @returns 归一化后的小写名称
   */
  function accessibleName(element) {
    return (
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent ||
      ''
    )
      .trim()
      .toLowerCase();
  }

  /**
   * 轮询等待某个元素出现。
   * @param resolveElement 每次轮询执行的查找函数，找到时返回元素
   * @returns 找到的元素；超时则抛错
   */
  function waitFor(resolveElement) {
    return new Promise((resolve, reject) => {
      /** 开始等待的时间戳。 */
      const startedAt = Date.now();
      /** 单次轮询。 */
      const tick = () => {
        /** 本轮找到的元素。 */
        const found = resolveElement();
        if (found) {
          resolve(found);
          return;
        }
        if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
          reject(new Error('autoview: 目标元素未出现'));
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      };
      tick();
    });
  }

  /**
   * 按可访问名查找一个可点击控件。
   * @param name 目标可访问名（大小写不敏感的子串）
   * @param scope 查找范围，默认整个文档
   * @returns 匹配的控件，未找到时返回 null
   */
  function findClickable(name, scope = document) {
    /** 目标名称的小写形式。 */
    const needle = name.toLowerCase();
    /** 范围内所有可点击控件。 */
    const candidates = [...scope.querySelectorAll('button, a, [role="button"], [role="tab"]')];
    // 先要精确匹配：开关类控件常有一对互为反义的名字（"Contents" / "Close contents"），
    // 只做子串匹配会命中反义的那个，把本来就展开的面板又点回去
    return (
      candidates.find((element) => accessibleName(element) === needle) ??
      candidates.find((element) => accessibleName(element).includes(needle)) ??
      null
    );
  }

  /**
   * 在包含指定文本的那一行内查找控件。
   *
   * 先定位承载该文本的叶子节点，再逐级向上找到第一个含目标控件的祖先。
   * 这样拿到的是"离文本最近"的那个控件，而不是整表里的第一个同名控件。
   * @param rowText 用于锁定行的文本（大小写不敏感的子串）
   * @param buttonName 该行内目标控件的可访问名
   * @returns 匹配的控件，未找到时返回 null
   */
  function findClickableInRow(rowText, buttonName) {
    /** 行文本的小写形式。 */
    const needle = rowText.toLowerCase();
    /** 文本命中且不再有同样命中的子元素的叶子节点。 */
    const leaves = [...document.querySelectorAll('body *')].filter((element) => {
      if (!(element.textContent || '').toLowerCase().includes(needle)) return false;
      return ![...element.children].some((child) =>
        (child.textContent || '').toLowerCase().includes(needle),
      );
    });
    for (const leaf of leaves) {
      /** 自叶子向上回溯的当前节点。 */
      let node = leaf;
      while (node && node !== document.body) {
        /** 当前层级内的目标控件。 */
        const found = findClickable(buttonName, node);
        if (found) return found;
        node = node.parentElement;
      }
    }
    return null;
  }

  /**
   * 依次执行点击指令并等待就绪条件。
   */
  async function run() {
    try {
      for (const step of steps) {
        if (step.kind === 'click') {
          (await waitFor(() => findClickable(step.value))).click();
        } else {
          /** 「行内文本::按钮名」拆出的两段。 */
          const [rowText, buttonName] = step.value.split('::');
          (await waitFor(() => findClickableInRow(rowText, buttonName ?? 'edit'))).click();
        }
      }
      if (readySelector) {
        await waitFor(() => document.querySelector(readySelector));
      }
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    } catch (error) {
      // 照常置就绪：拍一张能看出哪里不对的图，比让脚本干等到超时有用。
      // 但必须把失败留痕——否则点击没生效、等待条件写错时，截图脚本会把
      // 一张内容不对的图标成成功，人不看就发到商店了。
      console.error(error);
      window.__assetError = String(error?.message ?? error);
    }
    window.__assetReady = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
