import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Animated as RNAnimated,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { getLeaderboard, type LeaderboardEntry } from '../../lib/supabase';
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const SILVER = '#A8A8A8';
const BRONZE = '#CD7F32';

// Pre-allocated -- SkeletonList never allocates a new array on render
const SKELETON_INDICES = Array.from({ length: 6 }, (_, i) => i);

// ─── Podium Context ───────────────────────────────────────────────────────────
//
// WHY CONTEXT:
// FlatList's ListHeaderComponent must receive a STABLE component reference
// (the same object identity every render) or FlatList will unmount + remount
// the header on every data change, replaying all FadeInDown entrance animations
// on every pull-to-refresh.
//
// FlatList does not pass props into ListHeaderComponent, so we can't inject
// topThree as a prop while keeping the reference stable. Context is the correct
// solution: LeaderboardHeader reads topThree from context, its reference never
// changes, and FadeInDown fires exactly once on initial mount.

type PodiumContextValue = {
  topThree: [LeaderboardEntry, LeaderboardEntry, LeaderboardEntry] | [];
};

const PodiumContext = createContext<PodiumContextValue>({ topThree: [] });

// ─── ScreenHeader ─────────────────────────────────────────────────────────────

const ScreenHeader = memo(function ScreenHeader() {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Leaderboard</Text>
      <Text style={styles.subtitle}>Top 100 Historians</Text>
    </View>
  );
});

// ─── PodiumCard ───────────────────────────────────────────────────────────────

type PodiumCardProps = {
  entry: LeaderboardEntry;
  isFirst: boolean;
  medalColor: string;
  delay: number;
};

const PodiumCard = memo(function PodiumCard({
  entry,
  isFirst,
  medalColor,
  delay,
}: PodiumCardProps) {
  // Animate only once on initial mount. hasAnimated persists across re-renders
  // so even if the parent somehow re-renders, entering only fires once.
  const hasAnimated = useRef(false);
  const entering = hasAnimated.current ? undefined : FadeInDown.delay(delay).duration(400);
  // Mark after first render so subsequent renders skip the animation
  hasAnimated.current = true;

  // Medal text contrast: dark text on silver/bronze (low contrast otherwise),
  // light cream on gold. StyleSheet fallback is textPrimary for safety.
  const medalTextColor =
    medalColor === Colors.gold ? Colors.surface : Colors.textPrimary;

  return (
    <Animated.View
      entering={entering}
      style={[styles.podiumCard, isFirst && styles.podiumCardFirst]}
      accessibilityLabel={`Rank ${entry.rank}: ${entry.username}, score ${entry.total_score.toLocaleString()}`}
    >
      {isFirst && (
        <Text style={styles.crown} accessible={false}>
          ♛
        </Text>
      )}
      <View style={[styles.medalBadge, { backgroundColor: medalColor }]}>
        <Text style={[styles.medalText, { color: medalTextColor }]}>
          {entry.rank}
        </Text>
      </View>
      <Text style={styles.podiumUsername} numberOfLines={1}>
        {entry.username}
      </Text>
      <Text style={styles.podiumScore}>{entry.total_score.toLocaleString()}</Text>
    </Animated.View>
  );
});

// ─── PodiumSection ────────────────────────────────────────────────────────────

const PodiumSection = memo(function PodiumSection({
  topThree,
}: {
  topThree: [LeaderboardEntry, LeaderboardEntry, LeaderboardEntry];
}) {
  return (
    <View style={styles.podiumRow}>
      {/* Visual order: 2nd left, 1st centre, 3rd right */}
      <PodiumCard entry={topThree[1]} isFirst={false} medalColor={SILVER} delay={100} />
      <PodiumCard entry={topThree[0]} isFirst medalColor={Colors.gold} delay={0} />
      <PodiumCard entry={topThree[2]} isFirst={false} medalColor={BRONZE} delay={200} />
    </View>
  );
});

// ─── LeaderboardHeader ────────────────────────────────────────────────────────
//
// This component has NO PROPS. It reads topThree from PodiumContext.
// This is what makes it safe to pass as ListHeaderComponent={LeaderboardHeader}
// with a permanently stable reference. FlatList never sees a new component type,
// so it never unmounts/remounts this header, and FadeInDown never replays.

const LeaderboardHeader = memo(function LeaderboardHeader() {
  const { topThree } = useContext(PodiumContext);

  const podium =
    topThree.length === 3
      ? (topThree as [LeaderboardEntry, LeaderboardEntry, LeaderboardEntry])
      : null;

  return (
    <View>
      <ScreenHeader />
      {podium !== null && <PodiumSection topThree={podium} />}
    </View>
  );
});

// ─── LeaderboardRow ───────────────────────────────────────────────────────────

type RowProps = { item: LeaderboardEntry; index: number };

const LeaderboardRow = memo(function LeaderboardRow({ item, index }: RowProps) {
  const fadeAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const animation = RNAnimated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    });
    animation.start();
    // Stop on unmount -- prevents callback firing on unmounted component
    return () => animation.stop();
  }, [fadeAnim]);

  return (
    <RNAnimated.View
      style={[
        styles.row,
        {
          opacity: fadeAnim,
          backgroundColor: index % 2 === 0 ? Colors.surface : Colors.surface2,
        },
      ]}
      accessibilityLabel={`Rank ${item.rank}: ${item.username}, score ${item.total_score.toLocaleString()}`}
    >
      <Text style={styles.rowRank}>{item.rank}</Text>
      <Text style={styles.rowUsername} numberOfLines={1}>
        {item.username}
      </Text>
      <Text style={styles.rowScore}>{item.total_score.toLocaleString()}</Text>
    </RNAnimated.View>
  );
});

