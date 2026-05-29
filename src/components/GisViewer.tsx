'use client';

import { useState, useRef, useEffect, useCallback, type RefObject, type ReactNode } from 'react';
import { Entity, Trajectory, Region, Task, SubTask, GisData } from '@/types/prd';
import CesiumMap, {
  CesiumMapRef,
  type GisOperation,
  type SingleTileOverlaySpec,
  type BillboardGlowHighlightOptions,
  type MapDrawMode,
  type MapDrawResult,
} from './cesium/CesiumMap';

// 定义地球纹理类型
interface GlobeStyle {
  id: string;
  name: string;
  description: string;
}

// 可用的地球纹理样式
const GLOBE_STYLES: GlobeStyle[] = [
  {
    id: 'local-mixed',
    name: '本地混合（推荐）',
    description: '本地高清瓦片 + 网络底图补齐',
  },
  {
    id: 'blue-marble',
    name: '蓝色大理石 (经典)',
    description: 'ArcGIS World Imagery 卫星影像',
  },
  {
    id: 'dark',
    name: '深色模式',
    description: 'CARTO 深色主题，适合夜间使用',
  },
  {
    id: 'terrain',
    name: '地形图',
    description: 'ESRI 世界地形底图',
  },
  {
    id: 'ocean',
    name: '海洋图',
    description: 'ESRI 海洋基底图',
  },
  {
    id: 'night',
    name: '夜景模式',
    description: 'NASA 黑大理石夜景影像',
  },
];

// 定义图层类型
interface LayerConfig {
  id: string;
  name: string;
  description: string;
  category: 'entity' | 'trajectory';
  filter?: (item: any) => boolean;
}

// 可用的数据图层
const DATA_LAYERS: LayerConfig[] = [
  {
    id: 'ads',
    name: '飞机',
    description: 'ADS-B广播式自动相关监视（3000+实时航空器）',
    category: 'entity',
    filter: (e: Entity) => e.type === 'aircraft',
  },
  {
    id: 'ais',
    name: '船舶',
    description: 'AIS船舶自动识别系统（300+实时节点）',
    category: 'entity',
    filter: (e: Entity) => e.type === 'ship',
  },
  {
    id: 'base',
    name: '基站',
    description: '监测基站与地面设施',
    category: 'entity',
    filter: (e: Entity) => e.type === 'base',
  },
  {
    id: 'trajectory',
    name: '轨迹',
    description: '航行与通信轨迹线',
    category: 'trajectory',
  },
];

// 事件颜色池
const EVENT_COLORS = ['#FF44FF', '#00E0FF', '#FFAA00', '#44FF44', '#FFFF44', '#FF4444'];

interface GisViewerProps {
  entities: Entity[];
  trajectories?: Trajectory[];
  regions?: Region[];
  selectedEntity?: Entity | null;
  onEntityClick?: (entity: Entity) => void;
  selectedTask?: Task | null;
  onCloseTaskDetail?: () => void;
  eventGisDataList?: GisData[];
  onCloseEventGis?: (eventId: string) => void;
  onCloseAllEventGis?: () => void;
  denseCells?: Array<{
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    count: number;
  }>;
  onViewportChange?: (viewport: { lat: number; lng: number; altitude: number }) => void;
  onSceneModeChange?: (mode: '2D' | '3D') => void;
  rightPanelOpen?: boolean;
  fireOverlayVisible?: boolean;
  /** 底图之上的 SingleTile 影像层（PNG/JPEG 轴对齐矩形） */
  singleTileOverlays?: SingleTileOverlaySpec[];
  billboardGlowHighlight?: BillboardGlowHighlightOptions;
  /** 脉冲椭圆环：为全部可见 base/event 点画环（示例用） */
  pulseRingDemoAll?: boolean;
  /** 地图手动绘制（点/线/面/矩形） */
  drawTool?: {
    mode: MapDrawMode;
    onDrawComplete?: (result: MapDrawResult) => void;
  };
  /** 递增时清空地图上已提交的绘制几何 */
  mapDrawPersistClearVersion?: number;
  /** 显示点位名称；不传则由组件内部状态控制（默认关） */
  showPointLabels?: boolean;
  onShowPointLabelsChange?: (visible: boolean) => void;
  /** 后端推送的 GIS 操作指令（自动执行 flyTo/render 等） */
  pendingOperations?: GisOperation[];
  /** 可选：与内部 CesiumMap 共享 ref（示例页风场 Canvas 等） */
  cesiumMapRef?: RefObject<CesiumMapRef | null>;
  /** 叠在地球之上、工具栏之下；须自带 pointer-events-none（如风场粒子 Canvas） */
  mapCanvasOverlay?: ReactNode;
}

