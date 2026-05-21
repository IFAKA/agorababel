import { motion } from 'motion/react';

const traceEase = [0.23, 1, 0.32, 1] as const;

const lineMotion = (delay: number, opacity = 1) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity },
  transition: { pathLength: { duration: 0.52, delay, ease: 'linear' }, opacity: { duration: 0.28, delay, ease: traceEase } },
});

const nodeMotion = (delay: number) => ({
  initial: { scale: 0.68, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { duration: 0.32, delay, ease: traceEase },
});

export function AgoraBabelTraceMark({
  animated = false,
  className,
}: {
  animated?: boolean;
  className?: string;
}) {
  const Line = animated ? motion.path : 'path';
  const Circle = animated ? motion.circle : 'circle';

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Line
        d="M8 18H29C34.6 18 36.8 26 42.4 26H56"
        stroke="currentColor"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(animated ? lineMotion(0.14) : {})}
      />
      <Line
        d="M8 32H22.8C27.8 32 30.8 38 36 38H56"
        stroke="currentColor"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.82"
        {...(animated ? lineMotion(0.28, 0.82) : {})}
      />
      <Line
        d="M8 46H31C36.2 46 39.2 32 44.8 32H56"
        stroke="currentColor"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.72"
        {...(animated ? lineMotion(0.42, 0.72) : {})}
      />
      <Circle
        cx="29"
        cy="18"
        r="5.6"
        fill="var(--surface-2)"
        stroke="currentColor"
        strokeWidth="3.4"
        {...(animated ? nodeMotion(0.62) : {})}
      />
      <Circle
        cx="36"
        cy="38"
        r="5.6"
        fill="var(--surface-2)"
        stroke="currentColor"
        strokeWidth="3.4"
        {...(animated ? nodeMotion(0.74) : {})}
      />
      <Circle
        cx="46"
        cy="32"
        r="6.6"
        fill="var(--surface-2)"
        stroke="currentColor"
        strokeWidth="3.4"
        {...(animated ? nodeMotion(0.86) : {})}
      />
      <Line
        d="M42.6 31.8L45.2 34.4L50.2 28.8"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(animated ? lineMotion(1.02) : {})}
      />
    </svg>
  );
}
