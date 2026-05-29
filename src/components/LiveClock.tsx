'use client';

import { useState, useEffect } from 'react';

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

export default function LiveClock() {
  const [time, setTime] = useState(() => formatDateTime(new Date()));

  useEffect(() => {
    const tick = () => setTime(formatDateTime(new Date()));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-base font-mono text-[#EAEAEA] whitespace-nowrap">
      {time}
    </span>
  );
}
