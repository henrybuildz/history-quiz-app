import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, {
  cancelAnimation,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Fonts, Spacing, Radius } from '../../constants/theme';
import { useQuizStore } from '../../stores/quizStore';
import { profileSignalStore } from '../../stores/profileSignal';
import { useAchievementStore } from '../../stores/achievementStore';
import { supabase, saveQuizResult, deductLife, regenLives, regenLivesLocal, deductLifeLocal, initGuestHearts, REGEN_HOURS, LIVES_PER_QUIZ } from '../../lib/supabase';
import { withTimeout } from '../../lib/withTimeout';
import { useAuth } from '../../context/AuthContext';
import { AnimatedSlot } from '../../components/AnimatedSlot';
import type { Question, Era } from '../../types';

// ─── Types & Utilities ────────────────────────────────────────────────────────

type Difficulty = 'mixed' | 'easy' | 'medium' | 'hard';
type SlotState = 'idle' | 'correct' | 'wrong' | 'dim';

const BACK_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

// Max ms to wait for an in-flight save before navigating home anyway.
// Prevents a network drop from freezing the UI on the results modal.
const HOME_SAVE_TIMEOUT_MS = 5_000

// Explicit column list avoids over-fetching and shields against future schema additions.
// explanation and topic are included so Question.explanation / Question.topic match their
// declared types (string | null) rather than silently being undefined at runtime.
const QUESTION_COLUMNS = 'id, question_text, correct_answer, distractors, era, difficulty, explanation, topic';

function fisherYates<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function getDifficultyFilter(d: Difficulty): number[] | null {
  switch (d) {
    case 'easy':   return [1, 2];
    case 'medium': return [3];
    case 'hard':   return [4, 5];
    default:       return null;
  }
}

// ─── Heart ────────────────────────────────────────────────────────────────────

const Heart = memo(function Heart({ alive, animate }: { alive: boolean; animate: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!animate) return;
    // Cancel any in-flight animation before starting a new sequence — prevents
    // two concurrent withSequence calls stacking on the same shared value if
    // dyingIdx fires again before the previous spring settles.
    cancelAnimation(scale);
    scale.value = withSequence(
      withTiming(1.4, { duration: 80 }),
      withTiming(0.6, { duration: 140 }),
      withSpring(1, { damping: 8, stiffness: 180 }),
    );
  }, [animate, scale]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.Text style={[styles.heart, aStyle]}>
      {alive ? '❤️' : '🤍'}
    </Animated.Text>
  );
});

// Show individual heart icons when count is small enough to fit; fall back to
// a compact "❤️ N" badge for larger counts so the HUD doesn't overflow.
const MAX_ICON_DISPLAY = 5;

const HeartsRow = memo(function HeartsRow({
  lives,
  maxLives,
}: {
  lives: number;
  maxLives: number;
}) {
  const prevLives = useRef(lives);
  const [dyingIdx, setDyingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (lives < prevLives.current) {
      setDyingIdx(lives);
      const t = setTimeout(() => setDyingIdx(null), 450);
      prevLives.current = lives;
      return () => clearTimeout(t);
    }
    prevLives.current = lives;
  }, [lives]);

  const displayMax = Math.min(maxLives, MAX_ICON_DISPLAY);

  return (
    <View
      style={styles.heartsRow}
      accessible
      accessibilityLabel={`${lives} of ${maxLives} lives remaining`}
      accessibilityLiveRegion="assertive"
    >
      {maxLives <= MAX_ICON_DISPLAY ? (
        Array.from({ length: displayMax }, (_, i) => (
          <Heart key={i} alive={i < lives} animate={dyingIdx === i} />
        ))
      ) : (
        // Compact badge for large heart counts
        <View style={styles.heartsBadge}>
          <Text style={styles.heartsBadgeText}>❤️ {lives}</Text>
        </View>
      )}
    </View>
  );
});

// ─── AnswerButton ─────────────────────────────────────────────────────────────

