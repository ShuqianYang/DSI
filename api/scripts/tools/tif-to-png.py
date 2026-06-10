#!/usr/bin/env python3
"""
GeoTIFF -> PNG 转换脚本
支持：单波段灰度 / 多波段 RGB / dNBR 火灾指数

用法：
  python tif-to-png.py input.tif output.png [--mode rgb|dnbr|gray]

依赖：
  pip install tifffile imagecodecs opencv-python numpy
"""

import argparse
import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
    import tifffile
except ImportError as e:
    print(f"Error: {e}")
    print("请先安装依赖: pip install tifffile imagecodecs opencv-python numpy")
    sys.exit(1)


def stretch_uint8(arr: np.ndarray) -> np.ndarray:
    """2-98% 百分位拉伸到 0-255"""
    finite = np.isfinite(arr)
    if not np.any(finite):
        return np.zeros_like(arr, dtype=np.uint8)
    lo, hi = np.percentile(arr[finite], [2, 98])
    out = np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1)
    return (out * 255).astype(np.uint8)


def tif_info(path: str):
    """打印 TIF 基本信息"""
    arr = tifffile.imread(path)
    print(f"Shape: {arr.shape}")
    print(f"Dtype: {arr.dtype}")
    print(f"Min/Max: {np.nanmin(arr):.4f} / {np.nanmax(arr):.4f}")
    if arr.ndim == 3:
        print(f"Bands: {arr.shape[-1]}")
    return arr


def to_rgb(arr: np.ndarray) -> np.ndarray:
    """多波段 -> RGB PNG（取前3波段，按 B4/B3/B2 = R/G/B）"""
    if arr.ndim == 2:
        gray = stretch_uint8(arr)
        return np.stack([gray, gray, gray], axis=-1)

    n_bands = arr.shape[-1]
    if n_bands < 3:
        gray = stretch_uint8(arr[..., 0])
        return np.stack([gray, gray, gray], axis=-1)

    # 取前3波段，假设顺序为 B4/B3/B2 (R/G/B)
    r = stretch_uint8(arr[..., 0])
    g = stretch_uint8(arr[..., 1])
    b = stretch_uint8(arr[..., 2])
    rgb = np.stack([r, g, b], axis=-1)
    return rgb


def to_dnbr(arr: np.ndarray) -> np.ndarray:
    """
    计算 dNBR (Normalized Burn Ratio difference) 并输出伪彩色

    波段假设（Sentinel-2 10m/20m 子集）：
      band 0 = B4  (Red)
      band 1 = B3  (Green)
      band 2 = B2  (Blue)
      band 3 = B8  (NIR)
      band 4 = B11 (SWIR1)
      band 5 = B12 (SWIR2)

    NBR  = (NIR - SWIR2) / (NIR + SWIR2)
    dNBR = NBR_post - NBR_pre   （需要灾前灾后两张图）

    这里只做单张图的 NBR 显示（烧毁区高亮）
    """
    if arr.ndim != 3 or arr.shape[-1] < 6:
        print("Warning: dNBR 需要至少6波段数据， fallback 到 RGB")
        return to_rgb(arr)

    nir = arr[..., 3].astype(np.float32)
    swir2 = arr[..., 5].astype(np.float32)

    # 避免除零
    denom = nir + swir2
    denom[denom == 0] = 1e-6
    nbr = (nir - swir2) / denom

    # NBR 范围约 [-1, 1]，烧毁区 NBR 低（负值大）
    # 用伪彩色映射：低 NBR（烧毁）-> 红色，高 NBR（健康植被）-> 绿色
    nbr_norm = np.clip((nbr + 1) / 2, 0, 1)  # 归一化到 [0,1]

    # OpenCV 伪彩色：COLORMAP_JET（烧毁区=红色=低值，健康=蓝色=高值）
    # 反转一下让烧毁区显示为红色
    nbr_u8 = (nbr_norm * 255).astype(np.uint8)
    colored = cv2.applyColorMap(255 - nbr_u8, cv2.COLORMAP_JET)
    # BGR -> RGB
    colored = cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)
    return colored


def convert(input_path: str, output_path: str, mode: str = "rgb"):
    """主转换函数"""
    input_path = Path(input_path)
    output_path = Path(output_path)

    if not input_path.exists():
        print(f"Error: 文件不存在 {input_path}")
        sys.exit(1)

    print(f"Reading: {input_path}")
    arr = tifffile.imread(str(input_path))
    print(f"  Shape: {arr.shape}, Dtype: {arr.dtype}")

    if mode == "dnbr":
        rgb = to_dnbr(arr)
    elif mode == "gray":
        if arr.ndim == 3:
            arr = arr[..., 0]
        rgb = np.stack([stretch_uint8(arr)] * 3, axis=-1)
    else:
        rgb = to_rgb(arr)

    # RGB -> BGR for OpenCV
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(output_path), bgr)
    print(f"Saved: {output_path} ({rgb.shape[1]}x{rgb.shape[0]})")


def main():
    parser = argparse.ArgumentParser(description="GeoTIFF to PNG converter")
    parser.add_argument("input", help="输入 GeoTIFF 路径")
    parser.add_argument("output", help="输出 PNG 路径")
    parser.add_argument(
        "--mode",
        choices=["rgb", "dnbr", "gray"],
        default="rgb",
        help="转换模式: rgb=真彩色(B4/B3/B2), dnbr=NBR伪彩色(火灾高亮), gray=单波段灰度",
    )
    parser.add_argument("--info", action="store_true", help="仅打印 TIF 信息，不转换")
    args = parser.parse_args()

    if args.info:
        tif_info(args.input)
        return

    convert(args.input, args.output, args.mode)


if __name__ == "__main__":
    main()
