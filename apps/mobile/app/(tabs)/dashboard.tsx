import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import { PressableScale, ScreenHeader, useToast } from '@/components/ui';
import {
  AiEnhancerSection,
  AllRecipesSection,
  FailedUrlsSection,
  PushBanner,
  SubmissionsSection,
  SuggestionsSection,
  UsersAndTokensSection,
} from '@/components/dashboard';
import { useSession } from '@/context/SessionContext';
import {
  API_TOKEN_DEFAULT_MAX_PER_USER,
  ApiTokenService,
  type ApiTokenRecord,
} from '@/services/admin/api-token-service';
import {
  FailedUrlExtractionService,
  type FailedUrlExtractionDoc,
} from '@/services/admin/failed-url-extraction-service';
import { captureError } from '@/services/logger';
import {
  RecipeEditSuggestionService,
  type RecipeEditSuggestionDoc,
} from '@/services/recipes/recipe-edit-suggestion-service';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';
import {
  RecipeSubmissionService,
  type PendingSubmissionRow,
} from '@/services/recipes/recipe-submission-service';
import { UserService, type UserProfileDoc } from '@/services/users/user-service';

type DashboardSectionKey =
  | 'submissions'
  | 'suggestions'
  | 'all-recipes'
  | 'users'
  | 'api-tokens'
  | 'enhancer'
  | 'failed-urls';

