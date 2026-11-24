import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';
import { BUNDLED_GAMES_HTML } from './bundled-games-html.generated';
import {
  type GameKey,
  type HapticStyle,
  type NativeToWebViewMessage,
  type PreferredOrientation,
  type WebViewToNativeMessage,
} from './games-catalog';

const OFFLINE_BASE_URL = 'https://cookbook.local/';

export interface GameReadyPayload {
  gameKey: GameKey;
  preferredOrientation: PreferredOrientation;
}

export interface GameWebViewHostProps {
  gameKey: GameKey;
  config?: Record<string, unknown>;
  asyncReady?: boolean;
  onReady?: (payload: GameReadyPayload) => void;
  onComplete?: (elapsedMs: number) => void;
  onGameOver?: (reason: string) => void;
  onClose?: () => void;
  onPausedChange?: (paused: boolean) => void;
  onError?: (message: string) => void;
}

export interface GameWebViewHostHandle {
  restart: () => void;
  pause: () => void;
  resume: () => void;
  markAsyncReady: () => void;
}

function triggerHaptic(style: HapticStyle) {
  switch (style) {
    case 'light':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      break;
    case 'medium':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      break;
    case 'success':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      break;
    case 'error':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      break;
    default:
      break;
  }
}

function isAllowedOfflineUrl(url: string): boolean {
  if (!url) return true;
  if (url === 'about:blank' || url.startsWith('about:srcdoc')) return true;
  if (url.startsWith('data:')) return true;
  if (url.startsWith(OFFLINE_BASE_URL)) return true;
  return false;
}

export const GameWebViewHost = forwardRef<GameWebViewHostHandle, GameWebViewHostProps>(
  function GameWebViewHost(
    {
      gameKey,
      config,
      asyncReady = false,
      onReady,
      onComplete,
      onGameOver,
      onClose,
      onPausedChange,
      onError,
    },
    ref,
  ) {
    const webViewRef = useRef<WebView | null>(null);
    const bootedRef = useRef(false);
    const initialLaunchRef = useRef({ gameKey, config: config || {} });
    const launchedKeyRef = useRef<GameKey | null>(null);
    const [isPainted, setIsPainted] = useState(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const asyncReadyRef = useRef(asyncReady);
    asyncReadyRef.current = asyncReady;

    const configRef = useRef(config);
    configRef.current = config;

    const injectedBeforeLoad = useMemo(
      () => `window.__COOKBOOK_INITIAL_GAME__ = ${JSON.stringify(initialLaunchRef.current)}; true;`,
      [],
    );

    const sendToWebView = useCallback((message: NativeToWebViewMessage) => {
      const payload = JSON.stringify(message);
      const script = `(function(){var m=${payload};if(window.__COOKBOOK_HOST__&&typeof window.__COOKBOOK_HOST__.receive==='function'){window.__COOKBOOK_HOST__.receive(m);}else{window.__COOKBOOK_PENDING_MSGS__=window.__COOKBOOK_PENDING_MSGS__||[];window.__COOKBOOK_PENDING_MSGS__.push(m);}})();true;`;
      webViewRef.current?.injectJavaScript(script);
    }, []);

    const launchCurrentGame = useCallback(() => {
      if (launchedKeyRef.current === gameKey) return;
      launchedKeyRef.current = gameKey;
      sendToWebView({
        type: 'launch',
        gameKey,
        config: configRef.current,
      });
    }, [gameKey, sendToWebView]);

    useImperativeHandle(
      ref,
      () => ({
        restart: () => {
          sendToWebView({ type: 'restart' });
        },
        pause: () => {
          sendToWebView({ type: 'pause' });
          onPausedChange?.(true);
        },
        resume: () => {
          sendToWebView({ type: 'resume' });
          onPausedChange?.(false);
        },
        markAsyncReady: () => {
          sendToWebView({ type: 'markAsyncReady' });
        },
      }),
      [onPausedChange, sendToWebView],
    );

    // Re-launch if gameKey changes while the WebView is already booted
    useEffect(() => {
      if (bootedRef.current && launchedKeyRef.current !== gameKey) {
        setIsPainted(false);
        launchCurrentGame();
      }
    }, [gameKey, launchCurrentGame]);

    // Propagate asyncReady state to WebView bridge
    useEffect(() => {
      if (asyncReady && bootedRef.current) {
        sendToWebView({ type: 'markAsyncReady' });
      }
    }, [asyncReady, sendToWebView]);

    // Pause game loop & host timers whenever the app leaves the foreground
    useEffect(() => {
      const subscription = AppState.addEventListener('change', (nextState) => {
        const prevState = appStateRef.current;
        appStateRef.current = nextState;
        if (!bootedRef.current) return;

        if (prevState === 'active' && nextState !== 'active') {
          sendToWebView({ type: 'pause' });
          onPausedChange?.(true);
        } else if (prevState !== 'active' && nextState === 'active') {
          sendToWebView({ type: 'resume' });
          onPausedChange?.(false);
        }
      });

      return () => {
        subscription.remove();
      };
    }, [onPausedChange, sendToWebView]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let msg: WebViewToNativeMessage | null = null;
        try {
          msg = JSON.parse(event.nativeEvent.data) as WebViewToNativeMessage;
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

        switch (msg.type) {
          case 'host-booted':
            bootedRef.current = true;
            if (msg.launchedGameKey === gameKey) {
              launchedKeyRef.current = gameKey;
            } else {
              launchCurrentGame();
            }
            break;
          case 'ready':
            bootedRef.current = true;
            setIsPainted(true);
            if (asyncReadyRef.current) {
              sendToWebView({ type: 'markAsyncReady' });
            }
            onReady?.({
              gameKey: msg.gameKey,
              preferredOrientation: msg.preferredOrientation,
            });
            break;
          case 'haptic':
            triggerHaptic(msg.style);
            break;
          case 'complete':
            onComplete?.(typeof msg.elapsedMs === 'number' ? msg.elapsedMs : 0);
            break;
          case 'gameover':
            onGameOver?.(msg.reason || 'המשחק נגמר');
            break;
          case 'close':
            onClose?.();
            break;
          case 'error':
            onError?.(msg.message || 'שגיאה בטעינת המשחק');
            break;
          default:
            break;
        }
      },
      [launchCurrentGame, onClose, onComplete, onError, onGameOver, onReady, sendToWebView],
    );

    const handleLoadEnd = useCallback(() => {
      bootedRef.current = true;
      launchCurrentGame();
    }, [launchCurrentGame]);

    const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
      return isAllowedOfflineUrl(request.url);
    }, []);

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          testID={isPainted ? 'game-webview' : 'game-webview-loading'}
          source={{ html: BUNDLED_GAMES_HTML, baseUrl: OFFLINE_BASE_URL }}
          injectedJavaScriptBeforeContentLoaded={injectedBeforeLoad}
          originWhitelist={['*']}
          style={styles.webView}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          allowsInlineMediaPlayback
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          textZoom={100}
          mixedContentMode="never"
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onError={(syntheticEvent) => {
            onError?.(syntheticEvent.nativeEvent.description || 'שגיאה בטעינת המשחק');
          }}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
});
