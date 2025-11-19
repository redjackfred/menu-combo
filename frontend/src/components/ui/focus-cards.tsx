import React, { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Card {
  title: string;
  description?: string;
  price?: number;
  category?: string;
  src?: string;
}

interface CardProps {
  card: Card;
  index: number;
  hovered: number | null;
  setHovered: React.Dispatch<React.SetStateAction<number | null>>;
}

export const Card: React.FC<CardProps> = ({ card, index, hovered, setHovered }) => {
  return (
    <motion.div
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
      className={cn(
        "relative rounded-lg overflow-hidden h-60 md:h-96 w-full transition-all duration-300 ease-out cursor-pointer",
        hovered !== null && hovered !== index && "blur-sm scale-[0.98] opacity-70"
      )}
    >
      <motion.div
        animate={{
          scale: hovered === index ? 1.05 : 1,
        }}
        transition={{ duration: 0.3 }}
        className="h-full w-full"
      >
        {card.src ? (
          <img
            src={card.src}
            alt={card.title}
            className="object-cover h-full w-full absolute inset-0"
          />
        ) : (
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 h-full w-full absolute inset-0" />
        )}

        <div className="absolute inset-0 bg-black/50 flex flex-col justify-end p-6">
          <motion.h2
            animate={{
              y: hovered === index ? -10 : 0,
            }}
            transition={{ duration: 0.3 }}
            className="text-xl md:text-2xl font-bold text-white"
          >
            {card.title}
          </motion.h2>

          {card.description && (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{
                opacity: hovered === index ? 1 : 0,
                y: hovered === index ? 0 : 20,
              }}
              transition={{ duration: 0.3 }}
              className="text-sm text-gray-200 mt-2"
            >
              {card.description}
            </motion.p>
          )}

          <div className="flex items-center justify-between mt-3">
            {card.price !== undefined && (
              <motion.span
                animate={{
                  scale: hovered === index ? 1.1 : 1,
                }}
                className="text-lg md:text-xl font-bold text-green-400"
              >
                ${Number(card.price).toFixed(2)}
              </motion.span>
            )}

            {card.category && (
              <span className="text-xs bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-white">
                {card.category}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

interface FocusCardsProps {
  cards: Card[];
}

export const FocusCards: React.FC<FocusCardsProps> = ({ cards }) => {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {cards.map((card, index) => (
        <Card
          key={index}
          card={card}
          index={index}
          hovered={hovered}
          setHovered={setHovered}
        />
      ))}
    </div>
  );
};
