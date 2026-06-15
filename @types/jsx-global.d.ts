// React 19 dropped the global JSX namespace and moved everything under
// React.JSX. Several upstream typings we depend on (e.g. hast-util-to-jsx-runtime,
// rehype-react) still reference bare `JSX.Element` / `JSX.IntrinsicElements`,
// which TS resolves as the now-empty global namespace and causes spurious
// "Plugin" assignability failures across the unified pipeline.
//
// Re-export React's JSX namespace into the global scope so those library
// typings keep working without us forking them.
import type * as React from "react";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = React.JSX.Element;
    type ElementClass = React.JSX.ElementClass;
    type ElementType = React.JSX.ElementType;
    type IntrinsicElements = React.JSX.IntrinsicElements;
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty;
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>;
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
  }
}

export {};
