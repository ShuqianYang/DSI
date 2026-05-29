'use client';

import type { MapDrawMode } from '@/types/mapDraw';

export type MultiLayerDemoScenario = 'default' | 'manualB';

type Props = {
  windFieldDemoOn: boolean;
  onToggleWindFieldDemo: () => void;
  scenario: MultiLayerDemoScenario;
  onScenarioChange: (s: MultiLayerDemoScenario) => void;
  /** 最近一次地图点位点击回调收到的对象序列化（与 Cesium `_payload` 一致） */
  lastPickPayloadJson: string | null;
  onClearPickLog: () => void;
  singleTileDemoOn: boolean;
  onToggleSingleTileDemo: () => void;
  billboardGlowOn: boolean;
  onToggleBillboardGlow: () => void;
  billboardGlowUseAltImage: boolean;
  onToggleBillboardGlowImage: () => void;
  pulseRingDemoAll: boolean;
  onTogglePulseRingDemo: () => void;
  /** 点位上方名称标签（与工具栏「图层」内开关同步） */
  showPointLabels: boolean;
  onTogglePointLabels: () => void;
  drawMode: MapDrawMode;
  onDrawModeChange: (mode: MapDrawMode) => void;
  lastDrawResultJson: string | null;
  onClearDrawResult: () => void;
  /** 清空地图上已提交的绘制几何（持久层） */
  onClearMapDrawPersist: () => void;
};

/**
 * 多图层示例 · 统一左下角面板：单张贴图、场景数据、点击回调 JSON。
 * 贴图数据由父组件经 GisViewer.singleTileOverlays 传入 CesiumMap。
 */
