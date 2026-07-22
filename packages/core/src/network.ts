import type { DelayAction, NetworkThrottleSettings } from '@req-freedom/shared';
import {
  BITS_PER_BYTE,
  BITS_PER_KILOBIT,
  NETWORK_THROTTLE_PRESET_SETTINGS,
  NetworkThrottlePreset,
} from '@req-freedom/shared';

/**
 * 将不可信的限速数值收敛为非负有限数，避免手工编辑规则影响补丁执行。
 * @param value 待处理的数值
 * @returns 合法的非负数；非法值返回 0
 */
function toNonNegativeNumber(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value ?? 0 : 0;
}

/**
 * 得到规则实际生效的网络参数。预设档位始终使用统一常量，自定义档位才读取规则字段。
 * @param rule 网络限速规则
 * @returns 归一化后的网络参数
 */
export function getNetworkThrottleSettings(rule: DelayAction): NetworkThrottleSettings {
  /** 规则选择的网络档位。 */
  const preset = rule.throttlePreset;
  if (preset !== NetworkThrottlePreset.Custom && preset in NETWORK_THROTTLE_PRESET_SETTINGS) {
    return NETWORK_THROTTLE_PRESET_SETTINGS[
      preset as Exclude<NetworkThrottlePreset, NetworkThrottlePreset.Custom>
    ];
  }
  if (preset !== NetworkThrottlePreset.Custom) {
    return { latencyMs: 0, downloadKbps: 0, uploadKbps: 0 };
  }
  return {
    latencyMs: toNonNegativeNumber(rule.latencyMs),
    downloadKbps: toNonNegativeNumber(rule.downloadKbps),
    uploadKbps: toNonNegativeNumber(rule.uploadKbps),
  };
}

/**
 * 计算指定字节数在给定带宽下需要的最短传输时间。
 * @param bytes 待传输的字节数
 * @param kbps 带宽（千比特/秒）；0 表示不限制
 * @returns 传输时长（毫秒）
 */
export function getTransferDurationMs(bytes: number, kbps: number): number {
  /** 归一化后的字节数。 */
  const safeBytes = toNonNegativeNumber(bytes);
  /** 归一化后的带宽。 */
  const safeKbps = toNonNegativeNumber(kbps);
  if (safeBytes === 0 || safeKbps === 0) {
    return 0;
  }
  return (safeBytes * BITS_PER_BYTE * 1000) / (safeKbps * BITS_PER_KILOBIT);
}

/**
 * 计算请求发出前应等待的时长：网络延迟 + 受限上行传输时间。
 * @param rule 网络限速规则
 * @param requestBodyBytes 请求体字节数；无法确定时传 0
 * @returns 请求前等待时长（毫秒）
 */
export function getNetworkRequestDelayMs(rule: DelayAction, requestBodyBytes: number): number {
  /** 规则实际生效的网络档位参数。 */
  const settings = getNetworkThrottleSettings(rule);
  return settings.latencyMs + getTransferDurationMs(requestBodyBytes, settings.uploadKbps);
}
