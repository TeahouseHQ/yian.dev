declare interface StaticProps<T> {
  props: T;
}

declare global {
  interface Window {
    DISQUS?: any;
    disqus_config?: any;

    __DEBUG_MODE__?: boolean;

    confetti: {
      (options?: {
        particleCount?: number;
        spread?: number;
        origin?: { y: number };
        [key: string]: any;
      }): void;
    };

    gameWonConfetti?: () => void;
  }
}

export {};
