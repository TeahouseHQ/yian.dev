import { useState, useRef, useEffect, useCallback } from "react";

import Typewriter from "./utils/typewriter";
import "./TypeWriter.css";

interface SequenceItem {
  text: string;
  delayAfter?: number;
}

const initializeTypewriterJs = (
  targetDom: HTMLElement | null,
  onComplete: () => void
): Typewriter => {
  if (targetDom === null) {
    throw new Error("targetDom is null");
  }
  const typewriter = new Typewriter(targetDom);
  typewriter.setCaret("_");
  typewriter.setCaretPeriod(500);
  typewriter.setDelay(50, 20);
  typewriter.setSeqCompletionCallback(onComplete);
  return typewriter;
};

const TypeWriter = ({ phrases }: { phrases: string[] }): React.JSX.Element => {
  const [isTypeProgressing, setIsTypeProgressing] = useState(false);
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const targetSpan = useRef<HTMLElement>(null);
  const typewriter = useRef<Typewriter | null>(null);

  const getRandomPhrase = useCallback(
    (shouldClearPreviousContent: boolean) => {
      const previousPhrase = sequence.length && sequence[sequence.length - 1].text;

      const result =
        shouldClearPreviousContent && previousPhrase
          ? [{ text: "\b".repeat(previousPhrase.length), delayAfter: 300 }]
          : [];

      let randomPhrase;

      do {
        randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      } while (randomPhrase === previousPhrase);

      result.push({
        text: randomPhrase,
        delayAfter: 0,
      });

      return result;
    },
    [phrases, sequence]
  );

  const onTypeSequenceComplete = (): void => {
    setIsTypeProgressing(false);
  };

  const playRandomSequence = useCallback(
    (shouldClearPreviousContent: boolean) => {
      if (typewriter.current === null) {
        typewriter.current = initializeTypewriterJs(targetSpan.current, onTypeSequenceComplete);
      }

      const newSequence = getRandomPhrase(shouldClearPreviousContent);
      setIsTypeProgressing(true);
      setSequence(newSequence);
      typewriter.current.playSequence(newSequence);
    },
    [getRandomPhrase]
  );

  const replayRandomSequence = (): void => {
    playRandomSequence(true);
  };

  useEffect(() => {
    setTimeout(() => {
      playRandomSequence(false);
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="typewriter" onClick={isTypeProgressing ? undefined : replayRandomSequence}>
      <span>{"> "}</span>
      <span ref={targetSpan} />
    </div>
  );
};

export default TypeWriter;
