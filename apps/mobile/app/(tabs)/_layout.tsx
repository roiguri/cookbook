import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies } from '@/theme';
import { AppHeader } from '@/components/ui/AppHeader';
import { useSession } from '@/context/SessionContext';

export default function TabsLayout() {
  const { isAuthenticated, isApproved } = useSession();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <View style={styles.container}>
      <AppHeader />
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.surface0 },
          tabBarActiveTintColor: colors.primaryDark,
          tabBarInactiveTintColor: colors.ink3,
          tabBarAllowFontScaling: false,
          tabBarStyle: {
            backgroundColor: colors.surface1,
            borderTopColor: colors.hairline,
            borderTopWidth: 1,
            height: 58 + bottomInset,
            paddingBottom: bottomInset,
            paddingTop: 6,
          },
          tabBarItemStyle: {
            paddingHorizontal: 2,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontFamily: fontFamilies.bodyMedium,
            width: '100%',
            textAlign: 'center',
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'דף הבית',
            tabBarButtonTestID: 'tab-home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size - 2} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="categories"
          options={{
            title: 'מתכונים',
            tabBarButtonTestID: 'tab-categories',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="grid-outline" size={size - 2} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="my-recipes"
          options={{
            title: 'הספרייה שלי',
            href: isAuthenticated ? '/(tabs)/my-recipes' : null,
            tabBarButtonTestID: 'tab-my-recipes',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="bookmarks-outline" size={size - 2} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="my-meal"
          options={{
            title: 'הארוחה שלי',
            href: isAuthenticated ? '/(tabs)/my-meal' : null,
            tabBarButtonTestID: 'tab-my-meal',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="restaurant-outline" size={size - 2} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="propose-recipe"
          options={{
            title: isApproved ? 'מתכון חדש' : 'הצעת מתכון',
            tabBarButtonTestID: 'tab-propose',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="add-circle-outline" size={size - 2} color={color} />
            ),
          }}
        />
        {/* Role-gated routes accessed via AppHeader shortcuts (tab-grandma / tab-dashboard) */}
        <Tabs.Screen
          name="grandmas-cooking"
          options={{
            title: 'המטעמים של סבתא',
            href: null,
          }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'ממשק ניהול',
            href: null,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
});
