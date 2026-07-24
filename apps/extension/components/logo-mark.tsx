import type { SVGProps } from 'react';

/**
 * ReqFreedom 品牌标识（R+F 字母组合，不含渐变底）。
 *
 * 描边统一用 currentColor，便于在不同容器中随容器文字色着色：
 * 放进 .aurora-badge（流光渐变底、白字）即白色字标，放进主色浅底即主色字标。
 * 完整带流光渐变底的版本见 assets/logo.svg（用于扩展图标）。
 * @param props 透传给 <svg> 的属性（如 className 控制尺寸）
 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="18 18 92 92"
      fill="none"
      stroke="currentColor"
      strokeWidth="11"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* R：竖干 + 上碗 + 斜腿 */}
      <path d="M29 28 L29 100" />
      <path d="M29 28 L49 28 C65 28 65 54 49 54 L29 54" />
      <path d="M43 54 L63 100" />
      {/* F：竖干 + 上臂 + 中臂 */}
      <path d="M75 28 L75 100" />
      <path d="M75 28 L99 28" />
      <path d="M75 58 L93 58" />
    </svg>
  );
}
