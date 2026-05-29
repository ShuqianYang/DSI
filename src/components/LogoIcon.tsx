"use client";

import React from "react";

interface LogoIconProps {
  className?: string;
  size?: number;
}

export default function LogoIcon({ className = "", size = 48 }: LogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* 核心球体3D光照 */}
        <radialGradient id="coreSphere" cx="30%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="15%" stopColor="#a5f3fc" stopOpacity="0.95" />
          <stop offset="35%" stopColor="#22d3ee" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#0891b2" stopOpacity="0.85" />
          <stop offset="85%" stopColor="#0c4a6e" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#020617" stopOpacity="1" />
        </radialGradient>

        {/* 内核高亮 */}
        <radialGradient id="innerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="30%" stopColor="#67e8f9" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#0891b2" stopOpacity="0" />
        </radialGradient>

        {/* 外层光环渐变 */}
        <linearGradient id="ringGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
          <stop offset="25%" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.2" />
          <stop offset="75%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.85" />
        </linearGradient>

        <linearGradient id="ringGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.8" />
          <stop offset="40%" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0891b2" stopOpacity="0.7" />
        </linearGradient>

        {/* 数据粒子球体 */}
        <radialGradient id="particle" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.8" />
        </radialGradient>

        {/* 能量射线渐变 */}
        <linearGradient id="rayGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>

        {/* 强发光 */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="b1" />
          <feGaussianBlur stdDeviation="3" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* 核心强光 */}
        <filter id="coreGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="b1" />
          <feGaussianBlur stdDeviation="5" result="b2" />
          <feGaussianBlur stdDeviation="8" result="b3" />
          <feMerge>
            <feMergeNode in="b3" />
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* 投影 */}
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* === 底层：环境光晕 === */}
      <circle cx="32" cy="32" r="26" fill="#22d3ee" opacity="0.06" filter="url(#coreGlow)" />
      <circle cx="32" cy="32" r="20" fill="#22d3ee" opacity="0.08" filter="url(#glow)" />

      {/* === 外层数据光环 === */}
      {/* 光环1 - X轴倾斜 */}
      <ellipse
        cx="32" cy="32"
        rx="28" ry="9"
        fill="none"
        stroke="url(#ringGrad1)"
        strokeWidth="1"
        transform="rotate(-35 32 32)"
        opacity="0.7"
      />
      {/* 光环1 - 对侧暗边增加立体 */}
      <ellipse
        cx="32" cy="32"
        rx="28" ry="9"
        fill="none"
        stroke="#000"
        strokeWidth="0.8"
        transform="rotate(-35 32 32)"
        opacity="0.25"
        strokeDasharray="20 60"
      />

      {/* 光环2 - Y轴倾斜 */}
      <ellipse
        cx="32" cy="32"
        rx="28" ry="9"
        fill="none"
        stroke="url(#ringGrad2)"
        strokeWidth="1"
        transform="rotate(35 32 32)"
        opacity="0.6"
      />
      <ellipse
        cx="32" cy="32"
        rx="28" ry="9"
        fill="none"
        stroke="#000"
        strokeWidth="0.8"
        transform="rotate(35 32 32)"
        opacity="0.25"
        strokeDasharray="20 60"
        strokeDashoffset="30"
      />

      {/* 光环3 - 垂直 */}
      <ellipse
        cx="32" cy="32"
        rx="26" ry="8"
        fill="none"
        stroke="url(#ringGrad1)"
        strokeWidth="0.7"
        transform="rotate(90 32 32)"
        opacity="0.4"
      />

      {/* === 中层：数据流轨道 === */}
      {/* 轨道1 */}
      <circle
        cx="32" cy="32" r="21"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="0.6"
        opacity="0.35"
        strokeDasharray="2 4 8 4"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 32 32"
          to="360 32 32"
          dur="12s"
          repeatCount="indefinite"
        />
      </circle>

      {/* 轨道2 - 反向 */}
      <circle
        cx="32" cy="32" r="17"
        fill="none"
        stroke="#67e8f9"
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="10 3 3 3"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="360 32 32"
          to="0 32 32"
          dur="8s"
          repeatCount="indefinite"
        />
      </circle>

      {/* 轨道3 */}
      <circle
        cx="32" cy="32" r="14"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="0.4"
        opacity="0.25"
        strokeDasharray="4 6"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 32 32"
          to="360 32 32"
          dur="6s"
          repeatCount="indefinite"
        />
      </circle>

      {/* === 数据粒子（轨道上的节点）=== */}
      {/* 粒子1 - 大轨道 */}
      <circle r="2" fill="url(#particle)" filter="url(#glow)">
        <animateMotion
          path="M 32,11 A 21,21 0 1,1 31.99,11"
          dur="12s"
          repeatCount="indefinite"
        />
      </circle>
      {/* 粒子2 - 大轨道对侧 */}
      <circle r="1.5" fill="url(#particle)" opacity="0.8">
        <animateMotion
          path="M 32,11 A 21,21 0 1,1 31.99,11"
          dur="12s"
          begin="6s"
          repeatCount="indefinite"
        />
      </circle>
      {/* 粒子3 - 中轨道 */}
      <circle r="1.8" fill="url(#particle)" filter="url(#glow)">
        <animateMotion
          path="M 32,15 A 17,17 0 1,0 32.01,15"
          dur="8s"
          repeatCount="indefinite"
        />
      </circle>
      {/* 粒子4 - 小轨道 */}
      <circle r="1.2" fill="url(#particle)" opacity="0.9">
        <animateMotion
          path="M 32,18 A 14,14 0 1,1 31.99,18"
          dur="6s"
          begin="3s"
          repeatCount="indefinite"
        />
      </circle>

      {/* === 核心智能体 === */}
      {/* 核心外层大气 */}
      <circle cx="32" cy="32" r="11" fill="url(#innerGlow)" opacity="0.5" />

      {/* 核心外环 */}
      <circle
        cx="32" cy="32" r="9"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.2"
        opacity="0.6"
        filter="url(#glow)"
      />

      {/* 核心球体 - 3D立体 */}
      <circle cx="32" cy="32" r="8" fill="url(#coreSphere)" filter="url(#shadow)" />

      {/* 核心球体高光 */}
      <ellipse cx="28.5" cy="27" rx="3" ry="2.2" fill="#ffffff" opacity="0.65" />
      <circle cx="27.2" cy="25.8" r="1" fill="#ffffff" opacity="0.9" />

      {/* 核心底部环境反光 */}
      <path
        d="M 26.5 36 Q 32 39 37.5 36"
        stroke="#67e8f9"
        strokeWidth="0.7"
        fill="none"
        opacity="0.35"
        strokeLinecap="round"
      />

      {/* 核心内部几何 - 智能晶体 */}
      <path
        d="M 32 26 L 36 32 L 32 38 L 28 32 Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.6"
        opacity="0.5"
      />
      <path
        d="M 32 28 L 34.5 32 L 32 36 L 29.5 32 Z"
        fill="#ffffff"
        opacity="0.15"
      />

      {/* === 能量射线 === */}
      <line x1="32" y1="10" x2="32" y2="18" stroke="url(#rayGrad)" strokeWidth="1" opacity="0.6" />
      <line x1="32" y1="46" x2="32" y2="54" stroke="url(#rayGrad)" strokeWidth="1" opacity="0.6" />
      <line x1="10" y1="32" x2="18" y2="32" stroke="url(#rayGrad)" strokeWidth="1" opacity="0.6" />
      <line x1="46" y1="32" x2="54" y2="32" stroke="url(#rayGrad)" strokeWidth="1" opacity="0.6" />

      {/* 对角射线 */}
      <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="url(#rayGrad)" strokeWidth="0.7" opacity="0.4" />
      <line x1="47.5" y1="16.5" x2="42" y2="22" stroke="url(#rayGrad)" strokeWidth="0.7" opacity="0.4" />
      <line x1="16.5" y1="47.5" x2="22" y2="42" stroke="url(#rayGrad)" strokeWidth="0.7" opacity="0.4" />
      <line x1="47.5" y1="47.5" x2="42" y2="42" stroke="url(#rayGrad)" strokeWidth="0.7" opacity="0.4" />

      {/* === 顶部感知波 === */}
      <path
        d="M 28 6 Q 32 2 36 6"
        stroke="#22d3ee"
        strokeWidth="1"
        fill="none"
        opacity="0.7"
        filter="url(#glow)"
      />
      <path
        d="M 25 4 Q 32 -2 39 4"
        stroke="#67e8f9"
        strokeWidth="0.8"
        fill="none"
        opacity="0.45"
      />
      <path
        d="M 22 2 Q 32 -6 42 2"
        stroke="#22d3ee"
        strokeWidth="0.6"
        fill="none"
        opacity="0.25"
      />
    </svg>
  );
}