export default function GisViewer({
  entities,
  trajectories = [],
  regions = [],
  selectedEntity,
  onEntityClick,
  selectedTask,
  onCloseTaskDetail,
  eventGisDataList = [],
  onCloseEventGis,
  onCloseAllEventGis,
  denseCells = [],
  onViewportChange,
  onSceneModeChange,
  rightPanelOpen = false,
  fireOverlayVisible = false,
  singleTileOverlays,
  billboardGlowHighlight,
  pulseRingDemoAll,
  drawTool,
  mapDrawPersistClearVersion,
  showPointLabels: showPointLabelsProp,
  onShowPointLabelsChange,
  pendingOperations,
  cesiumMapRef: cesiumMapRefProp,
  mapCanvasOverlay,
}: GisViewerProps) {
  const rightPosClass = rightPanelOpen ? 'right-[calc(24rem+1rem)]' : 'right-4';
  // 根据事件索引分配颜色
  const getEventColor = (eventId: string) => {
    const index = eventGisDataList.findIndex((g) => g.eventId === eventId);
    return EVENT_COLORS[index % EVENT_COLORS.length];
  };

  const [currentStyle, setCurrentStyle] = useState<string>('blue-marble');
  const [showStylePanel, setShowStylePanel] = useState(false);

  // 工具栏展开/收起状态
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  // 图层面板显示状态
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  // 已选中的图层（默认除「轨迹」外全开：贴地轨迹多时较耗性能，需用时再勾）
  const [activeLayers, setActiveLayers] = useState<Set<string>>(
    () => new Set(DATA_LAYERS.map((l) => l.id).filter((id) => id !== 'trajectory'))
  );
  // 2D/3D 场景模式（与 CesiumMap 默认 SCENE2D 一致）
  const [sceneMode, setSceneMode] = useState<'2D' | '3D'>('2D');
  // 事件联动面板展开/收起（默认收起）
  const [eventPanelExpanded, setEventPanelExpanded] = useState(false);
  const [internalPointLabels, setInternalPointLabels] = useState(false);
  const pointLabelsVisible =
    showPointLabelsProp !== undefined ? showPointLabelsProp : internalPointLabels;
  const setPointLabelsVisible = useCallback(
    (v: boolean) => {
      onShowPointLabelsChange?.(v);
      if (showPointLabelsProp === undefined) {
        setInternalPointLabels(v);
      }
    },
    [showPointLabelsProp, onShowPointLabelsChange]
  );
  const internalCesiumMapRef = useRef<CesiumMapRef>(null);
  const cesiumMapRef = cesiumMapRefProp ?? internalCesiumMapRef;

  // 火灾 overlay 显隐控制
  useEffect(() => {
    if (fireOverlayVisible) {
      cesiumMapRef.current?.showFireOverlay();
    } else {
      cesiumMapRef.current?.hideFireOverlay();
    }
  }, [fireOverlayVisible]);

  // 后端推送的 GIS 操作指令自动执行
  useEffect(() => {
    if (!pendingOperations || pendingOperations.length === 0) return;
    pendingOperations.forEach((op) => {
      cesiumMapRef.current?.executeOperation(op);
    });
  }, [pendingOperations]);

  // 获取当前选中的样式
  const activeStyle = GLOBE_STYLES.find((s) => s.id === currentStyle) || GLOBE_STYLES[0];

  // 切换图层选中状态
  const toggleLayer = (layerId: string) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  return (
    <div className="relative w-full h-full bg-[#0a0a1a]" style={{ touchAction: 'none' }}>
      {/* 地球容器：内层双叠 absolute，避免 2D 覆盖层与 WebGL 合成异常；覆盖层须透明背景 */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 z-0 min-h-0 min-w-0">
          <CesiumMap
            ref={cesiumMapRef}
            entities={entities}
            trajectories={trajectories}
            regions={regions}
            eventGisDataList={eventGisDataList}
            denseCells={denseCells}
            activeLayers={activeLayers}
            currentStyle={currentStyle}
            selectedEntity={selectedEntity || null}
            onEntityClick={onEntityClick || (() => {})}
            onViewportChange={onViewportChange}
            singleTileOverlays={singleTileOverlays}
            billboardGlowHighlight={billboardGlowHighlight}
            pulseRingDemoAll={pulseRingDemoAll}
            drawTool={drawTool}
            mapDrawPersistClearVersion={mapDrawPersistClearVersion}
            showPointLabels={pointLabelsVisible}
          />
        </div>
        {mapCanvasOverlay ? (
          <div className="pointer-events-none absolute inset-0 z-[2] min-h-0 min-w-0 overflow-hidden bg-transparent">
            {mapCanvasOverlay}
          </div>
        ) : null}
      </div>

      {/* 工具栏容器 */}
      <div className={`absolute top-4 z-20 flex items-start gap-2 transition-all duration-300 ${rightPosClass}`}>
        {/* 展开/收起按钮 */}
        <button
          onClick={() => {
            setToolbarExpanded(!toolbarExpanded);
            if (toolbarExpanded) {
              setShowStylePanel(false);
              setShowLayerPanel(false);
            }
          }}
          className={`glass-panel rounded-lg p-2 transition-colors ${
            toolbarExpanded ? 'text-[#00E0FF]' : 'text-[#8888AA] hover:text-[#EAEAEA]'
          }`}
          title={toolbarExpanded ? '收起工具栏' : '展开工具栏'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: toolbarExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* 展开状态下的工具按钮 */}
        {toolbarExpanded && (
          <div className="flex gap-2 animate-in fade-in slide-in-from-right-2">
            {/* 重置视角按钮 */}
            <button
              onClick={() => {
                cesiumMapRef.current?.resetView();
                setShowStylePanel(false);
                setShowLayerPanel(false);
              }}
              className="glass-panel rounded-lg p-2 transition-colors text-[#8888AA] hover:text-[#EAEAEA]"
              title="重置地图视角"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>

            {/* 2D/3D 切换按钮 */}
            <button
              onClick={() => {
                const next = sceneMode === '3D' ? '2D' : '3D';
                setSceneMode(next);
                cesiumMapRef.current?.toggleSceneMode();
                onSceneModeChange?.(next);
                setShowStylePanel(false);
                setShowLayerPanel(false);
              }}
              className="glass-panel rounded-lg px-2 py-2 transition-colors text-[#8888AA] hover:text-[#EAEAEA] text-xs font-bold min-w-[28px] flex items-center justify-center"
              title={`当前${sceneMode}模式，点击切换`}
            >
              {sceneMode}
            </button>

            {/* 调试镜头参数按钮（已注释）
            <button
              onClick={() => {
                const params = cesiumMapRef.current?.getCurrentCameraParams();
                if (params) {
                  console.log('[CameraDebug]', params);
                  const text = `lng: ${params.lng.toFixed(6)}, lat: ${params.lat.toFixed(6)}, altitude: ${Math.round(params.altitude)}, heading: ${params.heading.toFixed(2)}, pitch: ${params.pitch.toFixed(2)}, roll: ${params.roll.toFixed(2)}`;
                  alert(text);
                }
              }}
              className="glass-panel rounded-lg px-2 py-2 transition-colors text-[#8888AA] hover:text-[#EAEAEA] text-xs font-bold min-w-[28px] flex items-center justify-center"
              title="获取当前相机参数"
            >
              Cam
            </button>
            */}

            {/* 图层切换按钮 */}
            <button
              onClick={() => {
                setShowLayerPanel(!showLayerPanel);
                setShowStylePanel(false);
              }}
              className={`glass-panel rounded-lg p-2 transition-colors ${
                showLayerPanel ? 'bg-white/10 text-[#00E0FF]' : 'text-[#8888AA] hover:text-[#EAEAEA]'
              }`}
              title="数据图层"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </button>

            {/* 样式切换按钮 */}
            <button
              onClick={() => {
                setShowStylePanel(!showStylePanel);
                setShowLayerPanel(false);
              }}
              className={`glass-panel rounded-lg p-2 transition-colors ${
                showStylePanel ? 'bg-white/10 text-[#00E0FF]' : 'text-[#8888AA] hover:text-[#EAEAEA]'
              }`}
              title="切换地球样式"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r="2.5" />
                <circle cx="17.5" cy="10.5" r="2.5" />
                <circle cx="8.5" cy="7.5" r="2.5" />
                <circle cx="6.5" cy="12.5" r="2.5" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
              </svg>
            </button>

            {/* 事件联动按钮 */}
            {eventGisDataList.length > 0 && (
              <button
                onClick={() => {
                  setEventPanelExpanded(!eventPanelExpanded);
                  setShowStylePanel(false);
                  setShowLayerPanel(false);
                }}
                className={`glass-panel rounded-lg px-2 py-2 transition-colors text-xs font-bold flex items-center justify-center gap-1 ${
                  eventPanelExpanded ? 'bg-[#FF44FF]/20 text-[#FF44FF]' : 'text-[#8888AA] hover:text-[#FF44FF]'
                }`}
                title="事件地图联动"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF44FF] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF44FF]" />
                </span>
                {eventGisDataList.length}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 样式选择面板 */}
      {showStylePanel && (
        <div className={`absolute top-16 z-20 glass-panel rounded-lg p-2 w-64 animate-in fade-in slide-in-from-top-2 ${rightPosClass}`}>
          <div className="text-xs font-medium text-[#8888AA] mb-2 px-2">选择地球样式</div>
          <div className="space-y-1">
            {GLOBE_STYLES.map((style) => (
              <button
                key={style.id}
                onClick={() => {
                  setCurrentStyle(style.id);
                  setShowStylePanel(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                  currentStyle === style.id
                    ? 'bg-[#00E0FF]/20 text-[#00E0FF]'
                    : 'text-[#EAEAEA] hover:bg-white/5'
                }`}
              >
                <div className="flex flex-col items-start">
                  <span>{style.name}</span>
                  <span className="text-[10px] text-[#8888AA] font-normal truncate max-w-[180px]">
                    {style.description}
                  </span>
                </div>
                {currentStyle === style.id && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 图层选择面板 */}
      {showLayerPanel && (
        <div className={`absolute top-16 z-20 glass-panel rounded-lg p-2 w-64 animate-in fade-in slide-in-from-top-2 ${rightPosClass}`}>
          <div className="flex items-center justify-between mb-2 px-2">
            <div className="text-xs font-medium text-[#8888AA]">数据图层</div>
            <button
              onClick={() => {
                const allIds = new Set(DATA_LAYERS.map((l) => l.id));
                const allActive = DATA_LAYERS.every((l) => activeLayers.has(l.id));
                setActiveLayers(allActive ? new Set() : allIds);
              }}
              className="text-[10px] text-[#00E0FF] hover:text-[#00E0FF]/80 transition-colors"
            >
              {DATA_LAYERS.every((l) => activeLayers.has(l.id)) ? '全部取消' : '全部选中'}
            </button>
          </div>
          <div className="space-y-1">
            {DATA_LAYERS.map((layer) => (
              <button
                key={layer.id}
                onClick={() => toggleLayer(layer.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                  activeLayers.has(layer.id)
                    ? 'bg-[#00E0FF]/20 text-[#00E0FF]'
                    : 'text-[#EAEAEA] hover:bg-white/5'
                }`}
              >
                <div className="flex flex-col items-start">
                  <span>{layer.name}</span>
                  <span className="text-[10px] text-[#8888AA] font-normal truncate max-w-[180px]">
                    {layer.description}
                  </span>
                </div>
                {activeLayers.has(layer.id) && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPointLabelsVisible(!pointLabelsVisible)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors mt-1 border border-[#3A3A4E]/80 ${
                pointLabelsVisible
                  ? 'bg-[#00E0FF]/15 text-[#00E0FF]'
                  : 'text-[#EAEAEA] hover:bg-white/5'
              }`}
            >
              <div className="flex flex-col items-start text-left">
                <span>点位名称</span>
                <span className="text-[10px] text-[#8888AA] font-normal">地图上与点位绑定的文字标签</span>
              </div>
              <span className="text-[11px] tabular-nums shrink-0">{pointLabelsVisible ? '显示' : '隐藏'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 事件联动提示 - 支持多事件（默认收起，点击展开） */}
      {eventGisDataList.length > 0 && eventPanelExpanded && (
        <div className={`absolute bottom-14 z-20 glass-panel rounded-lg p-3 w-64 animate-in fade-in slide-in-from-bottom-2 ${rightPosClass}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF44FF] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF44FF]" />
              </span>
              <span className="text-xs text-[#EAEAEA] font-medium">事件地图联动中</span>
              <span className="text-[10px] text-[#8888AA]">({eventGisDataList.length}个)</span>
            </div>
            <button
              onClick={onCloseAllEventGis}
              className="text-[10px] text-[#8888AA] hover:text-[#FF4444] transition-colors"
            >
              全部清除
            </button>
          </div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {eventGisDataList.map((gisData) => {
              const color = getEventColor(gisData.eventId!);
              return (
                <div key={gisData.eventId} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-[#8888AA] truncate">{gisData.eventName || gisData.eventId}</span>
                    <span className="text-[10px] text-[#666677]">
                      {gisData.entities?.length ?? 0}实体
                      {gisData.trajectories ? `/${gisData.trajectories.length}轨迹` : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => onCloseEventGis?.(gisData.eventId!)}
                    className="text-[#8888AA] hover:text-[#EAEAEA] text-xs flex-shrink-0 ml-1"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 操作提示 */}
      <div className={`absolute bottom-4 z-10 glass-panel rounded-lg px-3 py-2 ${rightPosClass}`}>
        <span className="text-xs text-[#8888AA]">拖拽旋转 | 滚轮缩放 | 点击标记查看详情</span>
      </div>

      {/* 选中实体信息 */}
      {selectedEntity && !selectedTask && (
        <div className="absolute top-4 left-4 z-20 glass-panel rounded-lg p-4 max-w-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`w-3 h-3 rounded-full ${
                    selectedEntity.status === 'danger'
                      ? 'bg-[#FF4444]'
                      : selectedEntity.status === 'warning'
                        ? 'bg-[#FFAA00]'
                        : 'bg-[#00E0FF]'
                  }`}
                />
                <span className="text-[#EAEAEA] font-medium">{selectedEntity.name}</span>
              </div>
              <div className="space-y-1 text-sm text-[#8888AA]">
                <div>
                  类型：
                  {selectedEntity.type === 'ship'
                    ? '船舶'
                    : selectedEntity.type === 'aircraft'
                      ? '航空器'
                      : '基站'}
                </div>
                <div>
                  坐标：{selectedEntity.coordinates[0].toFixed(4)}, {selectedEntity.coordinates[1].toFixed(4)}
                </div>
                <div>
                  状态：
                  <span
                    className={
                      selectedEntity.status === 'danger'
                        ? 'text-[#FF4444]'
                        : selectedEntity.status === 'warning'
                          ? 'text-[#FFAA00]'
                          : 'text-[#00E0FF]'
                    }
                  >
                    {selectedEntity.status === 'danger' ? '危险' : selectedEntity.status === 'warning' ? '警告' : '正常'}
                  </span>
                </div>
                {(selectedEntity as any).speed != null && (
                  <div>
                    航速：{(selectedEntity as any).speed}
                    {selectedEntity.type === 'ship' ? '节' : 'km/h'}
                  </div>
                )}
                {(selectedEntity as any).heading != null && (
                  <div>航向：{Math.round((selectedEntity as any).heading)}°</div>
                )}
                {(selectedEntity as any).altitude != null && (
                  <div>高度：{Math.round((selectedEntity as any).altitude)}m</div>
                )}
                {selectedEntity.description && (
                  <div className="text-xs text-[#666677] mt-1 pt-1 border-t border-[#3A3A4E]/50">
                    {selectedEntity.description}
                  </div>
                )}
              </div>
            </div>
            <button onClick={() => onEntityClick?.(selectedEntity)} className="text-[#8888AA] hover:text-[#EAEAEA]">
              ×
            </button>
          </div>
        </div>
      )}

      {/* 选中任务子任务进度弹窗 */}
      {selectedTask && selectedTask.subTasks && (
        <div className="absolute top-4 left-4 z-20 glass-panel rounded-lg p-4 w-80 max-h-[70vh] overflow-y-auto">
          <TaskSubTaskPanel task={selectedTask} onClose={onCloseTaskDetail} />
        </div>
      )}
    </div>
  );
}

// 子任务进度面板组件
function TaskSubTaskPanel({ task, onClose }: { task: Task; onClose?: () => void }) {
  const subTasks = task.subTasks || [];
  const completedCount = subTasks.filter((s) => s.status === 'completed').length;
  const progressText = `${completedCount}/${subTasks.length}`;
  const progressPercent = subTasks.length > 0 ? (completedCount / subTasks.length) * 100 : 0;

  const getSubTaskStatusStyle = (status: SubTask['status']) => {
    switch (status) {
      case 'completed':
        return { color: '#44FF44', bg: 'bg-[#44FF44]/10', label: '已完成' };
      case 'running':
        return { color: '#FFAA00', bg: 'bg-[#FFAA00]/10', label: '进行中' };
      case 'failed':
        return { color: '#FF4444', bg: 'bg-[#FF4444]/10', label: '失败' };
      default:
        return { color: '#8888AA', bg: 'bg-[#8888AA]/10', label: '待执行' };
    }
  };

  const getSubTaskIcon = (status: SubTask['status']) => {
    switch (status) {
      case 'completed':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#44FF44" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        );
      case 'running':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFAA00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        );
      case 'failed':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8888AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
          </svg>
        );
    }
  };

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[#EAEAEA] font-medium text-sm truncate">{task.name}</div>
          <div className="text-xs text-[#8888AA] mt-0.5">
            {task.type === 'daily' ? '日报' : task.type === 'weekly' ? '周报' : '实时监测'}
          </div>
        </div>
        <button onClick={onClose} className="text-[#8888AA] hover:text-[#EAEAEA] flex-shrink-0">
          ×
        </button>
      </div>

      {/* 进度概览 */}
      <div className="mb-4 p-3 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[#8888AA]">子任务进度</span>
          <span className="text-sm font-medium" style={{ color: '#00E0FF' }}>
            {progressText}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-[#3A3A4E] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPercent}%`,
              backgroundColor: progressPercent === 100 ? '#44FF44' : progressPercent > 0 ? '#FFAA00' : '#8888AA',
            }}
          />
        </div>
      </div>

      {/* 子任务列表 */}
      <div className="space-y-2">
        <div className="text-xs text-[#8888AA] mb-1">执行步骤</div>
        {subTasks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((subTask, index) => {
            const style = getSubTaskStatusStyle(subTask.status);
            return (
              <div
                key={subTask.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-[#2A2A3E]/50 border border-[#3A3A4E]/50 hover:border-[#00E0FF]/20 transition-colors"
              >
                {/* 序号 */}
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0"
                  style={{
                    backgroundColor: `${style.color}20`,
                    color: style.color,
                    border: `1px solid ${style.color}40`,
                  }}
                >
                  {index + 1}
                </div>

                {/* 图标 */}
                <div className="flex-shrink-0">{getSubTaskIcon(subTask.status)}</div>

                {/* 名称 + 描述 */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#EAEAEA] truncate">{subTask.name}</div>
                  {subTask.description && (
                    <div className="text-[11px] text-[#8888AA] mt-0.5 truncate">
                      {subTask.description}
                    </div>
                  )}
                </div>

                {/* 状态标签 */}
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${style.bg}`} style={{ color: style.color }}>
                  {style.label}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
