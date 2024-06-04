declare interface StaticProps<T> {
  props: T;
}

declare global {
  interface Window {
    DISQUS?: any;
    disqus_config?: any;
  }
}

export {};