const AnswerButton = memo(function AnswerButton({
  answer,
  slotState,
  disabled,
  onSelect,
}: {
  answer: string;
  slotState: SlotState;
  disabled: boolean;
  onSelect: (a: string) => void;
}) {
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    scale.value = withSequence(
      withSpring(0.96, { damping: 12, stiffness: 400 }),
      withSpring(1,    { damping: 12, stiffness: 400 }),
    );
    onSelect(answer);
  }, [answer, onSelect, scale]);

  // Only the shared-value scale lives in useAnimatedStyle.
  // Opacity is a plain React style — avoids the risk of a worklet reading a stale
  // JS-closure snapshot when the UI thread re-evaluates between re-renders.
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Announce the result to screen readers after selection
  const a11yLabel =
    slotState === 'correct' ? `${answer}, correct` :
    slotState === 'wrong'   ? `${answer}, incorrect` :
    answer;

  return (
    <Animated.View style={[aStyle, slotState === 'dim' && styles.answerDim]}>
      <TouchableOpacity
        style={[
          styles.answerBtn,
          slotState === 'correct' && styles.answerCorrect,
          slotState === 'wrong'   && styles.answerWrong,
        ]}
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ disabled }}
      >
        <Text
          style={[
            styles.answerText,
            slotState === 'correct' && styles.answerTextCorrect,
            slotState === 'wrong'   && styles.answerTextWrong,
          ]}
        >
          {answer}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ─── ResultsModal ─────────────────────────────────────────────────────────────

