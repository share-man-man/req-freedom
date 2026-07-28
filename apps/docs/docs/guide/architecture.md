# 架构设计

## 仓库结构

```text
req-freedom/
├── apps/
│   ├── extension/          # 浏览器插件（WXT + React，MV3）
│   │   ├── entrypoints/
│   │   │   ├── background.ts            # 同步规则到 declarativeNetRequest
│   │   │   ├── bridge.content.ts        # ISOLATED world，读 storage 并推送规则
│   │   │   ├── interceptor.content.ts   # MAIN world，fetch/XHR 补丁（Mock、网络限速、改请求体）
│   │   │   ├── popup/                   # 快速启停界面
│   │   │   └── options/                 # 规则管理界面
│   │   └── utils/          # storage 封装、DNR 规则转换
│   └── docs/               # 文档站（Rspress）
└── packages/
    ├── shared/             # 枚举、常量、类型定义
    └── core/               # 平台无关的规则匹配引擎
```

## 双通道拦截架构

不同能力由两条链路分别承载：

```text
                     ┌──────────────────────────────┐
                     │   storage.local（规则存储）   │
                     └──────┬──────────────┬────────┘
                            │              │ storage.onChanged
                 onChanged  │              ▼
                            │      ┌────────────────────┐
                            ▼      │ bridge.content.ts  │ (ISOLATED)
                  ┌──────────────┐ └────────┬───────────┘
                  │ background   │          │ MessagePort
                  └──────┬───────┘          ▼
                         │         ┌──────────────────────┐
        updateDynamicRules│        │ interceptor.content  │ (MAIN)
                         ▼         │ fetch / XHR 补丁      │
              ┌────────────────┐   │ + 脚本 / 样式注入     │
              │ declarativeNet │   └──────────┬───────────┘
              │ Request (DNR)  │              │
              └──────┬─────────┘              ▼
                     │        返回值 Mock、网络限速、脚本注入、改请求体
                     ▼
        拦截、重定向、参数注入、Header 改写
```

- **DNR 通道**：拦截 / 重定向 / 参数注入 / Header 改写在网络层由浏览器原生执行，性能好、覆盖所有请求（包括页面导航）
- **页面补丁通道**：返回值 Mock、网络限速与改请求体无法由 DNR 表达，通过 MAIN world 内容脚本改写 `fetch` 与 `XMLHttpRequest` 实现，仅作用于页面脚本发起的请求；`fetch` 的响应流可按下行带宽精确交付，XHR 则仅能模拟请求前的延迟和上行带宽；改请求体在请求发出前替换或 JSON 深合并请求体；脚本注入亦复用该通道，按页面 URL 命中后注入自定义 JS / CSS
  - 同步 XHR 不在作用范围内，见下方[已知限制](#已知限制)

## 命中统计

统计的唯一原始数据是**命中日志**（`RuleHit`：规则 ID、动作类型、请求 URL、方法、时间）。总数与逐规则计数都是它的投影，不单独维护计数器。

- **图标徽标只表达状态**，不表达数量：当前标签页有任意规则生效时点亮。数量在 popup 里按规则展示。
- **DNR 通道的命中来自观测式 `chrome.webRequest`**。`onRuleMatchedDebug` 仅未打包扩展可用，`getMatchedRules` 只有 pull 且受 20 次 / 10 分钟配额与 5 分钟保留窗口限制，都无法驱动实时状态。观测到请求后由 `core.findMatchedRules` 判定命中——与页面补丁通道完全同一个匹配器。
  - 这是**预测**而非事实：网络层真正执行的是编译出的 DNR 规则。`utils/dnr-match-parity.test.ts` 守护两者的语义一致性。
  - 匹配组监听按需注册：不存在启用的 DNR 通道规则时注销，避免无谓唤醒 Service Worker。
- **页面补丁通道逐条自报**。执行计划（`utils/page-plan.ts`）在决定动作的同时产出命中记录，不做事后推导。
- **状态以内存为权威**，`storage.session` 只作防抖镜像。命中是逐请求写入的，若以 storage 为权威，每条命中都要全量序列化整个数组。
- **重置点是顶层 `main_frame` 请求**（`webRequest.onBeforeRequest`）。重置与该请求自身的命中来自同一事件，天然有序，因此不需要统计窗口时间戳或 Document token。
- MAIN world 与 ISOLATED world 在 `document_start` 建立一次 `MessageChannel`，命中记录只通过私有端口传递；bridge 仍按当前生效规则 ID 校验上报内容。

## 已知限制

- 页面加载极早期（规则尚未通过 MessagePort 送达时）发起的请求不会被 Mock / 延迟
- **同步 XHR（`open(..., false)`）一律原样放行，页面补丁规则不生效**。该通道的处理全是异步的——读请求体、执行动态函数、发影子请求都要等微任务或事件；而同步 XHR 要求 `send` 返回时响应已就绪，插进去只会让页面读到空响应。这里刻意选择 fail-open：宁可规则不生效，也不破坏页面。命中过页面补丁规则时会在页面控制台提示一次，便于排查「为什么规则没生效」。DNR 通道的规则不受影响，仍在网络层照常执行
