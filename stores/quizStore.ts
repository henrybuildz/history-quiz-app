import { create } from 'zustand';
import type { Question, Era, AnswerState } from '../types';

interface QuizStore {
  era: Era | null;
  questions: Question[];
  currentIndex: number;
  lives: number;
  initialLives: number;  // lives at quiz start — used for empty-heart display
  score: number;
  selectedAnswer: string | null;
  answerState: AnswerState;
  correctCount: number;
  currentStreak: number;
  maxStreak: number;

  startQuiz: (era: Era, questions: Question[], initialLives: number) => void;
  selectAnswer: (answer: string) => void;
  nextQuestion: () => boolean;
  resetQuiz: () => void;
  isQuizOver: () => boolean;
}

const INITIAL_STATE: Omit<QuizStore, 'startQuiz' | 'selectAnswer' | 'nextQuestion' | 'resetQuiz' | 'isQuizOver'> = {
  era: null,
  questions: [],
  currentIndex: 0,
  lives: 0,
  initialLives: 0,
  score: 0,
  selectedAnswer: null,
  answerState: 'idle',
  correctCount: 0,
  currentStreak: 0,
  maxStreak: 0,
};

export const useQuizStore = create<QuizStore>((set, get) => ({
  ...INITIAL_STATE,

  startQuiz: (era, questions, initialLives) => {
    if (!questions || questions.length === 0) {
      console.warn('startQuiz called with empty questions array');
      return;
    }
    set({ ...INITIAL_STATE, era, questions, lives: initialLives, initialLives });
  },

  selectAnswer: (answer) => {
    const { questions, currentIndex, score, lives, correctCount, currentStreak, maxStreak, answerState } = get();

    // Guard against double-tap
    if (answerState !== 'idle') return;

    const question = questions[currentIndex];
    if (!question) return;

    const isCorrect = answer === question.correct_answer;
    const nextStreak = isCorrect ? currentStreak + 1 : 0;
    set({
      selectedAnswer: answer,
      answerState:    isCorrect ? 'correct' : 'wrong',
      score:          isCorrect ? score + 100 : score,
      lives:          isCorrect ? lives : Math.max(0, lives - 1),
      correctCount:   isCorrect ? correctCount + 1 : correctCount,
      currentStreak:  nextStreak,
      maxStreak:      Math.max(maxStreak, nextStreak),
    });
  },

  // Returns true if advanced, false if quiz is over (no lives OR no questions left)
  nextQuestion: () => {
    const { currentIndex, questions, lives } = get();
    if (lives <= 0 || currentIndex + 1 >= questions.length) return false;
    set({
      currentIndex: currentIndex + 1,
      selectedAnswer: null,
      answerState: 'idle',
    });
    return true;
  },

  isQuizOver: () => {
    const { lives, currentIndex, questions } = get();
    return lives <= 0 || currentIndex >= questions.length;
  },

  resetQuiz: () => set(INITIAL_STATE),
}));
