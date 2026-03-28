import { useEffect, useRef } from 'react';

export function useDoubleTap(onSingle: () => void, onDouble: () => void, delay = 300) {
  const lastTap = useRef<number>(0);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < delay) {
      if (timer.current) clearTimeout(timer.current);
      onDouble();
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      timer.current = setTimeout(() => {
        onSingle();
      }, delay);
    }
  };

  return handleTap;
}
