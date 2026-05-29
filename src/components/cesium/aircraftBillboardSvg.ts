/**
 * 飞机默认 Billboard：民航客机俯视轮廓（窄体干线常见布局），艏朝上，与 AIS 航向 0°=北、`rotation` 约定一致。
 * 浅色主体便于 `BillboardGraphics.color` 乘色区分 normal / warning / danger。
 */
export function aircraftDefaultBillboardDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<g stroke-linejoin="round" stroke-linecap="round">
  <!-- 单轮廓：机头—机身—大展弦比梯形主翼—尾锥—平尾 -->
  <path fill="#f4f4f4" stroke="#b8b8b8" stroke-width="1.25"
    d="M 64 17
       C 68.5 17 71 21 71 27 L 71 37
       L 118 43 L 126 53.5 L 116 61.5 L 71.5 53
       L 72 72 C 73 81 75 88 79 92.5 L 73 97 L 64 102 L 55 97 L 49 92.5
       C 53 88 55 81 56 72 L 56.5 53 L 12 61.5 L 2 53.5 L 10 43 L 57 37
       L 57 27 C 57 21 59.5 17 64 17 Z"/>
  <!-- 翼根整流 -->
  <path fill="#e8e8e8" stroke="none"
    d="M 64 39 C 68.5 40 70 43 70 48.5 L 58 48.5 C 58 43 59.5 40 64 39 Z"/>
  <!-- 翼下发动机短舱（俯视） -->
  <ellipse cx="32" cy="52.5" rx="5.8" ry="3" fill="#e4e4e4" stroke="#aeaeae" stroke-width="1"/>
  <ellipse cx="96" cy="52.5" rx="5.8" ry="3" fill="#e4e4e4" stroke="#aeaeae" stroke-width="1"/>
  <!-- 机头 -->
  <ellipse cx="64" cy="23" rx="3" ry="4.2" fill="#ffffff" opacity="0.45" stroke="none"/>
</g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
