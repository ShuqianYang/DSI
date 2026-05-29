import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.dev.coze.site"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*",
        pathname: "/**",
      },
    ],
  },
  transpilePackages: [
    "lucide-react",
    "@cesium-extends/drawer",
    "@cesium-extends/common",
    "@cesium-extends/subscriber",
    "@cesium-extends/tooltip",
  ],
  webpack: (config, { dev }) => {
    // 某些第三方包发布产物硬编码了 react/jsx-dev-runtime，prod build 时 jsxDEV 不存在 → `(0, e.jsxDEV) is not a function`。
    // 用本地 shim 在 prod 里假装提供 jsxDEV（实际指向 prod 的 jsx）。
    if (!dev) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "react/jsx-dev-runtime": path.resolve(__dirname, "shims/jsx-dev-runtime.cjs"),
      };
    }
    return config;
  },
};

export default nextConfig;
