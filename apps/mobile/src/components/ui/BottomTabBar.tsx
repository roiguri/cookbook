import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies } from '@/theme';
import { useSession } from '@/context/SessionContext';

interface TabItem {
  key: string;
  label: string;
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  href:
    | '/(tabs)/home'
    | '/(tabs)/categories'
    | '/(tabs)/my-recipes'
    | '/(tabs)/my-meal'
    | '/(tabs)/propose-recipe';
  matchPath: string;
}

/**
 * Shared role-reactive bottom tab bar used on stack screens outside `(tabs)`
 * (such as `/recipe/[id]`) so navigation chrome matches Web & Tab screens cleanly.
 */
export function BottomTabBar() {
  const { isAuthenticated, isApproved } = useSession();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const bottomInset = Math.max(insets.bottom, 8);

  const items: TabItem[] = [
    {
      key: 'home',
      label: 'דף הבית',
      testID: 'tab-home',
      icon: 'home-outline',
      href: '/(tabs)/home',
      matchPath: '/home',
    },
    {
      key: 'categories',
      label: 'מתכונים',
      testID: 'tab-categories',
      icon: 'grid-outline',
      href: '/(tabs)/categories',
      matchPath: '/categories',
    },
    ...(isAuthenticated
      ? [
          {
            key: 'my-recipes',
            label: 'הספרייה שלי',
            testID: 'tab-my-recipes',
            icon: 'bookmarks-outline' as const,
            href: '/(tabs)/my-recipes' as const,
            matchPath: '/my-recipes',
          },
          {
            key: 'my-meal',
            label: 'הארוחה שלי',
            testID: 'tab-my-meal',
            icon: 'restaurant-outline' as const,
            href: '/(tabs)/my-meal' as const,
            matchPath: '/my-meal',
          },
        ]
      : []),
    {
      key: 'propose',
      label: isApproved ? 'מתכון חדש' : 'הצעת מתכון',
      testID: 'tab-propose',
      icon: 'add-circle-outline',
      href: '/(tabs)/propose-recipe',
      matchPath: '/propose-recipe',
    },
  ];

  return (
    <View style={[styles.bar, { height: 58 + bottomInset, paddingBottom: bottomInset }]}>
      {items.map((item) => {
        const active = pathname === item.matchPath;
        const tint = active ? colors.primaryDark : colors.ink3;
        return (
          <Pressable
            key={item.key}
            testID={item.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => router.navigate(item.href)}
            style={styles.item}
          >
            <Ionicons name={item.icon} size={22} color={tint} />
            <Text
              style={[styles.label, { color: tint }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface1,
    borderTopColor: colors.hairline,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyMedium,
    width: '100%',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
