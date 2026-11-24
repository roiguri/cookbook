import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { isBuiltAvatarUrl } from '@cookbook/core/avatar/avatar-url';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import { useSession } from '@/context/SessionContext';
import { useEasterEgg } from '@/context/EasterEggContext';
import { RecipeSearchService } from '@/services/recipes/recipe-search-service';
import { PressableScale } from './PressableScale';
import { useToast } from './ToastProvider';

interface AppHeaderProps {
  onQuickSearch?: (query: string) => void;
}

export function AppHeader({ onQuickSearch }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user, profile, role, isApproved, isManager } = useSession();
  const { registerLogoTap } = useEasterEgg();
  const { showToast } = useToast();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const searchingRef = useRef(false);

  const displayName = profile?.fullName || user?.displayName || '';
  const initial = displayName.trim() ? displayName.trim().charAt(0).toUpperCase() : '';
  const avatarUrl = profile?.avatarUrl || null;
  const builtAvatar = isBuiltAvatarUrl(avatarUrl);

  const handleSearchSubmit = async () => {
    const trimmed = searchText.trim();
    if (!trimmed) {
      setSearchOpen(false);
      return;
    }

    if (onQuickSearch) {
      onQuickSearch(trimmed);
      setSearchOpen(false);
      setSearchText('');
      return;
    }

    if (searchingRef.current) return;
    searchingRef.current = true;
    setSearchOpen(false);
    setSearchText('');

    try {
      const { recipes } = await RecipeSearchService.searchUnified(trimmed, {
        role,
        uid: user?.uid || null,
      });

      if (recipes.length === 1) {
        const single = recipes[0];
        showToast(`נמצא מתכון אחד: "${single.name}" - מעבר ישיר למתכון`, 'success', 3000);
        router.push(`/recipe/${single.id}`);
        return;
      }
    } catch {
      // Fall through to categories search results on error
    } finally {
      searchingRef.current = false;
    }

    router.push({ pathname: '/(tabs)/categories', params: { q: trimmed } });
  };

  return (
    <View style={[styles.wrapper, { paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.bar}>
        {/* Brand Logo (Start edge = visual Right in RTL) */}
        <Pressable
          testID="brand-logo"
          onPress={() => {
            registerLogoTap();
            if (pathname !== '/home' && pathname !== '/') {
              router.navigate('/(tabs)/home');
            }
          }}
          style={styles.brandBtn}
          accessibilityRole="button"
          accessibilityLabel="ספר המתכונים"
        >
          <View style={styles.logoMark}>
            <Ionicons name="book" size={16} color={colors.buttonColor} />
          </View>
          <Text style={styles.brandTitle} numberOfLines={1}>
            ספר המתכונים
          </Text>
        </Pressable>

        {/* Actions (End edge = visual Left in RTL) */}
        <View style={styles.actions}>
          {isApproved ? (
            <PressableScale
              variant="icon"
              testID="tab-grandma"
              onPress={() => router.navigate('/(tabs)/grandmas-cooking')}
              accessibilityLabel="המטעמים של סבתא"
              style={[
                styles.shortcutBtn,
                pathname === '/grandmas-cooking' && styles.shortcutBtnActive,
              ]}
            >
              <Ionicons
                name="library-outline"
                size={18}
                color={pathname === '/grandmas-cooking' ? colors.buttonColor : colors.primaryDark}
              />
            </PressableScale>
          ) : null}

          {isManager ? (
            <PressableScale
              variant="icon"
              testID="tab-dashboard"
              onPress={() => router.navigate('/(tabs)/dashboard')}
              accessibilityLabel="ממשק ניהול"
              style={[styles.shortcutBtn, pathname === '/dashboard' && styles.shortcutBtnActive]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={pathname === '/dashboard' ? colors.buttonColor : colors.primaryDark}
              />
            </PressableScale>
          ) : null}

          <PressableScale
            variant="icon"
            testID="header-search-btn"
            onPress={() => setSearchOpen((v) => !v)}
            accessibilityLabel="חיפוש"
            style={styles.iconBtn}
          >
            <Ionicons name={searchOpen ? 'close' : 'search'} size={20} color={colors.ink} />
          </PressableScale>

          <PressableScale
            variant="icon"
            testID="auth-open-btn"
            onPress={() => router.push('/auth')}
            accessibilityLabel={user ? 'הפרופיל שלי' : 'התחברות'}
            style={[
              styles.avatarBtn,
              user ? styles.avatarSignedIn : styles.avatarGuest,
              builtAvatar && styles.avatarBuiltRing,
            ]}
          >
            {user && avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.avatarImage}
                contentFit={builtAvatar ? 'contain' : 'cover'}
              />
            ) : user ? (
              <Text style={styles.avatarInitial} allowFontScaling={false}>
                {initial || 'ש'}
              </Text>
            ) : (
              <View style={styles.guestPill}>
                <Ionicons name="person-outline" size={15} color={colors.primaryDark} />
                <Text style={styles.guestLabel} allowFontScaling={false}>
                  התחברות
                </Text>
              </View>
            )}
          </PressableScale>
        </View>
      </View>

      {searchOpen ? (
        <View style={styles.searchBarRow}>
          <TextInput
            testID="header-search-input"
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={() => {
              void handleSearchSubmit();
            }}
            placeholder="חפש מתכון..."
            placeholderTextColor={colors.ink4}
            returnKeyType="search"
            autoFocus
            style={styles.searchInput}
          />
          <PressableScale
            variant="button"
            onPress={() => {
              void handleSearchSubmit();
            }}
            style={styles.searchGoBtn}
          >
            <Text style={styles.searchGoText} allowFontScaling={false}>
              חיפוש
            </Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface0,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: spacing.sm,
  },
  brandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  avatarBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarSignedIn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
  },
  avatarBuiltRing: {
    borderWidth: 2,
    borderColor: colors.primaryDark,
    backgroundColor: colors.surface1,
  },
  avatarGuest: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.primary,
    flexShrink: 0,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarInitial: {
    color: colors.buttonColor,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
  guestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  guestLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  searchGoBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  searchGoText: {
    color: colors.buttonColor,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
});