export default function MultiLayerPointsDemoControls({
  windFieldDemoOn,
  onToggleWindFieldDemo,
  scenario,
  onScenarioChange,
  lastPickPayloadJson,
  onClearPickLog,
  singleTileDemoOn,
  onToggleSingleTileDemo,
  billboardGlowOn,
  onToggleBillboardGlow,
  billboardGlowUseAltImage,
  onToggleBillboardGlowImage,
  pulseRingDemoAll,
  onTogglePulseRingDemo,
  showPointLabels,
  onTogglePointLabels,
  drawMode,
  onDrawModeChange,
  lastDrawResultJson,
  onClearDrawResult,
  onClearMapDrawPersist,
}: Props) {
  const drawBtn = (mode: Exclude<MapDrawMode, 'none'>, label: string) => (
    <button
      key={mode}
      type="button"
      onClick={() => onDrawModeChange(drawMode === mode ? 'none' : mode)}
      className={`rounded-md px-2 py-2 text-xs font-medium transition-colors border ${
        drawMode === mode
          ? 'bg-[#00E0FF]/20 border-[#00E0FF]/50 text-[#EAEAEA]'
          : 'border-[#3A3A4E] text-[#B8B8CC] hover:bg-[#2A2A3E] hover:text-[#EAEAEA]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="absolute left-4 bottom-4 z-30 flex max-h-[calc(100dvh-6.5rem)] w-[min(100%-2rem,22rem)] max-w-md flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-1 [scrollbar-width:thin] [scrollbar-color:#4A4A5E_#1a1a24] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#4A4A5E] [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[#1a1a24]"
    >
      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">风场示例（WindField 10×10）</div>
        <button
          type="button"
          onClick={onToggleWindFieldDemo}
          className={`rounded-md w-full px-3 py-2 text-left text-sm transition-colors border ${
            windFieldDemoOn
              ? 'bg-[#00E0FF]/15 border-[#00E0FF]/45 text-[#EAEAEA]'
              : 'border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E]'
          }`}
        >
          {windFieldDemoOn ? '关闭风场热力图 + 粒子' : '开启风场热力图 + 粒子'}
          <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
            与 api/plan/wind-particle-handoff 数据结构一致：SingleTile 风速着色 + Canvas postRender 粒子（无额外 npm 库）。开启后自动飞到东海 demo
            范围。默认约 640 粒子、单层描边；仍卡可在 WindParticleCanvasOverlay 调低 particleCount 或 demoWindField 热力图分辨率。
          </span>
        </button>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">点位高亮 · Billboard 呼吸光圈</div>
        <button
          type="button"
          onClick={onToggleBillboardGlow}
          className={`rounded-md w-full px-3 py-2 text-left text-sm transition-colors border mb-2 ${
            billboardGlowOn
              ? 'bg-[#00E0FF]/15 border-[#00E0FF]/45 text-[#EAEAEA]'
              : 'border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E]'
          }`}
        >
          {billboardGlowOn ? '关闭图片光圈' : '开启图片光圈（可换图）'}
          <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
            glowBillboard 先于 base 挂载；紧凑 SVG（渐变+双环+射线）；scaleByDistance 小幅随缩放；图可换 PNG/SVG URL。
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleBillboardGlowImage}
          disabled={!billboardGlowOn}
          className="rounded-md w-full px-3 py-2 text-left text-sm transition-colors border border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E] disabled:opacity-40 disabled:pointer-events-none"
        >
          切换光圈贴图（演示换图）
          <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
            当前：{billboardGlowUseAltImage ? '琥珀 SVG（demoBillboardGlow）' : '青色 SVG'}
          </span>
        </button>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">点位名称标签</div>
        <button
          type="button"
          onClick={onTogglePointLabels}
          className={`rounded-md w-full px-3 py-2 text-left text-sm transition-colors border ${
            showPointLabels
              ? 'bg-[#00E0FF]/15 border-[#00E0FF]/45 text-[#EAEAEA]'
              : 'border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E]'
          }`}
        >
          {showPointLabels ? '隐藏点位文字' : '显示点位文字'}
          <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
            Cesium Label，贴地；与右上角工具栏「图层」面板内「点位名称」联动。
          </span>
        </button>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">脉冲椭圆环（ring 数据源）</div>
        <button
          type="button"
          onClick={onTogglePulseRingDemo}
          className={`rounded-md w-full px-3 py-2 text-left text-sm transition-colors border ${
            pulseRingDemoAll
              ? 'bg-[#00E0FF]/15 border-[#00E0FF]/45 text-[#EAEAEA]'
              : 'border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E]'
          }`}
        >
          {pulseRingDemoAll ? '关闭「全部点位」脉冲示例' : '开启脉冲椭圆环示例'}
          <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
            CesiumMap ring：Ellipse + CallbackProperty 扩散与淡出；开启后对当前图层内全部 base/event 点位生效。关闭后恢复仅事件 / 高危 / 大尺寸显示环。
          </span>
        </button>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">手动绘制 · 点 / 线 / 面 / 矩形</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {drawBtn('point', '点')}
          {drawBtn('polyline', '折线')}
          {drawBtn('polygon', '多边形')}
          {drawBtn('rectangle', '矩形')}
        </div>
        <p className="text-[10px] text-[#666677] leading-relaxed mb-2">
          点：左键一下结束。折线 / 面 / 矩形均基于 @cesium-extends/drawer：左键落笔（矩形为第一角点），移动预览，右键完成；双击撤销上一步。线 ≥2 点、面 ≥3 点；面与矩形回调含范围内点位并按图层分组。
          Esc：线 / 面 / 矩形重新起笔；点模式清空当前预览点。每次绘制完成后图形留在地图上（持久层）。
        </p>
        <button
          type="button"
          onClick={() => onDrawModeChange('none')}
          disabled={drawMode === 'none'}
          className="rounded-md w-full border border-[#3A3A4E] px-3 py-1.5 text-[11px] text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#2A2A3E] disabled:opacity-40 disabled:pointer-events-none mb-2"
        >
          退出绘制模式
        </button>
        <button
          type="button"
          onClick={onClearMapDrawPersist}
          className="rounded-md w-full border border-[#3A3A4E] px-3 py-1.5 text-[11px] text-[#8888AA] hover:text-[#FFAA66] hover:bg-[#2A2A3E]"
        >
          清空地图上已提交的绘制结果
        </button>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">单张贴图（矩形范围）</div>
        <button
          type="button"
          onClick={onToggleSingleTileDemo}
          className={`rounded-md w-full px-3 py-2 text-left text-sm transition-colors border ${
            singleTileDemoOn
              ? 'bg-[#00E0FF]/20 border-[#00E0FF]/50 text-[#EAEAEA]'
              : 'border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E]'
          }`}
        >
          {singleTileDemoOn ? '隐藏示例贴图' : '显示示例贴图'}
          <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
            CesiumMap 根据 singleTileOverlays 挂载 SingleTileImageryProvider；配置见 demoSingleTileOverlay.ts。
          </span>
        </button>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E]/95 backdrop-blur-md p-3 shadow-lg">
        <div className="text-xs font-medium text-[#8888AA] mb-2">演示操作</div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onScenarioChange('manualB')}
            className="rounded-md bg-[#00E0FF]/15 border border-[#00E0FF]/40 px-3 py-2 text-left text-sm text-[#EAEAEA] hover:bg-[#00E0FF]/25 transition-colors"
          >
            加载不同图层数据
            <span className="block text-[11px] text-[#8888AA] mt-0.5 font-normal">
              切换为场景 B（西部/西南点位 + 独立轨迹与区域）
            </span>
          </button>
          <button
            type="button"
            onClick={() => onScenarioChange('default')}
            disabled={scenario === 'default'}
            className="rounded-md border border-[#3A3A4E] px-3 py-2 text-left text-sm text-[#EAEAEA] hover:bg-[#2A2A3E] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            恢复默认演示数据
          </button>
          <button
            type="button"
            onClick={onClearPickLog}
            disabled={!lastPickPayloadJson}
            className="rounded-md border border-[#3A3A4E] px-3 py-2 text-left text-sm text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#2A2A3E] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            清空点击回调展示
          </button>
        </div>
        <div className="mt-2 text-[10px] text-[#666677]">
          当前数据场景：<span className="text-[#00E0FF]">{scenario === 'default' ? '默认（全量 demo）' : '手动场景 B'}</span>
        </div>
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#121212]/95 backdrop-blur-md p-3 shadow-lg max-h-48 flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
          <span className="text-xs font-medium text-[#8888AA]">绘制完成回调（JSON）</span>
          <button
            type="button"
            onClick={onClearDrawResult}
            disabled={!lastDrawResultJson}
            className="text-[10px] text-[#8888AA] hover:text-[#EAEAEA] disabled:opacity-40 disabled:pointer-events-none"
          >
            清空
          </button>
        </div>
        {!lastDrawResultJson ? (
          <p className="text-[11px] text-[#666677] py-2">
            完成一次绘制后，此处展示结构化结果；面与矩形含 entitiesByLayer（ads / ais / base / event / dense）。
          </p>
        ) : (
          <pre className="text-[11px] text-[#C8D8FF] overflow-auto leading-relaxed whitespace-pre-wrap break-all font-mono flex-1 min-h-0">
            {lastDrawResultJson}
          </pre>
        )}
      </div>

      <div className="rounded-lg border border-[#3A3A4E] bg-[#121212]/95 backdrop-blur-md p-3 shadow-lg max-h-56 flex flex-col">
        <div className="text-xs font-medium text-[#8888AA] mb-1 shrink-0">onEntityClick 回调数据（JSON）</div>
        {!lastPickPayloadJson ? (
          <p className="text-[11px] text-[#666677] py-2">点击地图上任意点位后，此处展示传入的完整对象（与地图 `_payload` 一致）。</p>
        ) : (
          <pre className="text-[11px] text-[#C8E8C8] overflow-auto leading-relaxed whitespace-pre-wrap break-all font-mono">
            {lastPickPayloadJson}
          </pre>
        )}
      </div>
    </div>
  );
}
