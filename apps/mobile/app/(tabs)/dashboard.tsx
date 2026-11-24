import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
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

export default function DashboardScreen() {
  const { user, isManager, loading: sessionLoading } = useSession();
  const { showToast } = useToast();

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
  if (!canAccess || !user?.uid) {
    return <View style={styles.screen} />;
  }

  const managerUid = user.uid;
  const isInitialLoading = !initialLoaded;

  return (
    <View testID="dashboard-screen" collapsable={false} style={styles.screen}>
      <ScreenHeader
        title="ממשק ניהול"
        subtitle="אישורים, הצעות עריכה, משתמשים ותמונות"
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

        {/* 1. Submission Approval Queue (Dual-Mode Rejection) */}
        <SubmissionsSection
          items={submissions}
          usersById={usersById}
          loading={isInitialLoading && refreshingSubmissions}
          refreshing={refreshingSubmissions}
          managerUid={managerUid}
          onRefresh={loadSubmissions}
          onMutated={handleRecipesAndQueueMutated}
        />

        {/* 2. Pending Edit Suggestions Diff Review */}
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

        {/* 3. All Published Recipes Management */}
        <AllRecipesSection
          recipes={publishedRecipes}
          loading={isInitialLoading && refreshingRecipes}
          refreshing={refreshingRecipes}
          managerUid={managerUid}
          onRefresh={loadPublishedRecipes}
          onMutated={handleRecipesAndQueueMutated}
        />

        {/* 4 & 5. User Role Management + Personal Recipe API Tokens */}
        <UsersAndTokensSection
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

        {/* 6. AI Food Image Enhancer */}
        <AiEnhancerSection
          recipes={publishedRecipes}
          loading={isInitialLoading && refreshingRecipes}
          refreshing={refreshingRecipes}
          managerUid={managerUid}
          onRefresh={loadPublishedRecipes}
          onImageSaved={handleImageEnhancedSaved}
        />

        {/* 7. Failed URL Extractions Queue */}
        <FailedUrlsSection
          items={failedUrls}
          loading={isInitialLoading && refreshingFailedUrls}
          refreshing={refreshingFailedUrls}
          onRefresh={loadFailedUrls}
          onDeleted={loadFailedUrls}
        />
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
    gap: spacing.md,
  },
});
