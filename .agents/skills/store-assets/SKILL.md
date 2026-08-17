---
name: store-assets
description: 为 Chrome 扩展生成应用商店素材（主截图、小型宣传图块、Marquee 图块）。用户提出"出商店截图""生成商店素材""上架要的图""宣传图块""换个语言重出截图""截图尺寸不对"，或需要把扩展界面渲染成固定像素尺寸的图片时使用。适用于任何 Chrome 扩展项目，不限于当前仓库。
---

# 生成 Chrome 商店素材

商店素材有两类，做法完全不同，先分清再动手：

- **主截图**（1280x800 或 640x400）：给已经点进详情页的人看"这工具怎么用"，必须是**真实界面**。
- **宣传图块**（小型 440x280、Marquee 1400x560）：给还没点进来的人看"这是干嘛的"，是**设计稿不是截图**。把 UI 缩到 440x280 只会糊成色块，商店的规范也要求宣传图简单、少文字。

本 skill 解决的是**怎么把扩展界面稳定渲染成精确尺寸的图片**。宣传图的视觉设计仍需按项目品牌单独做，本 skill 只负责把设计稿渲染成精确尺寸。

## 核心思路

无头浏览器装不了扩展，`chrome-extension://` 页面根本打不开。所以不去"运行扩展再截图"，而是：

1. 正常构建扩展，拿到打包产物
2. 用静态服务器托管产物，让 `options.html` / `popup.html` 变成普通网页
3. 在页面入口脚本之前注入一个 `chrome.*` 垫片，补齐 storage / runtime / tabs 等 API，页面就能正常渲染
4. 用 CDP 锁死视口尺寸，等页面自报就绪后截图

这样拿到的是**真实构建产物的真实界面**，只是数据来自预置的种子，而不是真实的扩展运行时。

## 目录约定

skill 本身不含任何项目数据，项目侧的配置与数据放在仓库根：

```text
.store-assets/
├── config.json        # 构建命令、产物目录、要出哪些图
├── seed.js            # 演示数据：storage 内容、标签页、消息应答
└── pages/             # 合成页与宣传图设计稿
```

新项目接入执行 `scripts/init.sh` 生成骨架，再按下面的清单改。

## 出图流程

```bash
# 1. 首次接入才需要：生成 .store-assets/ 骨架
.agents/skills/store-assets/scripts/init.sh

# 2. 构建扩展并组装演示站点（改了扩展代码就要重跑）
.agents/skills/store-assets/scripts/prepare.sh

# 3. 渲染素材
node .agents/skills/store-assets/scripts/capture.mjs
```

`capture.mjs` 自带静态服务器、自己拉起无头 Chrome、结束时一并收掉，不留常驻进程，端口也交给系统分配。只改了 `.store-assets/pages/` 下的设计稿时，`prepare.sh` 也要重跑一次（它负责把 pages 拷进站点）。

常用变体：

```bash
# 只重出某几张（按输出文件名匹配）
node .agents/skills/store-assets/scripts/capture.mjs 04 promo

# 出其他语言分区的素材（参数由 seed.js 自行解读）
STORE_ASSETS_PARAMS='locale=zh-CN' node .agents/skills/store-assets/scripts/capture.mjs

# 只改了设计稿、扩展没动
STORE_ASSETS_SKIP_BUILD=1 .agents/skills/store-assets/scripts/prepare.sh
```

## 接入新项目要改什么

**config.json**
- `buildCommand`：仓库根执行的构建命令。项目若用 mise / nvm 锁版本，要带上前缀。
- `buildDir`：含 `manifest.json` 的产物目录。
- `workDir`：工作区，会被清空重建，**必须落在 .gitignore 忽略的路径下**。
- `pages`：需要注入垫片的扩展页面。
- `shots`：每张素材的文件名、页面路径、画布尺寸。

**seed.js**：素材里出现的每条数据都来自这里。键名和结构必须与扩展真实使用的一致——**字段对不上时界面会静默少渲染一块而不是报错**，所以出图后必须逐张看，不能只看脚本是否成功。

**pages/**：popup 合成页与宣传图设计稿，按项目品牌改。

## 需要交互才能看到的界面

商店素材里最有价值的往往是要点开才看得到的（详情弹窗、二级视图），而截图是无头的、点不了。`autoview.js` 用查询参数代替点击：

| 参数 | 作用 |
| --- | --- |
| `?click=<可访问名>` | 点击第一个可访问名包含该文本的按钮 / 链接 |
| `?clickIn=<行内文本>::<按钮名>` | 在含该文本的最小容器内点击按钮 |
| `?ready=<CSS 选择器>` | 等该选择器命中后才算就绪 |
| `?settle=<毫秒>` | 就绪前额外等待，默认 600 |

列表里每行都有同名的「编辑」按钮时必须用 `clickIn`：直接按文本搜容器会命中整张表格，拿到的永远是第一行的按钮。

写进 `config.json` 的 `path` 时记得对参数值做 URL 编码。

## 页面需要拉取外部文件时

阅读器、预览器一类的扩展常靠 `?src=<url>` 拉一份真实文件再渲染。把示例文件放进
`.store-assets/pages/`，在 `path` 里用 `{{baseUrl}}` 引用——站点端口是每次运行临时
分配的，写不了绝对地址：

```json
{ "path": "/viewer.html?src={{baseUrl}}/pages/sample.md" }
```

站点会按扩展名回 `text/markdown`、`text/plain` 等类型。页面若按 `Content-Type`
判断要不要接管渲染，类型给错就会走进"不支持的格式"分支——这时先确认服务器
回的类型在页面的白名单里。

## 素材本身的要求

- 尺寸必须**精确**。主截图 1280x800 优先，640x400 在高分屏会糊。
- 宣传图**不能带 alpha 通道**，要铺满画布，不要自己做圆角或留白边——商店会自行裁切。
- 截图里不能出现真实 token、Cookie、内网域名、客户名。种子数据一律用 `example.com` 一类的占位内容。
- 「全球通用」那套素材用英文界面；其他语言分区可以单独出，但没必要每个语言都传。
- popup 通常只有 300-400px 宽，直接截远小于要求尺寸。用 `pages/popup-frame.html` 把真实 popup 合成到大画布上。

## 交付前必须做的核对

脚本跑成功不等于素材可用。逐张打开看，重点确认：

- 数据渲染完整，没有因为种子字段对不上而空掉的区域
- 没有骨架屏、加载态、半渲染的图表
- 没有敏感信息
- 尺寸与商店要求逐一对上

`capture.mjs` 对超时未就绪的素材会标 `!` 并以非零码退出，这类**一定**要人工看过。

## 两个已经踩过的坑

**别用 `chrome --headless --screenshot`。** 它要靠 `--virtual-time-budget` 等页面稳定，而页面里只要有个持续调度的组件（代码编辑器、动画、轮询），虚拟时间就推进不完，进程直接挂死。走 CDP 才能显式控制"等到什么时候拍"。

**别让脚本留下常驻服务器或浏览器。** 后台进程会继承调用方的 stdout，让调用方一直等管道关闭，看起来像卡死；跨会话残留还会抢端口。`capture.mjs` 已经把两者都纳入自己的生命周期，不要再往 `prepare.sh` 里加守护进程。
