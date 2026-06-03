import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { supabase, saveQuizResult } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { AnimatedSlot } from '../../components/AnimatedSlot';
import type { Question, Era } from '../../types';

// ─── Types & Utilities ────────────────────────────────────────────────────────

type Difficulty = 'mixed' | 'easy' | 'medium' | 'hard';
type SlotState = 'idle' | 'correct' | 'wrong' | 'dim';

const BACK_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

// Explicit column list avoids over-fetching and shields against future schema additions
const QUESTION_COLUMNS = 'id, question_text, correct_answer, distractors, era, difficulty';

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

const HeartsRow = memo(function HeartsRow({ lives }: { lives: number }) {
  const prevLives = useRef(lives);
  const [dyingIdx, setDyingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (lives < prevLives.current) {
      // After decrement, `lives` equals the 0-based index of the newly-dead heart
      setDyingIdx(lives);
      const t = setTimeout(() => setDyingIdx(null), 450);
      prevLives.current = lives;
      return () => clearTimeout(t);
    }
    prevLives.current = lives;
  }, [lives]);

  return (
    <View
      style={styles.heartsRow}
      // "assertive" interrupts current speech — appropriate for high-priority
      // feedback like losing a life mid-answer-selection
      accessibilityLabel={`${lives} of 3 lives remaining`}
      accessibilityLiveRegion="assertive"
    >
      {[0, 1, 2].map((i) => (
        <Heart key={i} alive={i < lives} animate={dyingIdx === i} />
      ))}
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
  onPlayAgain,
  onHome,
}: {
  visible: boolean;
  isGameOver: boolean;
  score: number;
  correctCount: number;
  total: number;
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
            accessibilityLabel={`Score ${score}. ${correctCount} of ${total} correct. Accuracy ${accuracy} percent.`}
          >
            <View style={modalStyles.stat}>
              <Text style={modalStyles.statValue}>{score}</Text>
              <Text style={modalStyles.statLabel}>SCORE</Text>
            </View>
            <View style={modalStyles.statDivider} />
            <View style={modalStyles.stat}>
              <Text style={modalStyles.statValue}>{correctCount}/{total}</Text>
              <Text style={modalStyles.statLabel}>CORRECT</Text>
            </View>
            <View style={modalStyles.statDivider} />
            <View style={modalStyles.stat}>
              <Text style={modalStyles.statValue}>{accuracy}%</Text>
              <Text style={modalStyles.statLabel}>ACCURACY</Text>
            </View>
          </View>

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
    score,
    selectedAnswer,
    answerState,
    currentIndex,
    questions,
    correctCount,
  } = useQuizStore();

  const { user, isAnonymous } = useAuth();

  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [isGameOver,  setIsGameOver]  = useState(false);

  const scrollRef      = useRef<ScrollView>(null);
  const nextPressedRef = useRef(false);
  // Prevents double-saves in the 800ms window between a wrong-answer highlight
  // and the auto-show-results timer firing while handleNext also runs.
  const hasSavedRef    = useRef(false);

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
    hasSavedRef.current = false;
    setLoading(true);
    setFetchError(null);
    setShowResults(false);
    setIsGameOver(false);
    try {
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

      startQuiz(era as Era, fisherYates((data ?? []) as Question[]));
    } catch (e) {
      // Log raw error for debugging; never expose Supabase internals to the user
      console.error('[QuizScreen] fetch error:', e);
      setFetchError('Could not load questions. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [era, diff, startQuiz]);

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
    // isAnonymous and !user are first-line guards to skip the network call entirely.
    // saveQuizResult validates its own inputs — !era here is a redundant fast-path
    // to avoid a round-trip we know will be rejected.
    if (hasSavedRef.current || !era || isAnonymous || !user) return;
    hasSavedRef.current = true;
    // Capture all values up-front so the error log is provably identical to
    // what was passed to saveQuizResult — no risk of log diverging from actual call.
    const { score: s, currentIndex: idx, correctCount: cc } = useQuizStore.getState();
    const questionsAnswered = idx + 1;
    const questionsCorrect  = cc;
    saveQuizResult({
      userId: user.id,
      era,
      score: s,
      questionsAnswered,
      questionsCorrect,
    }).catch((err: unknown) => {
      // Two failure modes:
      //   sessionError  → no row written, score fully lost.
      //   profileError  → session row exists but profile score not updated (non-atomic).
      // hasSavedRef is already true so no retry will fire. Retry requires
      // idempotent DB writes (unique constraint + ON CONFLICT) before it is safe.
      console.error('[QuizScreen] failed to save quiz result:', err, {
        era,
        score: s,
        questionsAnswered,
        questionsCorrect,
      });
    });
  }, [era, isAnonymous, user]);

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

  const handlePlayAgain = useCallback(() => {
    // resetQuiz() is load-bearing here: it changes lives/answerState/questions.length,
    // which are deps of the game-over effect. React fires that effect's cleanup
    // (clearTimeout) before the 800ms timer can fire — preventing a stale timer
    // from re-opening the modal over the new quiz. Do not remove.
    resetQuiz();
    void fetchAndStart();
  }, [resetQuiz, fetchAndStart]);

  const handleHome = useCallback(() => {
    resetQuiz();
    router.replace('/');
  }, [resetQuiz]);

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

        <View
          style={styles.hudScoreBox}
          accessibilityLabel={`Score: ${score}`}
        >
          <Text style={styles.hudScoreText}>{score}</Text>
        </View>
      </AnimatedSlot>

      {/* ── Lives ───────────────────────────────────────────────────────────── */}
      <AnimatedSlot delay={55}>
        <HeartsRow lives={lives} />
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
                onSelect={selectAnswer}
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
    width: 40,
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
  hudScoreBox: {
    width: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  hudScoreText: {
    fontFamily: Fonts.displayBold,
    fontSize: 16,
    color: Colors.textPrimary,
  },

  // Lives
  heartsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  heart: {
    fontSize: 26,
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