export default function DashboardScreen() {
  const { user, isManager, loading: sessionLoading } = useSession();
  const { showToast } = useToast();

  const [activeSection, setActiveSection] = useState<DashboardSectionKey>('submissions');

  const canAccess = !sessionLoading && isManager && Boolean(user?.uid);
  const canAccessRef = useRef(canAccess);
  canAccessRef.current = canAccess;

  // Section data states
  const [submissions, setSubmissions] = useState<PendingSubmissionRow[]>([]);
  const [suggestions, setSuggestions] = useState<RecipeEditSuggestionDoc[]>([]);
  const [publishedRecipes, setPublishedRecipes] = useState<RecipeDoc[]>([]);
  const [users, setUsers] = useState<UserProfileDoc[]>([]);
  const [apiTokens, setApiTokens] = useState<ApiTokenRecord[]>([]);
  const [maxTokensPerUser, setMaxTokensPerUser] = useState<number>(API_TOKEN_DEFAULT_MAX_PER_USER);
  const [tokensLoadError, setTokensLoadError] = useState(false);
  const [failedUrls, setFailedUrls] = useState<FailedUrlExtractionDoc[]>([]);

  // Initial & per-section refresh states
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingSubmissions, setRefreshingSubmissions] = useState(false);
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const [refreshingRecipes, setRefreshingRecipes] = useState(false);
  const [refreshingUsers, setRefreshingUsers] = useState(false);
  const [refreshingTokens, setRefreshingTokens] = useState(false);
  const [refreshingFailedUrls, setRefreshingFailedUrls] = useState(false);

  const hasLoadedOnceRef = useRef(false);

  // Strict P0 Manager Gate: immediately redirect guests, user, and approved to /(tabs)/home
  useEffect(() => {
    if (!sessionLoading && !isManager) {
      hasLoadedOnceRef.current = false;
      router.replace('/(tabs)/home');
    }
  }, [sessionLoading, isManager]);

  const loadSubmissions = useCallback(async () => {
    if (!canAccessRef.current) return;
    setRefreshingSubmissions(true);
    try {
      const list = await RecipeSubmissionService.listPending();
      if (canAccessRef.current) {
        setSubmissions(list);
      }
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'loadSubmissions' });
    } finally {
      if (canAccessRef.current) setRefreshingSubmissions(false);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    if (!canAccessRef.current) return;
    setRefreshingSuggestions(true);
    try {
      const list = await RecipeEditSuggestionService.listPending();
      if (canAccessRef.current) {
        setSuggestions(list);
      }
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'loadSuggestions' });
    } finally {
      if (canAccessRef.current) setRefreshingSuggestions(false);
    }
  }, []);

  const loadPublishedRecipes = useCallback(async () => {
    if (!canAccessRef.current) return;
    setRefreshingRecipes(true);
    try {
      const list = await RecipeService.listPublished();
      if (canAccessRef.current) {
        setPublishedRecipes(list);
      }
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'loadPublishedRecipes' });
    } finally {
      if (canAccessRef.current) setRefreshingRecipes(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!canAccessRef.current) return;
    setRefreshingUsers(true);
    try {
      const list = await UserService.listAll();
      if (canAccessRef.current) {
        setUsers(list);
      }
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'loadUsers' });
    } finally {
      if (canAccessRef.current) setRefreshingUsers(false);
    }
  }, []);

  const loadApiTokens = useCallback(async () => {
    if (!canAccessRef.current) return;
    setRefreshingTokens(true);
    try {
      const result = await ApiTokenService.listTokens();
      if (canAccessRef.current) {
        setApiTokens(result.tokens);
        setMaxTokensPerUser(result.maxPerUser || API_TOKEN_DEFAULT_MAX_PER_USER);
        setTokensLoadError(false);
      }
    } catch {
      // Service already captured error; surface non-blocking retry state in API tokens panel
      if (canAccessRef.current) {
        setTokensLoadError(true);
      }
    } finally {
      if (canAccessRef.current) setRefreshingTokens(false);
    }
  }, []);

  const loadFailedUrls = useCallback(async () => {
    if (!canAccessRef.current) return;
    setRefreshingFailedUrls(true);
    try {
      const list = await FailedUrlExtractionService.list();
      if (canAccessRef.current) {
        setFailedUrls(list);
      }
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'loadFailedUrls' });
    } finally {
      if (canAccessRef.current) setRefreshingFailedUrls(false);
    }
  }, []);

  const refreshAll = useCallback(
    async ({ notify = false }: { notify?: boolean } = {}) => {
      if (!canAccessRef.current) return;
      setRefreshingAll(true);
      try {
        await Promise.allSettled([
          loadSubmissions(),
          loadSuggestions(),
          loadPublishedRecipes(),
          loadUsers(),
          loadApiTokens(),
          loadFailedUrls(),
        ]);
        if (canAccessRef.current) {
          setInitialLoaded(true);
          if (notify) {
            showToast('הנתונים עודכנו', 'info', 1800);
          }
        }
      } finally {
        if (canAccessRef.current) setRefreshingAll(false);
      }
    },
    [
      loadSubmissions,
      loadSuggestions,
      loadPublishedRecipes,
      loadUsers,
      loadApiTokens,
      loadFailedUrls,
      showToast,
    ],
  );

  // Fire manager queries ONLY once strictly authorized as manager
  useFocusEffect(
    useCallback(() => {
      if (!canAccess) return;
      if (!hasLoadedOnceRef.current) {
        hasLoadedOnceRef.current = true;
        void refreshAll();
      } else {
        // Silently refresh actionable queues when returning to dashboard
        void Promise.allSettled([loadSubmissions(), loadSuggestions(), loadFailedUrls()]);
      }
    }, [canAccess, refreshAll, loadSubmissions, loadSuggestions, loadFailedUrls]),
  );

  const usersById = useMemo(() => {
    const map: Record<string, UserProfileDoc> = {};
    for (const u of users) {
      map[u.id] = u;
    }
    return map;
  }, [users]);

  const allRecipesById = useMemo(() => {
    const map: Record<string, RecipeDoc> = {};
    for (const r of publishedRecipes) {
      map[r.id] = r;
    }
    return map;
  }, [publishedRecipes]);

  const handleUserRoleUpdated = useCallback(
    (uid: string, nextRole: 'user' | 'approved' | 'manager') => {
      setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, role: nextRole } : u)));
    },
    [],
  );

  const handleRecipesAndQueueMutated = useCallback(async () => {
    await Promise.allSettled([loadSubmissions(), loadPublishedRecipes()]);
  }, [loadSubmissions, loadPublishedRecipes]);

  const handleSuggestionApproved = useCallback(async () => {
    await Promise.allSettled([loadSuggestions(), loadPublishedRecipes()]);
  }, [loadSuggestions, loadPublishedRecipes]);

  const handleImageEnhancedSaved = useCallback(async () => {
    await loadPublishedRecipes();
  }, [loadPublishedRecipes]);

  // Strict P0 gate: never render dashboard content or trigger queries when unauthorized
  if (!sessionLoading && (!isManager || !user?.uid)) {
    return <Redirect href="/(tabs)/home" />;
  }
  if (!canAccess || !user?.uid) {
    return <View style={styles.screen} />;
  }

  const managerUid = user.uid;
  const isInitialLoading = !initialLoaded;

  const sectionTabs: Array<{
    key: DashboardSectionKey;
    testID: string;
    label: string;
    count?: number;
  }> = [
    {
      key: 'submissions',
      testID: 'dashboard-section-submissions',
      label: 'אישורים',
      count: submissions.length,
    },
    {
      key: 'suggestions',
      testID: 'dashboard-section-suggestions',
      label: 'הצעות עריכה',
      count: suggestions.length,
    },
    {
      key: 'all-recipes',
      testID: 'dashboard-section-all-recipes',
      label: 'כל המתכונים',
      count: publishedRecipes.length,
    },
    {
      key: 'users',
      testID: 'dashboard-section-users',
      label: 'משתמשים',
      count: users.length,
    },
    {
      key: 'api-tokens',
      testID: 'dashboard-section-api-tokens',
      label: 'גישת API',
      count: apiTokens.length,
    },
    {
      key: 'enhancer',
      testID: 'dashboard-section-enhancer',
      label: 'שיפור תמונות AI',
    },
    {
      key: 'failed-urls',
      testID: 'dashboard-section-failed-urls',
      label: 'קישורים שנכשלו',
      count: failedUrls.length,
    },
  ];

  return (
    <View testID="dashboard-screen" collapsable={false} style={styles.screen}>
      <ScreenHeader
        title="ממשק ניהול"
        rightAction={
          <PressableScale
            testID="dashboard-refresh-btn"
            variant="button"
            disabled={refreshingAll}
            onPress={() => {
              void refreshAll({ notify: true });
            }}
            accessibilityRole="button"
            accessibilityLabel="רענן הכל"
            style={styles.masterRefreshBtn}
          >
            {refreshingAll ? (
              <ActivityIndicator size="small" color={colors.primaryDark} />
            ) : (
              <Ionicons name="refresh" size={16} color={colors.primaryDark} />
            )}
            <Text style={styles.masterRefreshLabel} allowFontScaling={false}>
              רענן הכל
            </Text>
          </PressableScale>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshingAll && initialLoaded}
            onRefresh={() => {
              void refreshAll();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Manager Push Notification Opt-In Banner */}
        <PushBanner uid={managerUid} />

        {/* Compact Wrapped 7-Section Switcher Bar (every section immediately reachable above fold) */}
        <View style={styles.sectionTabsGrid} accessibilityRole="tablist">
          {sectionTabs.map((tab) => {
            const selected = activeSection === tab.key;
            return (
              <PressableScale
                key={tab.key}
                testID={tab.testID}
                variant="button"
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActiveSection(tab.key)}
                style={[styles.sectionTabPill, selected && styles.sectionTabPillActive]}
              >
                <Text
                  style={[styles.sectionTabLabel, selected && styles.sectionTabLabelActive]}
                  allowFontScaling={false}
                >
                  {tab.label}
                </Text>
                {typeof tab.count === 'number' ? (
                  <View style={[styles.sectionTabCount, selected && styles.sectionTabCountActive]}>
                    <Text
                      style={[
                        styles.sectionTabCountText,
                        selected && styles.sectionTabCountTextActive,
                      ]}
                      allowFontScaling={false}
                    >
                      {tab.count}
                    </Text>
                  </View>
                ) : null}
              </PressableScale>
            );
          })}
        </View>

        {/* Active Section Panel */}
        {activeSection === 'submissions' ? (
          <SubmissionsSection
            items={submissions}
            usersById={usersById}
            loading={isInitialLoading && refreshingSubmissions}
            refreshing={refreshingSubmissions}
            managerUid={managerUid}
            onRefresh={loadSubmissions}
            onMutated={handleRecipesAndQueueMutated}
          />
        ) : null}

        {activeSection === 'suggestions' ? (
          <SuggestionsSection
            suggestions={suggestions}
            allRecipesById={allRecipesById}
            loading={isInitialLoading && refreshingSuggestions}
            refreshing={refreshingSuggestions}
            managerUid={managerUid}
            onRefresh={loadSuggestions}
            onApproved={handleSuggestionApproved}
            onRejected={loadSuggestions}
          />
        ) : null}

        {activeSection === 'all-recipes' ? (
          <AllRecipesSection
            recipes={publishedRecipes}
            loading={isInitialLoading && refreshingRecipes}
            refreshing={refreshingRecipes}
            managerUid={managerUid}
            onRefresh={loadPublishedRecipes}
            onMutated={handleRecipesAndQueueMutated}
          />
        ) : null}

        {activeSection === 'users' || activeSection === 'api-tokens' ? (
          <UsersAndTokensSection
            mode={activeSection}
            users={users}
            tokens={apiTokens}
            maxTokensPerUser={maxTokensPerUser}
            tokensLoadError={tokensLoadError}
            loadingUsers={isInitialLoading && refreshingUsers}
            refreshingUsers={refreshingUsers}
            refreshingTokens={refreshingTokens}
            currentManagerUid={managerUid}
            onRefreshUsers={loadUsers}
            onRefreshTokens={loadApiTokens}
            onUserRoleUpdated={handleUserRoleUpdated}
            onTokensChanged={setApiTokens}
          />
        ) : null}

        {activeSection === 'enhancer' ? (
          <AiEnhancerSection
            recipes={publishedRecipes}
            loading={isInitialLoading && refreshingRecipes}
            refreshing={refreshingRecipes}
            managerUid={managerUid}
            onRefresh={loadPublishedRecipes}
            onImageSaved={handleImageEnhancedSaved}
          />
        ) : null}

        {activeSection === 'failed-urls' ? (
          <FailedUrlsSection
            items={failedUrls}
            loading={isInitialLoading && refreshingFailedUrls}
            refreshing={refreshingFailedUrls}
            onRefresh={loadFailedUrls}
            onDeleted={loadFailedUrls}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  masterRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  masterRefreshLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing['2xl'],
    gap: spacing.sm,
  },
  sectionTabsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sectionTabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  sectionTabPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sectionTabLabel: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12.5,
    color: colors.ink2,
    includeFontPadding: false,
  },
  sectionTabLabelActive: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
  },
  sectionTabCount: {
    minWidth: 18,
    height: 18,
    borderRadius: radii.pill,
    paddingHorizontal: 5,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTabCountActive: {
    backgroundColor: colors.primaryDark,
  },
  sectionTabCountText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 11,
    color: colors.ink2,
    includeFontPadding: false,
  },
  sectionTabCountTextActive: {
    color: colors.buttonColor,
  },
});
