import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '../../context/AuthContext'
import { getProfile, spendCoins } from '../../lib/supabase'
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme'

declare const __DEV__: boolean

const MAX_LIVES = 12

const HEART_ITEMS = {
  heart1: { cost: 25,  hearts: 1, name: '+1 Heart',  label: '❤️  +1 Heart',  costLabel: '25🪙'  },
  heart5: { cost: 100, hearts: 5, name: '+5 Hearts', label: '❤️  +5 Hearts', costLabel: '100🪙' },
} as const

type HeartItemKey = keyof typeof HEART_ITEMS
type LoadingItem = HeartItemKey | null

const HEART_ITEM_KEYS = Object.keys(HEART_ITEMS) as HeartItemKey[]

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as Record<string, unknown>).message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  return 'An unexpected error occurred'
}

export default function ShopScreen() {
  const { user } = useAuth()
  const [coins, setCoins] = useState(0)
  const [lives, setLives] = useState(0)
  const [loadingItem, setLoadingItem] = useState<LoadingItem>(null)
  const [refreshing, setRefreshing] = useState(false)
  const purchaseInProgress = useRef(false)
  const refreshCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { refreshCleanupRef.current?.() }, [])

  // Extract primitive so useCallback dep is a stable string, not an object.
  // If user?.id is undefined (no session), the callback resets state to 0.
  const userId = user?.id

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setCoins(0)
        setLives(0)
        return
      }

      let cancelled = false

      getProfile(userId)
        .then((profile) => {
          if (cancelled) return
          if (profile) {
            setCoins(profile.coins)
            setLives(profile.lives)
          }
        })
        .catch((err: unknown) => {
          if (__DEV__) console.error('[ShopScreen] getProfile failed:', err)
          if (cancelled) return
        })

      return () => {
        cancelled = true
      }
    }, [userId])
  )

  const handleRefresh = useCallback(() => {
    if (!userId || purchaseInProgress.current) return
    refreshCleanupRef.current?.()
    let cancelled = false
    refreshCleanupRef.current = () => { cancelled = true }
    setRefreshing(true)
    Promise.all([
      getProfile(userId),
      new Promise<void>(resolve => setTimeout(resolve, 600)),
    ])
      .then(([profile]) => {
        if (cancelled) return
        if (profile) {
          setCoins(profile.coins)
          setLives(profile.lives)
        }
      })
      .catch((err: unknown) => {
        if (__DEV__) console.error('[ShopScreen] refresh failed:', err)
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false)
      })
  }, [userId])

  // Defined before early return so it's always in the same position
  // in the component body regardless of render path.
  const handleHeartPurchase = async (key: HeartItemKey) => {
    if (!user) return
    if (purchaseInProgress.current) return
    purchaseInProgress.current = true
    const { cost, hearts, name } = HEART_ITEMS[key]
    setLoadingItem(key)
    try {
      const result = await spendCoins(user.id, cost, hearts, name)
      setCoins(result.coins)
      setLives(result.lives)
    } catch (err: unknown) {
      const message = extractMessage(err)
      if (message.toLowerCase().includes('insufficient')) {
        Alert.alert('Not enough coins', 'You need more coins to buy this.')
      } else {
        Alert.alert('Error', message)
      }
    } finally {
      purchaseInProgress.current = false
      setLoadingItem(null)
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.mutedText}>Sign in to access the shop</Text>
        </View>
      </SafeAreaView>
    )
  }

  const heartsDisabled = lives >= MAX_LIVES
  const heartButtonsDisabled = loadingItem !== null || heartsDisabled

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.gold}
            colors={[Colors.gold]}
          />
        }
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>SHOP</Text>
          <View style={styles.coinBadge}>
            <Text style={styles.coinEmoji}>🪙</Text>
            <Text style={styles.coinCount}>{coins}</Text>
          </View>
        </View>

        {/* ── Hearts ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>HEARTS</Text>

          {HEART_ITEM_KEYS.map((key) => {
            const item = HEART_ITEMS[key]
            return (
              <TouchableOpacity
                key={key}
                style={[styles.itemRow, heartButtonsDisabled && styles.itemDisabled]}
                onPress={() => handleHeartPurchase(key)}
                disabled={heartButtonsDisabled}
                activeOpacity={0.7}
              >
                <Text style={styles.itemLabel}>{item.label}</Text>
                {loadingItem === key ? (
                  <ActivityIndicator size="small" color={Colors.gold} />
                ) : (
                  <Text style={styles.itemCost}>{item.costLabel}</Text>
                )}
              </TouchableOpacity>
            )
          })}

          {heartsDisabled ? (
            <Text style={styles.heartsFullText}>Hearts are full</Text>
          ) : (
            <Text style={styles.regenText}>Refills 1 heart every 6hrs</Text>
          )}
        </View>

        {/* ── Coin Packs ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>COIN PACKS</Text>

          <View style={styles.packRow}>
            <TouchableOpacity
              style={[styles.packButton, styles.packButtonHalf]}
              onPress={() => Alert.alert('Coming Soon', 'In-app purchases coming soon.')}
              activeOpacity={0.7}
            >
              <Text style={styles.packCoins}>100🪙</Text>
              <Text style={styles.packPrice}>$0.99</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.packButton, styles.packButtonHalf]}
              onPress={() => Alert.alert('Coming Soon', 'In-app purchases coming soon.')}
              activeOpacity={0.7}
            >
              <Text style={styles.packCoins}>500🪙</Text>
              <Text style={styles.packPrice}>$3.99</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.packButton, styles.packButtonBest]}
            onPress={() => Alert.alert('Coming Soon', 'In-app purchases coming soon.')}
            activeOpacity={0.7}
          >
            <Text style={styles.packCoins}>1200🪙</Text>
            <Text style={styles.packPrice}>$7.99  ★ BEST</Text>
          </TouchableOpacity>
        </View>

        {/* ── Watch Ad ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>WATCH AD</Text>

          <TouchableOpacity
            style={styles.itemRow}
            onPress={() => Alert.alert('Coming Soon', 'Ad rewards coming soon.')}
            activeOpacity={0.7}
          >
            <Text style={styles.itemLabel}>📺  Watch for 10🪙</Text>
          </TouchableOpacity>

          <Text style={styles.regenText}>3 remaining today</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedText: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textMuted,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  headerTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.gold,
    letterSpacing: 2,
  },
  coinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  coinEmoji: {
    fontSize: 16,
  },
  coinCount: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.gold,
  },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 12,
  },
  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  itemDisabled: {
    opacity: 0.4,
  },
  itemLabel: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  itemCost: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.gold,
  },
  regenText: {
    fontFamily: Fonts.displayBold,
    fontSize: 13,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  heartsFullText: {
    fontFamily: Fonts.displayBold,
    fontSize: 13,
    color: Colors.gold,
    textAlign: 'center',
  },
  packRow: {
    flexDirection: 'row',
    gap: 10,
  },
  packButton: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  packButtonHalf: {
    flex: 1,
  },
  packButtonBest: {
    borderColor: Colors.gold,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  packCoins: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  packPrice: {
    fontFamily: Fonts.displayBold,
    fontSize: 13,
    color: Colors.textPrimary,
  },
})