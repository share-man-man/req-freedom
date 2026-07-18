# 网络限速模拟

为命中的请求模拟弱网环境，验证 loading 态、竞态、流式响应和超时处理。可选择 Fast 3G、Slow 3G，或自定义网络延迟、上下行带宽。

## 实现方式

与 Mock 相同走**页面补丁通道**：

- `fetch` 会在真实请求前模拟网络延迟和上行传输；响应通过受控的 `ReadableStream` 按下行带宽分段交付。
- XHR 会在真实 `send` 前模拟网络延迟和上行传输。浏览器原生 XHR 不允许扩展替换其响应流，因此下行带宽只对 `fetch` 精确生效。

> 注意：仅对页面脚本发起的 fetch / XHR 生效。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `throttlePreset` | 网络档位：`fast-3g`、`slow-3g` 或 `custom` |
| `latencyMs` | 网络延迟（毫秒）；自定义档位生效 |
| `downloadKbps` | 内部下行带宽（千比特/秒）；配置界面按 `kB/s` 展示，`0` 为不限制 |
| `uploadKbps` | 内部上行带宽（千比特/秒）；配置界面按 `kB/s` 展示，`0` 为不限制 |

| 预设 | 网络延迟 | 下行 | 上行 |
| --- | ---: | ---: | ---: |
| Fast 3G | 150ms | 200 kB/s | 93.75 kB/s |
| Slow 3G | 400ms | 50 kB/s | 50 kB/s |

> 配置界面与 Chrome Network 面板统一使用 `kB/s`（千字节/秒）。规则内部仍以 Kbps（千比特/秒）存储，换算关系为 `1 kB/s = 8 Kbps`，以兼容既有规则。

## 示例

模拟 Slow 3G 下的慢接口：

- 匹配方式：`contains`
- 匹配模式：`example.com/api/list`
- 网络档位：`Slow 3G`

网络限速规则可与 Mock 规则叠加：对 `fetch`，Mock 响应同样会按下行带宽交付；Mock 自身的延迟会与网络延迟相加。
