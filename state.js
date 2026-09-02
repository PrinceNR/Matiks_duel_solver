import { solvePuzzle } from './solver.js';

export function createInitialState() {
  return {
    mode: null,
    value: null,
    rawText: '',
    source: null,
    autoWatch: false,
    solution: { answer: null, details: 'Ready to solve.' },
    status: 'Ready to solve.',
    updatedAt: Date.now(),
  };
}

export function withCapture(state, capture) {
  const safeCapture = capture && typeof capture === 'object' ? capture : {};
  const mode = typeof safeCapture.mode === 'string' ? safeCapture.mode : null;
  const value = typeof safeCapture.value === 'string' ? safeCapture.value : null;
  const rawText = typeof safeCapture.rawText === 'string' ? safeCapture.rawText : '';
  const source = typeof safeCapture.source === 'string' ? safeCapture.source : null;

  // Sprint/Duel rounds commonly show only a generic instruction instead of a
  // named mode. A valid expression is enough for the solver to infer the task.
  const solution = value ? solvePuzzle(mode, value) : { answer: null, details: 'Awaiting puzzle...' };

  return {
    ...createInitialState(),
    ...state,
    mode,
    value,
    rawText,
    source,
    solution,
    status: value ? (solution.answer ? `Solved: ${solution.answer}` : solution.details) : 'No complete puzzle found yet.',
    updatedAt: Date.now(),
  };
}
