'use client';

import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import type { WindField } from '@datasourceintelligence/shared';
import { sampleWindUv, windMpsToDegreesPerSecond } from './demoWindField';

/** 屏幕点数上限：保留最旧→最新，略增拖尾（每段仍只 stroke 一次） */
const TRAIL_LEN = 4;

type Particle = {
  lon: number;
  lat: number;
  age: number;
  plon: number;
  plat: number;
  /** 屏幕尾迹（最旧 → 最新，最后一格为当前帧笔头） */
  trailX: number[];
  trailY: number[];
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 低速冷白蓝 → 中风青 (#00E0FF) → 高速暖白（与项目主色一致） */
function windParticleRgb(speedNorm: number): [number, number, number] {
  const t = smoothstep(0, 1, Math.min(1, Math.max(0, speedNorm)));
  if (t < 0.42) {
    const k = t / 0.42;
    return [lerp(188, 90, k), lerp(210, 200, k), lerp(248, 255, k)];
  }
  if (t < 0.78) {
    const k = (t - 0.42) / 0.36;
    return [lerp(90, 0, k), lerp(200, 224, k), lerp(255, 255, k)];
  }
  const k = (t - 0.78) / 0.22;
  return [lerp(0, 255, k), lerp(224, 248, k), lerp(255, 236, k)];
}

const scratchCartesian = new Cesium.Cartesian3();
const scratchWindow = new Cesium.Cartesian2();

type Props = {
  enabled: boolean;
  getViewer: () => Cesium.Viewer | null;
  windField: WindField;
  /** 默认 640；仍卡可改为 480 / 360 */
  particleCount?: number;
  /** 相对真实 m/s 的视觉放大，随相机高度可再调 */
  visualSpeedMult?: number;
};

function randomInBbox(wf: WindField): { lon: number; lat: number } {
  const { west, south, east, north } = wf.bbox;
  return {
    lon: west + Math.random() * (east - west),
    lat: south + Math.random() * (north - south),
  };
}

function initParticles(wf: WindField, n: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const { lon, lat } = randomInBbox(wf);
    out.push({
      lon,
      lat,
      age: Math.floor(Math.random() * 60),
      plon: lon,
      plat: lat,
      trailX: [],
      trailY: [],
    });
  }
  return out;
}

/**
 * 全屏 Canvas + scene.postRender：在 Cesium 上叠一层 Windy 风格粒子（无额外 npm 依赖）。
 * 与 SingleTile 热力图叠用需由父组件同时传入热力图 overlay。
 */
export default function WindParticleCanvasOverlay({
  enabled,
  getViewer,
  windField,
  particleCount = 640,
  visualSpeedMult = 4200,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastTRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      lastTRef.current = null;
      return;
    }
    particlesRef.current = initParticles(windField, particleCount);
  }, [enabled, windField, particleCount]);

  useEffect(() => {
    if (!enabled) return;

    let removePostRender: Cesium.Event.RemoveCallback | null = null;
    let cancelled = false;
    let ctx2d: CanvasRenderingContext2D | null = null;

    let attempts = 0;
    const attach = () => {
      if (cancelled) return;
      attempts++;
      if (attempts > 300) return;

      const canvas = canvasRef.current;
      const viewer = getViewer();
      if (!canvas || !viewer || viewer.isDestroyed()) {
        requestAnimationFrame(attach);
        return;
      }

      const ensureCtx = () => {
        if (!ctx2d || ctx2d.canvas !== canvas) {
          ctx2d = canvas.getContext('2d', { alpha: true });
        }
        return ctx2d;
      };

      const resize = () => {
        const c = viewer.scene.canvas;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          ctx2d = canvas.getContext('2d', { alpha: true });
        }
      };

      const onPostRender = () => {
        const v = getViewer();
        const cv = canvasRef.current;
        if (!v || v.isDestroyed() || !cv) return;
        const mapScene: Cesium.Scene = v.scene;
        const src = mapScene.canvas;
        const w = src.clientWidth;
        const h = src.clientHeight;
        if (cv.width !== w || cv.height !== h) {
          cv.width = w;
          cv.height = h;
          ctx2d = cv.getContext('2d', { alpha: true });
        }
        const drawCtx = ensureCtx();
        if (!drawCtx) return;

        const now = performance.now() / 1000;
        const last = lastTRef.current;
        lastTRef.current = now;
        const dt = last == null ? 1 / 60 : Math.min(0.05, Math.max(1 / 240, now - last));

        const wf = windField;
        const { west, south, east, north } = wf.bbox;
        // 每帧清空：避免全屏半透明叠帧把 WebGL 糊没；短尾迹仅存于各粒子 trail 数组
        drawCtx.clearRect(0, 0, cv.width, cv.height);
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';

        const particles = particlesRef.current;
        const mult = visualSpeedMult * dt;

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.plon = p.lon;
          p.plat = p.lat;

          const { u: uw, v: vw, speed } = sampleWindUv(wf, p.lon, p.lat);
          const { dLon, dLat } = windMpsToDegreesPerSecond(p.lat, uw, vw, mult);
          p.lon += dLon;
          p.lat += dLat;
          p.age += 1;

          const oob = p.lon < west || p.lon > east || p.lat < south || p.lat > north;
          const dead = p.age > 60 || oob || !Number.isFinite(p.lon);
          if (dead) {
            const sp = randomInBbox(wf);
            p.lon = sp.lon;
            p.lat = sp.lat;
            p.plon = p.lon;
            p.plat = p.lat;
            p.age = 0;
            p.trailX.length = 0;
            p.trailY.length = 0;
            continue;
          }

          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 800, undefined, scratchCartesian);
          const okB = mapScene.cartesianToCanvasCoordinates(scratchCartesian, scratchWindow);
          if (!okB) {
            p.trailX.length = 0;
            p.trailY.length = 0;
            continue;
          }
          const x1 = scratchWindow.x;
          const y1 = scratchWindow.y;

          p.trailX.push(x1);
          p.trailY.push(y1);
          if (p.trailX.length > TRAIL_LEN) {
            p.trailX.shift();
            p.trailY.shift();
          }

          const spNorm = Math.min(1, speed / 14);
          const [cr, cg, cb] = windParticleRgb(spNorm);
          const n = p.trailX.length;
          if (n < 2) continue;

          for (let s = 0; s < n - 1; s++) {
            const xa = p.trailX[s];
            const ya = p.trailY[s];
            const xb = p.trailX[s + 1];
            const yb = p.trailY[s + 1];
            // s 小 = 尾端（旧），s 大 = 靠笔头（新）；拖尾略渐亮、渐粗
            const segT = (s + 1) / (n - 1);
            const tail = segT ** 1.2;
            const baseA = 0.07 + tail * 0.46;
            const lw = 0.62 + tail * (0.58 + spNorm * 0.48);
            drawCtx.beginPath();
            drawCtx.moveTo(xa, ya);
            drawCtx.lineTo(xb, yb);
            drawCtx.strokeStyle = `rgba(${cr},${cg},${cb},${baseA.toFixed(3)})`;
            drawCtx.lineWidth = lw;
            drawCtx.stroke();
          }
        }
      };

      removePostRender = viewer.scene.postRender.addEventListener(onPostRender);
      resize();
      if (!ctx2d) {
        ctx2d = canvas.getContext('2d', { alpha: true });
      }
    };

    requestAnimationFrame(attach);

    return () => {
      cancelled = true;
      ctx2d = null;
      if (removePostRender) removePostRender();
      removePostRender = null;
      lastTRef.current = null;
    };
  }, [enabled, getViewer, windField, visualSpeedMult, particleCount]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full bg-transparent"
      style={{ backgroundColor: 'transparent' }}
      aria-hidden
    />
  );
}
