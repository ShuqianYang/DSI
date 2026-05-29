'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Entity } from '@/types/prd';
import type { CesiumMapRef } from '@/components/cesium/CesiumMap';
import {
  demoLayerEntities,
  demoLayerTrajectories,
  demoLayerRegions,
  demoLayerManualScenarioBEntities,
  demoLayerManualScenarioBTrajectories,
  demoLayerManualScenarioBRegions,
} from './demoLayerMocks';
import MultiLayerPointsDemoControls, { type MultiLayerDemoScenario } from './MultiLayerPointsDemoControls';
import { DEMO_SINGLE_TILE_PEARL_DELTA } from './demoSingleTileOverlay';
import { DEMO_BILLBOARD_GLOW_AMBER, DEMO_BILLBOARD_GLOW_CYAN } from './demoBillboardGlow';
import type { BillboardGlowHighlightOptions, SingleTileOverlaySpec } from '@/components/cesium/CesiumMap';
import WindParticleCanvasOverlay from './WindParticleCanvasOverlay';
import { DEMO_WIND_FIELD, createWindHeatmapSingleTile } from './demoWindField';
import type { MapDrawMode, MapDrawResult } from '@/types/mapDraw';

const EMPTY_SINGLE_TILE_OVERLAYS: SingleTileOverlaySpec[] = [];

const GisViewer = dynamic(() => import('@/components/GisViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#121212] text-[#8888AA] text-sm">
      地图加载中…
    </div>
  ),
});

/**
 * 多图层点位示例：复用主应用的 GisViewer + CesiumMap（飞机 / 船舶 / 基站图层开关、轨迹、区域面、点击详情）。
 * 数据来自同目录 demoLayerMocks（按图层拆分，不引用全局 mockData）。
 */