const ResultsModal = memo(function ResultsModal({
  visible,
  isGameOver,
  score,
  correctCount,
  total,
  xpEarned,
  coinsEarned,
  onPlayAgain,
  onHome,
}: {
  visible: boolean;
  isGameOver: boolean;
  score: number;
  correctCount: number;
  total: number;
  xpEarned: number;
  coinsEarned: number;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  const cardScale = useSharedValue(0.8);

  useEffect(() => {
    if (visible) {
      cardScale.value = withSpring(1, { damping: 15, stiffness: 150 });
    } else {
      // Reset instantly so the spring always plays from 0.8 on re-open
      cardScale.value = 0.8;
    }
  }, [visible, cardScale]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android hardware back does nothing — player must choose Play Again or Home
      onRequestClose={() => {}}
    >
      <View style={modalStyles.backdrop}>
        <Animated.View style={[modalStyles.card, cardStyle]}>
          <Text style={modalStyles.emoji} accessible={false}>
            {isGameOver ? '💀' : '🏆'}
          </Text>

          <Text style={modalStyles.title} accessibilityRole="header">
            {isGameOver ? 'Game Over' : 'Complete!'}
          </Text>

          <View
            style={modalStyles.statsRow}
            accessible
            importantForAccessibility="yes"
            accessibilityLabel={`Score ${score}. ${correctCount} of ${total} correct. Accuracy ${accuracy} percent. ${xpEarned} XP earned.`}
          >
            <View style={modalStyles.stat}>
              {/* minimumFontScale prevents values shrinking below 75% (15px floor) on narrow cells */}
              <Text style={modalStyles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{score}</Text>
              <Text style={modalStyles.statLabel} numberOfLines={1}>SCORE</Text>
            </View>
            <View style={modalStyles.statDivider} />
            <View style={modalStyles.stat}>
              <Text style={modalStyles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{correctCount}/{total}</Text>
              <Text style={modalStyles.statLabel} numberOfLines={1}>CORRECT</Text>
            </View>
            <View style={modalStyles.statDivider} />
            <View style={modalStyles.stat}>
              <Text style={modalStyles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{accuracy}%</Text>
              <Text style={modalStyles.statLabel} numberOfLines={1}>ACCURACY</Text>
            </View>
            <View style={modalStyles.statDivider} />
            <View style={modalStyles.stat}>
              <Text style={[modalStyles.statValue, modalStyles.statValueXp]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>+{xpEarned}</Text>
              <Text style={modalStyles.statLabel} numberOfLines={1}>XP</Text>
            </View>
          </View>

          {/* Coins line: shown only after the save resolves with a positive award.
              Zero-coin sessions (anonymous users, save failures) render nothing. */}
          {coinsEarned > 0 && (
            <Text
              style={modalStyles.coinsEarnedText}
              accessibilityLabel={`You earned ${coinsEarned} coins`}
            >
              +{coinsEarned} 🪙
            </Text>
          )}

          <TouchableOpacity
            style={modalStyles.primaryBtn}
            onPress={onPlayAgain}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Play again"
          >
            <Text style={modalStyles.primaryBtnText}>Play Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={modalStyles.ghostBtn}
            onPress={onHome}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Go to home screen"
          >
            <Text style={modalStyles.ghostBtnText}>Home</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function QuizScreen() {
  const raw = useLocalSearchParams<{ era?: string | string[]; difficulty?: string | string[] }>();
  const era  = (Array.isArray(raw.era)        ? raw.era[0]        : raw.era)        ?? '';
  const diff = ((Array.isArray(raw.difficulty) ? raw.difficulty[0] : raw.difficulty) ?? 'mixed') as Difficulty;

  const {
    startQuiz,
    selectAnswer,
    nextQuestion,
    resetQuiz,
    isQuizOver,
    lives,
    initialLives,
    score,
    selectedAnswer,
    answerState,
    currentIndex,
    questions,
    correctCount,
  } = useQuizStore();

  const { user } = useAuth();
  // Stable primitive — user object reference changes on token refresh even
  // though the ID is unchanged. Using userId as a dep prevents fetchAndStart
  // from rebuilding (and restarting the quiz) on silent background refreshes.
  const userId = user?.id;

  const [loading,      setLoading]      = useState(true);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [showResults,  setShowResults]  = useState(false);
  const [isGameOver,   setIsGameOver]   = useState(false);
  // nextLifeAt: when the next heart regenerates; set when the player has 0 lives.
  const [nextLifeAt,   setNextLifeAt]   = useState<Date | null>(null);
  // Coins awarded for the completed quiz session; populated from the
  // save_quiz_session RPC response once the save resolves.
  const [coinsEarned,  setCoinsEarned]  = useState(0);

  // Achievement IDs unlocked this session. Stored here instead of enqueued
  // immediately because the ResultsModal is a native-layer Modal — toasts rendered
  // in the app root view are invisible behind it. Flush after the modal closes.
  const pendingToastsRef = useRef<string[]>([]);

  const scrollRef      = useRef<ScrollView>(null);
  const nextPressedRef = useRef(false);
  // Prevents double-saves in the 800ms window between a wrong-answer highlight
  // and the auto-show-results timer firing while handleNext also runs.
  const hasSavedRef    = useRef(false);
  // Null initial value avoids allocating a Promise object on every render
  // (useRef(expr) evaluates expr each render; React discards it after mount).
  // Awaited via `?? Promise.resolve()` in handleHome.
  const savePromiseRef    = useRef<Promise<void> | null>(null);
  // Guards handleHome against double-invocation during the async await gap.
  const homeNavigatingRef  = useRef(false);
  // Guards handlePlayAgain against double-invocation. Unlike homeNavigatingRef,
  // this must be reset in fetchAndStart so subsequent games can press Play Again.
  const playingAgainRef    = useRef(false);
  // Monotonically-incrementing session counter. persistResult captures the value
  // at call-time; the .then() skips setCoinsEarned when the counter has advanced,
  // preventing a save from a previous session from overwriting the new session's
  // coin display after Play Again is tapped while a save is still in-flight.
  const quizGenRef = useRef<number>(0);

  const currentQuestion: Question | null = questions[currentIndex] ?? null;

  // Shuffle answers synchronously to avoid a one-frame empty state.
  // Dep is the full Question object — its reference only changes when currentIndex
  // changes (questions array is stable post-startQuiz).
  const shuffled = useMemo<string[]>(() => {
    if (!currentQuestion) return [];
    return fisherYates([currentQuestion.correct_answer, ...currentQuestion.distractors]);
  }, [currentQuestion]);

  // Scroll to top and clear the double-tap guard after a successful advance.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    nextPressedRef.current = false;
  }, [currentIndex]);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchAndStart = useCallback(async () => {
    hasSavedRef.current       = false;
    savePromiseRef.current    = null;
    homeNavigatingRef.current = false;
    playingAgainRef.current   = false;
    pendingToastsRef.current  = [];
    quizGenRef.current += 1;
    setLoading(true);
    setFetchError(null);
    setShowResults(false);
    setIsGameOver(false);
    setCoinsEarned(0);
    setNextLifeAt(null);
    try {
      // Apply any regenerated hearts before checking if the player can start.
      // initGuestHearts() is idempotent — resolves immediately if already done.
      if (!userId) await initGuestHearts()
      const { lives: currentLives, nextLifeAt: nextAt } = userId
        ? await regenLives(userId)
        : regenLivesLocal();

      if (currentLives <= 0) {
        setNextLifeAt(nextAt);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('questions')
        .select(QUESTION_COLUMNS)
        .eq('is_approved', true);

      if (era !== 'Mixed') {
        query = query.eq('era', era);
      }

      const filter = getDifficultyFilter(diff);
      if (filter) {
        query = query.in('difficulty', filter);
      }

      const { data, error } = await query;
      if (error) throw error;

      startQuiz(era as Era, fisherYates((data ?? []) as Question[]), Math.min(LIVES_PER_QUIZ, currentLives));
    } catch (e) {
      console.error('[QuizScreen] fetch error:', e);
      setFetchError('Could not load questions. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [era, diff, startQuiz, userId]);

  useEffect(() => {
    void fetchAndStart();
  }, [fetchAndStart]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    resetQuiz();
    router.back();
  }, [resetQuiz]);

  // Single save path shared by all three completion triggers (game-over effect,
  // isQuizOver branch, questions-exhausted branch).
  //
  // hasSavedRef prevents double-writes: if the user taps Next in the 800ms
  // window before the game-over timer fires, the first caller wins and the
  // second is a no-op.
  //
  // useQuizStore.getState() is required for score/currentIndex/correctCount
  // because handleNext's useCallback deps are stable Zustand methods (never
  // change reference), so those values are always stale in handleNext's closure.
  const persistResult = useCallback(() => {
    // saveQuizResult validates its own inputs — !era here is a redundant fast-path
    // to avoid a round-trip we know will be rejected.
    if (hasSavedRef.current || !era || !user) return;
    hasSavedRef.current = true;
    // Capture the generation at call-time. The .then() below compares against
    // quizGenRef.current at resolution-time; if they differ, Play Again ran
    // between the save starting and resolving.
    const savedGen = quizGenRef.current;
    // Capture all values up-front so the error log is provably identical to
    // what was passed to saveQuizResult — no risk of log diverging from actual call.
    const { score: s, currentIndex: idx, correctCount: cc, maxStreak: ms, lives: lv } = useQuizStore.getState();
    const questionsAnswered = idx + 1;
    const questionsCorrect  = cc;
    const perfect           = cc === questionsAnswered;
    const livesRemaining    = lv;
    savePromiseRef.current = saveQuizResult({
      userId: user.id,
      era,
      score: s,
      questionsAnswered,
      questionsCorrect,
      maxStreak: ms,
      perfect,
      livesRemaining,
    })
      .then((result) => {
        // Discard stale saves from a previous session.
        if (quizGenRef.current !== savedGen) return;
        setCoinsEarned(result.coinsEarned);
        // Store — do NOT enqueue yet. The ResultsModal is a native Modal layer
        // that sits above the app root view, so any toast started now would be
        // invisible. Flush to the store after the modal closes (handlePlayAgain /
        // handleHome), at which point there's no Modal obscuring the overlay.
        pendingToastsRef.current = result.newlyUnlocked;
        profileSignalStore.getState().bumpProfileVersion();
      })
      .catch((err: unknown) => {
        console.error('[QuizScreen] failed to save quiz result:', err, {
          era,
          score: s,
          questionsAnswered,
          questionsCorrect,
        });
        // Surface the error so it's visible during development and testing.
        // In a production build __DEV__ is false, so this is a no-op for users.
        if (__DEV__) {
          const msg = (err instanceof Error || (typeof err === 'object' && err !== null && 'message' in err))
            ? (err as { message: string }).message
            : String(err);
          Alert.alert('Save failed (dev only)', msg);
        }
      });
  }, [era, user]);

  // Auto-show results when the player loses their last life.
  // The 800ms delay lets the red answer highlight remain visible before the modal
  // appears — same rationale as the old auto-navigate delay.
  useEffect(() => {
    if (lives > 0 || answerState === 'idle' || questions.length === 0) return;
    const t = setTimeout(() => {
      persistResult();
      setIsGameOver(true);
      setShowResults(true);
    }, 800);
    return () => clearTimeout(t);
  }, [lives, answerState, questions.length, persistResult]);

  const handleNext = useCallback(() => {
    if (nextPressedRef.current) return;
    nextPressedRef.current = true;

    // Two reset strategies — identical logic to the original, just replacing
    // goToResults() with setShowResults(true):
    //
    // SHOW-MODAL paths (isQuizOver OR nextQuestion→false): currentIndex does NOT
    // change, so useEffect([currentIndex]) never fires. Reset the guard here,
    // synchronously, before showing the modal.
    //
    // ADVANCE path (nextQuestion→true): currentIndex increments, triggering
    // useEffect([currentIndex]) which resets the guard after the re-render.
    if (isQuizOver()) {
      nextPressedRef.current = false;
      // Read fresh state to avoid stale closure on `lives`
      setIsGameOver(useQuizStore.getState().lives <= 0);
      persistResult();
      setShowResults(true);
      return;
    }

    const advanced = nextQuestion();
    if (!advanced) {
      nextPressedRef.current = false;
      // nextQuestion returned false with lives > 0 (isQuizOver was false above),
      // meaning currentIndex + 1 >= questions.length — all questions exhausted.
      setIsGameOver(false);
      persistResult();
      setShowResults(true);
    }
    // advanced === true: leave ref=true; useEffect([currentIndex]) will clear it
  }, [isQuizOver, nextQuestion, persistResult]);

  const handlePlayAgain = useCallback(async () => {
    // Guard against double-invocation. The modal stays visible during the async
    // await below (up to HOME_SAVE_TIMEOUT_MS), so the button remains tappable.
    // Without this, two concurrent invocations both call fetchAndStart(), causing
    // two concurrent question fetches that overwrite each other mid-render.
    // fetchAndStart() resets this ref so the next game can press Play Again.
    if (playingAgainRef.current) return;
    playingAgainRef.current = true;
    // Await the chained save promise before reading pendingToastsRef. This is the
    // same pattern as handleHome. savePromiseRef.current is the result of
    // saveQuizResult(...).then(...), so awaiting it guarantees persistResult's
    // .then() has already populated pendingToastsRef — even if the user taps
    // "Play Again" before the network RPC resolves. withTimeout ensures we never
    // block longer than HOME_SAVE_TIMEOUT_MS regardless of network conditions.
    await withTimeout(savePromiseRef.current ?? Promise.resolve(), HOME_SAVE_TIMEOUT_MS);
    const pending = pendingToastsRef.current;
    if (pending.length > 0) {
      useAchievementStore.getState().enqueueToasts(pending);
      pendingToastsRef.current = [];
    }
    // resetQuiz() is load-bearing here: it changes lives/answerState/questions.length,
    // which are deps of the game-over effect. React fires that effect's cleanup
    // (clearTimeout) before the 800ms timer can fire — preventing a stale timer
    // from re-opening the modal over the new quiz. Do not remove.
    resetQuiz();
    void fetchAndStart();
  }, [resetQuiz, fetchAndStart]);

  const handleHome = useCallback(async () => {
    // Guard: prevent double-invocation during the async gap between the await
    // resolving and router.replace() completing.
    if (homeNavigatingRef.current) return;
    homeNavigatingRef.current = true;
    // Await the in-flight DB write so the next screen's useFocusEffect sees
    // committed data. Raced against a 5 s timeout so a network drop can't
    // freeze the UI. withTimeout always resolves (never rejects), so no try/catch needed.
    await withTimeout(savePromiseRef.current ?? Promise.resolve(), HOME_SAVE_TIMEOUT_MS);
    // Flush pending toasts after the save resolves — the Modal is now closing and
    // the home screen is about to render, so the toast will be visible.
    const pending = pendingToastsRef.current;
    if (pending.length > 0) {
      useAchievementStore.getState().enqueueToasts(pending);
      pendingToastsRef.current = [];
    }
    resetQuiz();
    router.replace('/');
    // homeNavigatingRef intentionally never reset — router.replace() unmounts this component.
  }, [resetQuiz]);

  // Wraps selectAnswer so a wrong answer also deducts one persistent heart from
  // the backing store (DB for signed-in users, MMKV for guests). Fire-and-forget:
  // the store already decremented lives synchronously so the UI updates immediately.
  const handleSelectAnswer = useCallback((answer: string) => {
    selectAnswer(answer);
    const { answerState: newState } = useQuizStore.getState();
    // Fire on every wrong answer — store already decremented synchronously so
    // the UI updates immediately. Promise.resolve().then() ensures the local
    // path runs inside the promise chain so MMKV throws are caught by .catch().
    if (newState === 'wrong') {
      const deduct = userId
        ? deductLife(userId)
        : Promise.resolve().then(() => deductLifeLocal());
      deduct.catch((err) => {
        console.error('[QuizScreen] deductLife error:', err);
      });
    }
  }, [selectAnswer, userId]);

  // Memoised: only recreated when the reactive inputs that affect slot state change.
  const getSlotState = useCallback((answer: string): SlotState => {
    if (answerState === 'idle') return 'idle';
    if (answer === currentQuestion?.correct_answer) return 'correct';
    if (answer === selectedAnswer) return 'wrong';
    return 'dim';
  }, [answerState, currentQuestion, selectedAnswer]);

  // ── Render guards ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold} />
          <Text style={styles.loadingText}>Loading questions…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.stateTitle}>Something went wrong</Text>
          <Text style={styles.stateDetail}>{fetchError}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={fetchAndStart}
            accessibilityRole="button"
            accessibilityLabel="Retry loading questions"
          >
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={handleBack}
            hitSlop={BACK_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.ghostBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // No lives — must come BEFORE the questions.length === 0 guard because both
  // states have questions.length === 0 (startQuiz is never called when lives = 0).
  // nextLifeAt.getTime() is guarded against Invalid Date via the isNaN check in
  // regenLives — if parsing failed, nextLifeAt is null and we fall back to REGEN_HOURS.
  if (lives <= 0 && questions.length === 0) {
    const hoursUntil = nextLifeAt
      ? Math.max(0, Math.ceil((nextLifeAt.getTime() - Date.now()) / 3_600_000))
      : REGEN_HOURS;
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={{ fontSize: 52 }}>💔</Text>
          <Text style={styles.stateTitle}>Out of Hearts</Text>
          <Text style={styles.stateDetail}>
            {hoursUntil <= 1
              ? 'Your next heart is regenerating soon.'
              : `Your next heart regenerates in about ${hoursUntil} hours.`}
          </Text>
          <Text style={[styles.stateDetail, { marginTop: 4 }]}>
            {userId ? 'Buy hearts from the Shop to play now.' : 'Sign up to buy hearts and play now.'}
          </Text>
          <TouchableOpacity
            style={[styles.ghostBtn, { marginTop: 8 }]}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.ghostBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (questions.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.stateTitle}>No questions available</Text>
          <Text style={styles.stateDetail}>Try a different era or difficulty.</Text>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={handleBack}
            hitSlop={BACK_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.ghostBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Belt-and-suspenders: currentIndex out of bounds should not occur post-startQuiz
  if (!currentQuestion) return null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>

      {/* ── Results modal ────────────────────────────────────────────────────── */}
      <ResultsModal
        visible={showResults}
        isGameOver={isGameOver}
        score={score}
        correctCount={correctCount}
        total={currentIndex + 1}
        xpEarned={score}
        coinsEarned={coinsEarned}
        onPlayAgain={handlePlayAgain}
        onHome={handleHome}
      />

      {/* ── HUD ─────────────────────────────────────────────────────────────── */}
      <AnimatedSlot delay={0} style={styles.hud}>
        <TouchableOpacity
          style={styles.hudBack}
          onPress={handleBack}
          hitSlop={BACK_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Exit quiz"
        >
          <Text style={styles.hudBackText}>‹</Text>
        </TouchableOpacity>

        <Text style={styles.hudEra} numberOfLines={1}>{era}</Text>

        <View style={styles.hudRight} accessible accessibilityLabel={`${score} XP earned`}>
          <Text style={styles.hudXpText}>+{score} XP</Text>
        </View>
      </AnimatedSlot>

      {/* ── Lives ───────────────────────────────────────────────────────────── */}
      <AnimatedSlot delay={55}>
        <HeartsRow lives={lives} maxLives={initialLives} />
      </AnimatedSlot>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        {/* Re-keyed per question so AnimatedSlot replays its entrance animation */}
        <AnimatedSlot key={`ctr-${currentIndex}`} delay={110}>
          <Text style={styles.counter}>Question {currentIndex + 1}</Text>
        </AnimatedSlot>

        <AnimatedSlot key={`q-${currentIndex}`} delay={165} style={styles.questionCard}>
          <Text style={styles.questionText}>{currentQuestion.question_text}</Text>
        </AnimatedSlot>

        <View style={styles.answers}>
          {shuffled.map((answer, i) => (
            <AnimatedSlot key={`${currentIndex}-${i}`} delay={220 + i * 55}>
              <AnswerButton
                answer={answer}
                slotState={getSlotState(answer)}
                disabled={answerState !== 'idle'}
                onSelect={handleSelectAnswer}
              />
            </AnimatedSlot>
          ))}
        </View>

        {answerState !== 'idle' && (
          <Animated.View entering={FadeIn.duration(220)} style={styles.nextWrap}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleNext}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="Next question"
            >
              <Text style={styles.nextBtnText}>Next →</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },

  // HUD
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  hudBack: {
    width: 56,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  hudBackText: {
    fontSize: 32,
    color: Colors.gold,
    lineHeight: 36,
  },
  hudEra: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.gold,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  hudRight: {
    width: 56,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  hudXpText: {
    fontFamily: Fonts.displayBold,
    fontSize: 13,
    color: Colors.gold,
    letterSpacing: 0.5,
  },

  // Lives
  heartsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  heart: {
    fontSize: 26,
  },
  heartsBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heartsBadgeText: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.textPrimary,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },

  // Counter
  counter: {
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  // Question card
  questionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    padding: Spacing.lg,
  },
  questionText: {
    fontSize: 17,
    color: Colors.textPrimary,
    lineHeight: 26,
    textAlign: 'center',
  },

  // Answers
  answers: {
    gap: Spacing.sm,
  },
  answerBtn: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
  },
  answerCorrect: {
    backgroundColor: Colors.correctBg,
    borderColor: Colors.correct,
  },
  answerWrong: {
    backgroundColor: Colors.wrongBg,
    borderColor: Colors.wrong,
  },
  answerDim: {
    opacity: 0.4,
  },
  answerText: {
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Spec says "white text" on selected answers, but #fff on correctBg (#E8F5EE) /
  // wrongBg (#F5E8EA) yields ~1.2:1 contrast — unusable (WCAG AA requires 4.5:1).
  // Saturated semantic colors give ~4.5:1+. Revisit if backgrounds are darkened.
  answerTextCorrect: {
    color: Colors.correct,
    fontWeight: '600',
  },
  answerTextWrong: {
    color: Colors.wrong,
    fontWeight: '600',
  },

  // Next button
  nextWrap: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  nextBtn: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
  },
  nextBtnText: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 1.5,
  },

  // State screens (loading / error / empty)
  loadingText: {
    fontSize: 14,
    color: Colors.textMuted,
    letterSpacing: 1,
  },
  stateTitle: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.textPrimary,
    letterSpacing: 1,
    textAlign: 'center',
  },
  stateDetail: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  primaryBtnText: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.surface,
    letterSpacing: 1,
  },
  ghostBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  ghostBtnText: {
    fontSize: 14,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  card: {
    width: '85%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.gold,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  emoji: {
    fontSize: 52,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.gold,
    letterSpacing: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: Spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 1.2,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.border,
  },
  statValueXp: {
    color: Colors.gold,
  },
  coinsEarnedText: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.gold,
    letterSpacing: 1,
  },
  primaryBtn: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    width: '100%',
  },
  primaryBtnText: {
    fontFamily: Fonts.displayBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 1.5,
  },
  ghostBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    width: '100%',
  },
  ghostBtnText: {
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.gold,
    letterSpacing: 1,
  },
});
