declare interface StaticProps<T> {
  props: T;
}

declare global {
  interface Window {
    DISQUS?: any;
    disqus_config?: any;

    __DEBUG_MODE__?: boolean;

    gameWonConfetti?: () => void;
  }
}

export {};