export default function MultiLayerPointsExample() {
  const cesiumMapRef = useRef<CesiumMapRef>(null);
  const [windFieldDemoOn, setWindFieldDemoOn] = useState(false);
  const [scenario, setScenario] = useState<MultiLayerDemoScenario>('default');
  const [singleTileDemoOn, setSingleTileDemoOn] = useState(false);
  const [billboardGlowOn, setBillboardGlowOn] = useState(false);
  const [billboardGlowUseAltImage, setBillboardGlowUseAltImage] = useState(false);
  const [pulseRingDemoAll, setPulseRingDemoAll] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [lastPickPayloadJson, setLastPickPayloadJson] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<MapDrawMode>('none');
  const [lastDrawResultJson, setLastDrawResultJson] = useState<string | null>(null);
  const [mapDrawPersistClearVersion, setMapDrawPersistClearVersion] = useState(0);
  const [showPointLabels, setShowPointLabels] = useState(false);

  const { entities, trajectories, regions } = useMemo(() => {
    if (scenario === 'manualB') {
      return {
        entities: demoLayerManualScenarioBEntities,
        trajectories: demoLayerManualScenarioBTrajectories,
        regions: demoLayerManualScenarioBRegions,
      };
    }
    return {
      entities: demoLayerEntities,
      trajectories: demoLayerTrajectories,
      regions: demoLayerRegions,
    };
  }, [scenario]);

  const windHeatmapOverlay = useMemo((): SingleTileOverlaySpec[] => {
    if (!windFieldDemoOn || typeof window === 'undefined') return [];
    return [createWindHeatmapSingleTile(DEMO_WIND_FIELD)];
  }, [windFieldDemoOn]);

  const singleTileOverlays = useMemo(() => {
    const base = singleTileDemoOn ? [DEMO_SINGLE_TILE_PEARL_DELTA] : EMPTY_SINGLE_TILE_OVERLAYS;
    return [...base, ...windHeatmapOverlay];
  }, [singleTileDemoOn, windHeatmapOverlay]);

  useEffect(() => {
    if (!windFieldDemoOn) return;
    const { west, east, south, north } = DEMO_WIND_FIELD.bbox;
    const lng = (west + east) / 2;
    const lat = (south + north) / 2;
    const maxDim = Math.max(east - west, north - south);
    const altitude = Math.min(4e6, Math.max(220_000, maxDim * 160_000));
    const t = window.setTimeout(() => {
      cesiumMapRef.current?.flyToRegion(lng, lat, altitude);
    }, 400);
    return () => clearTimeout(t);
  }, [windFieldDemoOn]);

  const billboardGlowHighlight = useMemo(
    (): BillboardGlowHighlightOptions => ({
      enabled: billboardGlowOn,
      imageUrl: billboardGlowUseAltImage ? DEMO_BILLBOARD_GLOW_AMBER : DEMO_BILLBOARD_GLOW_CYAN,
    }),
    [billboardGlowOn, billboardGlowUseAltImage]
  );

  const handleScenarioChange = useCallback((s: MultiLayerDemoScenario) => {
    setScenario(s);
    setSelectedEntity(null);
    setLastPickPayloadJson(null);
  }, []);

  const handleEntityClick = useCallback((entity: Entity) => {
    setLastPickPayloadJson(JSON.stringify(entity, null, 2));
    setSelectedEntity((prev) => (prev?.id === entity.id ? null : entity));
  }, []);

  const handleDrawComplete = useCallback((result: MapDrawResult) => {
    setLastDrawResultJson(JSON.stringify(result, null, 2));
    setDrawMode('none');
  }, []);

  const drawTool = useMemo(
    () => ({
      mode: drawMode,
      onDrawComplete: handleDrawComplete,
    }),
    [drawMode, handleDrawComplete]
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#121212]">
      <header className="h-11 shrink-0 bg-[#1E1E2E] border-b border-[#3A3A4E] flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[#EAEAEA]">GIS 自定义示例 · 多图层点位</span>
          <span className="text-xs text-[#8888AA] hidden sm:inline">
            工具栏「图层」切换飞机 / 船舶 / 基站 / 轨迹
          </span>
        </div>
        <Link
          href="/"
          className="text-xs text-[#00E0FF] hover:text-[#66EEFF] transition-colors"
        >
          返回主页
        </Link>
      </header>

      <main className="flex-1 relative min-h-0">
        <GisViewer
          cesiumMapRef={cesiumMapRef}
          mapCanvasOverlay={
            windFieldDemoOn ? (
              <WindParticleCanvasOverlay
                enabled
                getViewer={() => cesiumMapRef.current?.getViewer() ?? null}
                windField={DEMO_WIND_FIELD}
              />
            ) : null
          }
          entities={entities}
          trajectories={trajectories}
          regions={regions}
          selectedEntity={selectedEntity}
          onEntityClick={handleEntityClick}
          eventGisDataList={[]}
          denseCells={[]}
          rightPanelOpen={false}
          fireOverlayVisible={false}
          singleTileOverlays={singleTileOverlays}
          billboardGlowHighlight={billboardGlowHighlight}
          pulseRingDemoAll={pulseRingDemoAll}
          drawTool={drawTool}
          mapDrawPersistClearVersion={mapDrawPersistClearVersion}
          showPointLabels={showPointLabels}
          onShowPointLabelsChange={setShowPointLabels}
        />

        <MultiLayerPointsDemoControls
          windFieldDemoOn={windFieldDemoOn}
          onToggleWindFieldDemo={() => setWindFieldDemoOn((v) => !v)}
          scenario={scenario}
          onScenarioChange={handleScenarioChange}
          lastPickPayloadJson={lastPickPayloadJson}
          onClearPickLog={() => setLastPickPayloadJson(null)}
          singleTileDemoOn={singleTileDemoOn}
          onToggleSingleTileDemo={() => setSingleTileDemoOn((v) => !v)}
          billboardGlowOn={billboardGlowOn}
          onToggleBillboardGlow={() => setBillboardGlowOn((v) => !v)}
          billboardGlowUseAltImage={billboardGlowUseAltImage}
          onToggleBillboardGlowImage={() => setBillboardGlowUseAltImage((v) => !v)}
          pulseRingDemoAll={pulseRingDemoAll}
          onTogglePulseRingDemo={() => setPulseRingDemoAll((v) => !v)}
          showPointLabels={showPointLabels}
          onTogglePointLabels={() => setShowPointLabels((v) => !v)}
          drawMode={drawMode}
          onDrawModeChange={setDrawMode}
          lastDrawResultJson={lastDrawResultJson}
          onClearDrawResult={() => setLastDrawResultJson(null)}
          onClearMapDrawPersist={() => setMapDrawPersistClearVersion((v) => v + 1)}
        />
      </main>
    </div>
  );
}
