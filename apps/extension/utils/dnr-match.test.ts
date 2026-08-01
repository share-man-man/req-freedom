import { describe, expect, it } from 'vitest';
import { matchDnrCondition } from './dnr-match';

/**
 * 这组测试固定 DNR `urlFilter` / `regexFilter` 的语义细节。
 *
 * 它们是编辑器命中测试在 DNR 通道下的判定依据，与 `core.matchUrl`（页面补丁通道语义）
 * 的差异正是命中测试要如实反映的内容。
 */
describe('matchDnrCondition', () => {
  it('urlFilter 无锚定时按子串匹配', () => {
    expect(matchDnrCondition({ urlFilter: '/api/users' }, { url: 'https://a.com/v2/api/users?x=1' })).toBe(true);
    expect(matchDnrCondition({ urlFilter: '/api/users' }, { url: 'https://a.com/api/other' })).toBe(false);
  });

  it('urlFilter 首尾 | 锚定 URL 两端', () => {
    expect(matchDnrCondition({ urlFilter: '|https://a.com/api|' }, { url: 'https://a.com/api' })).toBe(true);
    expect(matchDnrCondition({ urlFilter: '|https://a.com/api|' }, { url: 'https://a.com/api/1' })).toBe(false);
    expect(matchDnrCondition({ urlFilter: '|https://a.com' }, { url: 'https://b.com/?next=https://a.com' })).toBe(false);
  });

  it('urlFilter 的 * 通配任意字符', () => {
    expect(matchDnrCondition({ urlFilter: 'https://a.com/*/users' }, { url: 'https://a.com/v2/users' })).toBe(true);
    expect(matchDnrCondition({ urlFilter: 'https://a.com/*/users' }, { url: 'https://a.com/users' })).toBe(false);
  });

  it('urlFilter 的 ^ 匹配分隔符，URL 末尾也算分隔符', () => {
    expect(matchDnrCondition({ urlFilter: '/api^' }, { url: 'https://a.com/api?x=1' })).toBe(true);
    expect(matchDnrCondition({ urlFilter: '/api^' }, { url: 'https://a.com/api' })).toBe(true);
    // 字母不是分隔符，因此 /apixx 不命中
    expect(matchDnrCondition({ urlFilter: '/api^' }, { url: 'https://a.com/apixx' })).toBe(false);
  });

  it('urlFilter 的 || 锚定域名并跨子域', () => {
    expect(matchDnrCondition({ urlFilter: '||a.com/api' }, { url: 'https://a.com/api' })).toBe(true);
    expect(matchDnrCondition({ urlFilter: '||a.com/api' }, { url: 'https://cdn.a.com/api' })).toBe(true);
    expect(matchDnrCondition({ urlFilter: '||a.com/api' }, { url: 'https://b.com/?next=a.com/api' })).toBe(false);
  });

  it('urlFilter 默认不区分大小写', () => {
    expect(matchDnrCondition({ urlFilter: '/API/Users' }, { url: 'https://a.com/api/users' })).toBe(true);
  });

  it('regexFilter 按正则匹配且同样不区分大小写', () => {
    expect(matchDnrCondition({ regexFilter: '^https://a\\.com/api/\\d+$' }, { url: 'https://a.com/api/42' })).toBe(true);
    expect(matchDnrCondition({ regexFilter: '^https://A\\.COM/api' }, { url: 'https://a.com/api' })).toBe(true);
    expect(matchDnrCondition({ regexFilter: '^https://a\\.com/api/\\d+$' }, { url: 'https://a.com/api/x' })).toBe(false);
  });

  it('requestMethods 在传入方法时才参与判定', () => {
    /** 只对 POST 生效的条件。 */
    const condition = { urlFilter: '/api', requestMethods: ['post' as const] };

    expect(matchDnrCondition(condition, { url: 'https://a.com/api', method: 'POST' })).toBe(true);
    expect(matchDnrCondition(condition, { url: 'https://a.com/api', method: 'GET' })).toBe(false);
    // 不传方法表示只验 URL 模式（命中测试气泡的用法）
    expect(matchDnrCondition(condition, { url: 'https://a.com/api' })).toBe(true);
  });

  it('regexFilter 语法非法时按不命中处理，不抛错', () => {
    expect(matchDnrCondition({ regexFilter: '(' }, { url: 'https://a.com/api' })).toBe(false);
  });
});
