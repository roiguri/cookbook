import React, { useEffect } from 'react';
import { I18nManager, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, FONT_ASSETS } from '@/theme';
import { initTelemetry } from '@/services/logger';
import { ToastProvider } from '@/components/ui';
import { PushForegroundBanner } from '@/components/ui/PushForegroundBanner';
import { SessionProvider } from '@/context/SessionContext';
import { EasterEggProvider } from '@/context/EasterEggContext';
import { useDeepLinks } from '@/hooks/useDeepLinks';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { registerSuggestEditModalRenderer } from '@/components/recipe-detail';
import { SuggestEditModal } from '@/components/recipe-form';

registerSuggestEditModalRenderer(({ visible, recipeId, onClose, onSubmitted }) => (
  <SuggestEditModal
    visible={visible}
    recipeId={recipeId}
    onClose={onClose}
    onSubmitted={onSubmitted}
  />
));

function AppLifecycleBridge() {
  useDeepLinks();
  const { foregroundNotification, pressForegroundNotification, dismissForegroundNotification } =
    usePushNotifications();

  return (
    <PushForegroundBanner
      notification={foregroundNotification}
      onPress={pressForegroundNotification}
      onDismiss={dismissForegroundNotification}
    />
  );
}

// Cold-start Hebrew RTL lock (INV-P0-09): MUST execute before first render
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

initTelemetry();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const [fontTimeout, setFontTimeout] = React.useState(false);

  useEffect(() => {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
    const t = setTimeout(() => setFontTimeout(true), 800);
    return () => clearTimeout(t);
  }, []);

  // Wait ~30-60ms for local bundled Hebrew fonts before first Yoga layout pass
  // so Android measures exact NotoSansHebrew glyph widths with zero clipping.
  if (!fontsLoaded && !fontError && !fontTimeout) {
    return <View style={styles.root} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View testID="app-root" collapsable={false} style={styles.root}>
          <StatusBar style="dark" />
          <ToastProvider>
            <SessionProvider>
              <EasterEggProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.surface0 },
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="auth"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen name="recipe/[id]" />
                  <Stack.Screen
                    name="games"
                    options={{
                      presentation: 'fullScreenModal',
                    }}
                  />
                </Stack>
              </EasterEggProvider>
              <AppLifecycleBridge />
            </SessionProvider>
          </ToastProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
});