// ─── SkeletonRow ──────────────────────────────────────────────────────────────

const SkeletonRow = memo(function SkeletonRow({ pulse }: { pulse: RNAnimated.Value }) {
  return (
    <RNAnimated.View
      style={[styles.row, styles.skeletonRowBg, { opacity: pulse }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.skeletonBlock, styles.skeletonRankBlock]} />
      <View style={[styles.skeletonBlock, styles.skeletonNameBlock]} />
      <View style={[styles.skeletonBlock, styles.skeletonScoreBlock]} />
    </RNAnimated.View>
  );
});

// ─── SkeletonList ─────────────────────────────────────────────────────────────

function SkeletonList() {
  const pulse = useRef(new RNAnimated.Value(0.3)).current;

  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 0.75, duration: 700, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <View style={styles.skeletonContainer}>
      <View
        style={styles.podiumRow}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <RNAnimated.View style={[styles.skeletonBlock, styles.skeletonPodiumSide, { opacity: pulse }]} />
        <RNAnimated.View style={[styles.skeletonBlock, styles.skeletonPodiumFirst, { opacity: pulse }]} />
        <RNAnimated.View style={[styles.skeletonBlock, styles.skeletonPodiumSide, { opacity: pulse }]} />
      </View>
      {SKELETON_INDICES.map((i) => (
        <SkeletonRow key={i} pulse={pulse} />
      ))}
    </View>
  );
}

// ─── Error / Empty states ─────────────────────────────────────────────────────

const ErrorState = memo(function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.errorText}>Could not load leaderboard</Text>
      <TouchableOpacity
        style={styles.retryBtn}
        onPress={onRetry}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel="Try again"
      >
        <Text style={styles.retryBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
});

const EmptyState = memo(function EmptyState() {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.emptyText}>No scores yet. Be the first!</Text>
    </View>
  );
});

// ─── LeaderboardScreen ────────────────────────────────────────────────────────

export default function LeaderboardScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: getLeaderboard,
    staleTime: 60_000,
  });

  const topThree = useMemo(
    (): [LeaderboardEntry, LeaderboardEntry, LeaderboardEntry] | [] =>
      data && data.length >= 3 ? [data[0]!, data[1]!, data[2]!] : [],
    [data],
  );

  // Rows 4-100 go into the FlatList; top 3 go into the podium via context
  const listData = useMemo(
    () => (data && data.length >= 3 ? data.slice(3) : (data ?? [])),
    [data],
  );

  // Context value -- only changes when topThree changes (i.e. when data changes)
  const podiumContextValue = useMemo(
    (): PodiumContextValue => ({ topThree }),
    [topThree],
  );

  // Consistent void-returning handler used for both pull-to-refresh and retry
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LeaderboardEntry>) => (
      <LeaderboardRow item={item} index={index} />
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: LeaderboardEntry) => String(item.rank),
    [],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScreenHeader />
        <SkeletonList />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScreenHeader />
        <ErrorState onRetry={handleRefresh} />
      </SafeAreaView>
    );
  }

  return (
    // PodiumContext.Provider wraps the FlatList so LeaderboardHeader can read
    // topThree from context without needing props -- keeping its reference stable
    <PodiumContext.Provider value={podiumContextValue}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList<LeaderboardEntry>
          data={listData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          // Stable component reference -- never changes, never causes remount
          ListHeaderComponent={LeaderboardHeader}
          ListEmptyComponent={data?.length === 0 ? <EmptyState /> : null}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor={Colors.gold}
              colors={[Colors.gold]}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </SafeAreaView>
    </PodiumContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.bg,
  },

  header: {
    alignItems: 'center',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.textPrimary,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    letterSpacing: 1,
  },

  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  podiumCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  podiumCardFirst: {
    paddingTop: Spacing.xl,
    borderColor: Colors.gold,
    borderWidth: 2,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  crown: {
    fontSize: 22,
    color: Colors.gold,
  },
  medalBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: {
    fontFamily: Fonts.displayBold,
    fontSize: 13,
    color: Colors.textPrimary, // safe fallback; overridden dynamically per medal
  },
  podiumUsername: {
    fontFamily: Fonts.display,
    fontSize: 12,
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  podiumScore: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.gold,
    textAlign: 'center',
  },

  listContent: {
    paddingBottom: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowRank: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.textMuted,
    width: 40,
  },
  rowUsername: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  rowScore: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.gold,
  },

  skeletonContainer: {
    flex: 1,
  },
  skeletonRowBg: {
    backgroundColor: Colors.surface,
  },
  skeletonBlock: {
    backgroundColor: Colors.border,
    borderRadius: Radius.sm,
  },
  skeletonRankBlock: {
    width: 28,
    height: 12,
    marginRight: Spacing.sm,
  },
  skeletonNameBlock: {
    flex: 1,
    height: 12,
    marginRight: Spacing.sm,
  },
  skeletonScoreBlock: {
    width: 52,
    height: 12,
  },
  skeletonPodiumFirst: {
    flex: 1,
    height: 140,
    borderRadius: Radius.lg,
  },
  skeletonPodiumSide: {
    flex: 1,
    height: 108,
    borderRadius: Radius.lg,
  },

  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  retryBtnText: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.surface,
    letterSpacing: 1,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});