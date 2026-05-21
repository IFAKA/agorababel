import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

const stepRevealTransition = {
  duration: 0.24,
  ease: [0.23, 1, 0.32, 1],
} as const;

export function StepReveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ ...stepRevealTransition, delay }}
    >
      {children}
    </motion.div>
  );
}
