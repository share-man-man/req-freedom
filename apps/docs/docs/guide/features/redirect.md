# 重定向

把命中的请求重定向到新地址，常用于线上接口指向本地开发环境。

## 实现方式

通过 `declarativeNetRequest` 的 `redirect` 动作实现：

- 普通匹配：直接重定向到 `redirectUrl`
- 正则匹配：支持 `regexSubstitution`，可用 `\1` 引用捕获组

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `redirectUrl` | 重定向目标地址；正则匹配时支持 `\1` 捕获组引用 |

## 示例

线上 API 转发到本地：

- 匹配方式：`regex`
- 匹配模式：`https://api\.example\.com/(.*)`
- 目标地址：`http://localhost:3000/\1`
