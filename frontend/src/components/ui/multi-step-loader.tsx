import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { IconCheck } from "@tabler/icons-react";

interface LoadingState {
  text: string;
}

interface MultiStepLoaderProps {
  loadingStates: LoadingState[];
  loading?: boolean;
  duration?: number;
  currentState?: number;
  loop?: boolean;
}

export const MultiStepLoader: React.FC<MultiStepLoaderProps> = ({
  loadingStates,
  loading = true,
  duration = 2000,
  currentState = 0,
  loop = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentState !== undefined) {
      setCurrentIndex(currentState);
    }
  }, [currentState]);

  useEffect(() => {
    if (!loading || currentState !== undefined) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev === loadingStates.length - 1) {
          return loop ? 0 : prev;
        }
        return prev + 1;
      });
    }, duration);

    return () => clearInterval(interval);
  }, [loading, duration, loadingStates.length, loop, currentState]);

  if (!loading) return null;

  return (
    <div className="relative">
      <div className="space-y-4">
        {loadingStates.map((state, index) => {
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          const isFuture = index > currentIndex;

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{
                opacity: isActive ? 1 : isCompleted ? 0.7 : 0.4,
                x: 0,
                scale: isActive ? 1.05 : 1,
              }}
              transition={{ duration: 0.3 }}
              className={cn(
                "flex items-center gap-4 p-4 rounded-lg transition-all",
                isActive && "bg-purple-50 dark:bg-purple-900/20 shadow-lg",
                isCompleted && "opacity-70",
                isFuture && "opacity-40"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all",
                  isCompleted && "bg-green-500",
                  isActive && "bg-purple-500 animate-pulse",
                  isFuture && "bg-gray-300 dark:bg-gray-700"
                )}
              >
                {isCompleted ? (
                  <IconCheck className="w-5 h-5 text-white" />
                ) : (
                  <motion.div
                    animate={isActive ? { scale: [1, 1.2, 1] } : {}}
                    transition={{ duration: 1, repeat: Infinity }}
                    className={cn(
                      "w-3 h-3 rounded-full",
                      isActive && "bg-white",
                      isFuture && "bg-gray-500"
                    )}
                  />
                )}
              </div>

              <div className="flex-1">
                <motion.p
                  animate={{
                    fontWeight: isActive ? 600 : 400,
                  }}
                  className={cn(
                    "text-sm transition-colors",
                    isActive && "text-purple-700 dark:text-purple-300",
                    isCompleted && "text-green-600 dark:text-green-400",
                    isFuture && "text-gray-500 dark:text-gray-400"
                  )}
                >
                  {state.text}
                </motion.p>
              </div>

              <AnimatePresence>
                {isActive && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0 }}
                    className="flex gap-1"
                  >
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
