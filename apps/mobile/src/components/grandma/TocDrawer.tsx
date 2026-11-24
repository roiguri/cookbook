import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  I18nManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontFamilies,
  motion,
  radii,
  shadows,
  spacing,
  statusColors,
  typeScale,
} from '@/theme';
import { PressableScale } from '@/components/ui';
import type { TocCategorySection, TocRecipeEntry } from '@/services/pdf/pdf-service';

export interface TocDrawerProps {
  visible: boolean;
  sections: TocCategorySection[];
  currentPage: number;
  totalPages: number;
  onSelectPage: (pageNumber: number) => void;
  onClose: () => void;
}

interface FilteredCategorySection {
  section: TocCategorySection;
  recipes: TocRecipeEntry[];
}

export function TocDrawer({
  visible,
  sections,
  currentPage,
  totalPages,
  onSelectPage,
  onClose,
}: TocDrawerProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(350, Math.round(windowWidth * 0.86));

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedByName, setCollapsedByName] = useState<Record<string, boolean>>({});

  const slideAnim = useRef(
    new Animated.Value(I18nManager.isRTL ? drawerWidth : -drawerWidth),
  ).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      const startOffset = I18nManager.isRTL ? drawerWidth : -drawerWidth;
      slideAnim.setValue(startOffset);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: motion.dur2,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: motion.dur1,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      setSearchQuery('');
    }
  }, [visible, drawerWidth, slideAnim, backdropAnim]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const filteredSections = useMemo<FilteredCategorySection[]>(() => {
    if (!isSearching) {
      return sections.map((section) => ({ section, recipes: section.recipes }));
    }

    const results: FilteredCategorySection[] = [];
    for (const section of sections) {
      const catMatches = section.name.toLowerCase().includes(normalizedQuery);
      const matchingRecipes = section.recipes.filter(
        (recipe) => catMatches || recipe.name.toLowerCase().includes(normalizedQuery),
      );
      if (catMatches || matchingRecipes.length > 0) {
        results.push({
          section,
          recipes: catMatches ? section.recipes : matchingRecipes,
        });
      }
    }
    return results;
  }, [sections, isSearching, normalizedQuery]);

  const toggleCategoryCollapse = (categoryName: string) => {
    Haptics.selectionAsync().catch(() => {});
    setCollapsedByName((prev) => ({
      ...prev,
      [categoryName]: !prev[categoryName],
    }));
  };

  const handleJump = (pageNumber: number) => {
    Haptics.selectionAsync().catch(() => {});
    onSelectPage(pageNumber);
    onClose();
  };

  const collapsedChevronName = I18nManager.isRTL ? 'chevron-back' : 'chevron-forward';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="סגור תוכן עניינים"
          />
        </Animated.View>

        <Animated.View
          testID="grandma-toc-drawer"
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          {/* Drawer Header */}
          <View
            style={[styles.header, { paddingTop: Math.max(insets.top + spacing.sm, spacing.lg) }]}
          >
            <View style={styles.headerTitleCol}>
              <Text style={styles.headerTitle} allowFontScaling={false}>
                תוכן עניינים
              </Text>
              <Text style={styles.headerMeta} allowFontScaling={false}>
                {`${sections.length} פרקים · ${totalPages} עמודים`}
              </Text>
            </View>

            <PressableScale
              variant="icon"
              testID="grandma-toc-close-btn"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="סגור תוכן עניינים"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={20} color={colors.ink2} />
            </PressableScale>
          </View>

          {/* Search Bar */}
          <View style={styles.searchWrap}>
            <View style={styles.searchField}>
              <Ionicons name="search-outline" size={18} color={colors.ink3} />
              <TextInput
                testID="grandma-toc-search-input"
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="חיפוש מתכון או קטגוריה..."
                placeholderTextColor={colors.ink4}
                returnKeyType="search"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {searchQuery.length > 0 ? (
                <PressableScale
                  variant="icon"
                  onPress={() => setSearchQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="נקה חיפוש"
                  style={styles.clearBtn}
                >
                  <Ionicons name="close-circle" size={18} color={colors.ink3} />
                </PressableScale>
              ) : null}
            </View>
          </View>

          {/* 2-Level Collapsible Category & Recipe Tree */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl) },
            ]}
          >
            {filteredSections.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="search-outline" size={28} color={colors.ink4} />
                <Text style={styles.emptyText}>לא נמצאו מתכונים או קטגוריות תואמות</Text>
              </View>
            ) : (
              filteredSections.map(({ section, recipes }) => {
                const isActiveCategory =
                  currentPage >= section.startPage && currentPage <= section.endPage;
                const isExpanded = isSearching ? true : !collapsedByName[section.name];
                const hasRecipes = recipes.length > 0;

                return (
                  <View key={`${section.index}-${section.name}`} style={styles.categoryBlock}>
                    <View
                      style={[
                        styles.categoryHeaderRow,
                        isActiveCategory && styles.categoryHeaderActive,
                      ]}
                    >
                      {hasRecipes ? (
                        <PressableScale
                          variant="icon"
                          onPress={() => toggleCategoryCollapse(section.name)}
                          accessibilityRole="button"
                          accessibilityLabel={isExpanded ? 'כווץ קטגוריה' : 'הרחב קטגוריה'}
                          style={styles.chevronBtn}
                        >
                          <Ionicons
                            name={isExpanded ? 'chevron-down' : collapsedChevronName}
                            size={16}
                            color={isActiveCategory ? colors.primaryDark : colors.ink3}
                          />
                        </PressableScale>
                      ) : (
                        <View style={styles.chevronSpacer} />
                      )}

                      <PressableScale
                        variant="button"
                        testID={`grandma-toc-category-${section.index}`}
                        onPress={() => handleJump(section.startPage)}
                        accessibilityRole="button"
                        accessibilityLabel={`${section.name}, עמודים ${section.startPage} עד ${section.endPage}`}
                        style={styles.categoryJumpBtn}
                      >
                        <Text
                          style={[
                            styles.categoryName,
                            isActiveCategory && styles.categoryNameActive,
                          ]}
                          numberOfLines={1}
                        >
                          {section.name}
                        </Text>
                        <View
                          style={[styles.rangeBadge, isActiveCategory && styles.rangeBadgeActive]}
                        >
                          <Text
                            style={[styles.rangeText, isActiveCategory && styles.rangeTextActive]}
                            allowFontScaling={false}
                          >
                            {`${section.startPage}–${section.endPage}`}
                          </Text>
                        </View>
                      </PressableScale>
                    </View>

                    {hasRecipes && isExpanded ? (
                      <View style={styles.recipeList}>
                        {recipes.map((recipe) => {
                          const isActiveRecipe = recipe.page === currentPage;
                          return (
                            <PressableScale
                              key={`${section.index}-${recipe.name}-${recipe.page}`}
                              variant="button"
                              testID={`grandma-toc-item-${recipe.page}`}
                              onPress={() => handleJump(recipe.page)}
                              accessibilityRole="button"
                              accessibilityLabel={`${recipe.name}, עמוד ${recipe.page}`}
                              style={[styles.recipeRow, isActiveRecipe && styles.recipeRowActive]}
                            >
                              <Text
                                style={[
                                  styles.recipeName,
                                  isActiveRecipe && styles.recipeNameActive,
                                ]}
                                numberOfLines={2}
                              >
                                {recipe.name}
                              </Text>
                              <View
                                style={[styles.pageBadge, isActiveRecipe && styles.pageBadgeActive]}
                              >
                                <Text
                                  style={[
                                    styles.pageBadgeText,
                                    isActiveRecipe && styles.pageBadgeTextActive,
                                  ]}
                                  allowFontScaling={false}
                                >
                                  {String(recipe.page)}
                                </Text>
                              </View>
                            </PressableScale>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
  },
  drawer: {
    height: '100%',
    backgroundColor: colors.surface1,
    borderEndWidth: 1,
    borderEndColor: colors.hairline,
    ...shadows.level3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    gap: spacing.sm,
  },
  headerTitleCol: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step2,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  headerMeta: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface0,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    minHeight: 42,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
    paddingVertical: spacing.sm,
    includeFontPadding: false,
  },
  clearBtn: {
    padding: 2,
  },
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.step0,
    color: colors.ink3,
    textAlign: 'center',
  },
  categoryBlock: {
    marginBottom: spacing.xs,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  categoryHeaderActive: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
  },
  chevronBtn: {
    width: 30,
    height: 30,
    borderRadius: radii.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronSpacer: {
    width: 8,
  },
  categoryJumpBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingEnd: spacing.xs,
    gap: spacing.sm,
  },
  categoryName: {
    flex: 1,
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  categoryNameActive: {
    color: colors.primaryDark,
  },
  rangeBadge: {
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rangeBadgeActive: {
    borderColor: colors.primary,
  },
  rangeText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    includeFontPadding: false,
  },
  rangeTextActive: {
    color: colors.primaryDark,
  },
  recipeList: {
    paddingStart: spacing.lg,
    paddingTop: spacing.xs,
    gap: 2,
  },
  recipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radii.xs,
    gap: spacing.sm,
  },
  recipeRowActive: {
    backgroundColor: colors.primary,
  },
  recipeName: {
    flex: 1,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.step0,
    color: colors.ink2,
    textAlign: 'left',
    includeFontPadding: false,
  },
  recipeNameActive: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
  },
  pageBadge: {
    minWidth: 28,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadgeActive: {
    backgroundColor: colors.primaryDark,
  },
  pageBadgeText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    includeFontPadding: false,
  },
  pageBadgeTextActive: {
    color: colors.buttonColor,
  },
});
