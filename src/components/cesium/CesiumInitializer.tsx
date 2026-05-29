'use client';

import { useEffect } from 'react';

export default function CesiumInitializer() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).CESIUM_BASE_URL = '/cesium/';
    }
  }, []);

  return null;
}
