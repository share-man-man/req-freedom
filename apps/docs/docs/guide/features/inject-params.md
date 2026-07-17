# 参数注入

向命中请求的 URL 查询串中追加或覆盖参数。

## 实现方式

通过 `declarativeNetRequest` 的 `redirect.transform.queryTransform.addOrReplaceParams` 实现，同名参数会被覆盖而不是重复追加。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `params` | 要注入的查询参数键值对 |

## 示例

为所有 API 请求打开调试开关：

- 匹配方式：`wildcard`
- 匹配模式：`https://api.example.com/*`
- 注入参数：`{ "debug": "1", "env": "gray" }`
