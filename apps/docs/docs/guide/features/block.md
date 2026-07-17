# 请求拦截

按 URL 匹配规则直接阻断请求，用于验证接口失败时的降级与兜底逻辑。

## 实现方式

通过 `declarativeNetRequest` 的 `block` 动作在网络层阻断，覆盖页面发起的所有请求类型。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `matchType` | 匹配方式：包含 / 相等 / 通配符 / 正则 |
| `pattern` | URL 匹配模式 |

## 示例

拦截所有埋点上报：

- 匹配方式：`contains`
- 匹配模式：`analytics.example.com/report`
