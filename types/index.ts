export type Era =
  | 'Ancient Rome'
  | 'Ancient Greece'
  | 'Ancient Egypt'
  | 'Medieval Europe'
  | 'Renaissance'
  | 'World War I'
  | 'World War II'
  | 'Cold War'
  | 'Napoleonic Wars'
  | 'Prussia'
  | 'Holy Roman Empire'
  | 'Bismarck Era'
  | 'Byzantine Empire'
  | 'Ottoman Empire'
  | 'Persian Empire'
  | 'Islamic Golden Age'
  | 'The Americas'
  | 'East Asia'
  | 'Early Civilizations'
  | 'Early Modern Europe'
  | 'Age of Exploration'
  | 'Russia'
  | 'Africa'
  | 'South Asia'
  | 'Latin America'
  | 'Modern Era'
  | '19th Century'
  | 'Science History'
  | 'Religious History'
  | 'Mixed';

export interface Question {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: [string, string, string];
  explanation: string | null;
  era: Era;
  topic: string | null;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export type AnswerState = 'idle' | 'correct' | 'wrong';

export interface QuizSession {
  era: Era;
  questions: Question[];
  currentIndex: number;
  lives: number;
  score: number;
  selectedAnswer: string | null;
  answerState: AnswerState;
  correctCount: number;
}