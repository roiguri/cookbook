import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

const REQUIRED_TAPS = 7;
const WINDOW_MS = 2000;

interface EasterEggContextValue {
  unlocked: boolean;
  tapCount: number;
  registerLogoTap: () => void;
  resetSession: () => void;
}

const EasterEggContext = createContext<EasterEggContextValue>({
  unlocked: false,
  tapCount: 0,
  registerLogoTap: () => {},
  resetSession: () => {},
});

export function EasterEggProvider({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const tapsRef = useRef<number[]>([]);

  const registerLogoTap = useCallback(() => {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t <= WINDOW_MS), now];
    setTapCount(tapsRef.current.length);
    if (tapsRef.current.length >= REQUIRED_TAPS) {
      tapsRef.current = [];
      setTapCount(0);
      setUnlocked(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push('/games');
    }
  }, []);

  const resetSession = useCallback(() => {
    tapsRef.current = [];
    setTapCount(0);
    setUnlocked(false);
  }, []);

  return (
    <EasterEggContext.Provider value={{ unlocked, tapCount, registerLogoTap, resetSession }}>
      {children}
    </EasterEggContext.Provider>
  );
}

export function useEasterEgg() {
  return useContext(EasterEggContext);
}
