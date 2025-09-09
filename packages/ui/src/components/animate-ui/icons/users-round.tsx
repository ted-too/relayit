"use client";

import {
  getVariants,
  type IconProps,
  IconWrapper,
  useAnimateIconContext,
} from "@repo/ui/components/animate-ui/icons/icon";
import { motion, type Variants } from "motion/react";

type UsersRoundProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    path1: {
      initial: {
        y: 0,
      },
      animate: {
        y: [0, 4, -2, 0],
        transition: {
          duration: 0.6,
          ease: "easeInOut",
          delay: 0.1,
        },
      },
    },
    path2: {
      initial: {
        y: 0,
      },
      animate: {
        y: [0, 1, -2, 0],
        transition: {
          duration: 0.6,
          ease: "easeInOut",
        },
      },
    },
    path3: {
      initial: {
        y: 0,
      },
      animate: {
        y: [0, 4, -2, 0],
        transition: {
          duration: 0.6,
          ease: "easeInOut",
        },
      },
    },
    circle: {
      initial: {
        y: 0,
      },
      animate: {
        y: [0, 1, -2, 0],
        transition: {
          duration: 0.6,
          ease: "easeInOut",
          delay: 0.1,
        },
      },
    },
  } satisfies Record<string, Variants>,
  appear: {
    path1: {},
    path2: {
      initial: {
        x: -5,
        opacity: 0,
      },
      animate: {
        x: 0,
        opacity: 1,
        transition: {
          type: "spring",
          stiffness: 100,
          damping: 10,
        },
      },
    },
    path3: {
      initial: {
        x: -5,
        opacity: 0,
      },
      animate: {
        x: 0,
        opacity: 1,
        transition: {
          type: "spring",
          stiffness: 100,
          damping: 10,
        },
      },
    },
    circle: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: UsersRoundProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Users Round</title>
      <motion.path
        animate={controls}
        d="M18,21c0-4.4-3.6-8-8-8s-8,3.6-8,8"
        initial="initial"
        variants={variants.path1}
      />
      <motion.path
        animate={controls}
        d="M18,12c2.2-1.7,2.7-4.8,1-7-.4-.5-.9-1-1.4-1.3"
        initial="initial"
        variants={variants.path2}
      />
      <motion.path
        animate={controls}
        d="M22,20c0-3.4-2-6.5-4-8"
        initial="initial"
        variants={variants.path3}
      />
      <motion.circle
        animate={controls}
        cx={10}
        cy={8}
        initial="initial"
        r={5}
        variants={variants.circle}
      />
    </motion.svg>
  );
}

function UsersRound(props: UsersRoundProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  UsersRound,
  UsersRound as UsersRoundIcon,
  type UsersRoundProps,
  type UsersRoundProps as UsersRoundIconProps,
};
