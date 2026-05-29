import type { Metadata } from 'next';
import './globals.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import CesiumInitializer from '@/components/cesium/CesiumInitializer';

export const metadata: Metadata = {
  title: {
    default: '数智融合智能体 | Intelligence Fusion Agent Platform',
    template: '%s | 数智融合智能体',
  },
  description:
    '以智能体为核心，基于多元数据融合，提供开源情报获取、智能问答、态势洞察、GIS可视化联动的一站式信息服务应用',
  keywords: [
    '数智融合',
    '智能体',
    '情报分析',
    '态势感知',
    'GIS可视化',
    'AI问答',
  ],
  authors: [{ name: 'Coze Code Team', url: 'https://code.coze.cn' }],
  generator: 'Coze Code',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: '扣子编程 | 你的 AI 工程师已就位',
    description:
      '我正在使用扣子编程 Vibe Coding，让创意瞬间上线。告别拖拽，拥抱心流。',
    url: 'https://code.coze.cn',
    siteName: '扣子编程',
    locale: 'zh_CN',
    type: 'website',
    // images: [
    //   {
    //     url: '',
    //     width: 1200,
    //     height: 630,
    //     alt: '扣子编程 - 你的 AI 工程师',
    //   },
    // ],
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Coze Code | Your AI Engineer is Here',
  //   description:
  //     'Build and deploy full-stack applications through AI conversation. No env setup, just flow.',
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>
        <CesiumInitializer />
        {children}
      </body>
    </html>
  );
}
