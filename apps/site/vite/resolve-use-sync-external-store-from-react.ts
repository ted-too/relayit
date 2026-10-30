import type { Plugin } from "vite";

/**
 * See ADR-0008 — temporary until Nitro `experimental.cjsRequireRewrite` (or
 * equivalent) lands: https://github.com/nitrojs/nitro/pull/4365
 */
export function resolveUseSyncExternalStoreFromReact(): Plugin {
  const shim = "\0base-ui-use-sync-external-store/shim";
  const withSelector = "\0base-ui-use-sync-external-store/shim/with-selector";

  return {
    name: "resolve-use-sync-external-store-from-react",
    enforce: "pre",
    resolveId(id) {
      if (
        id === "use-sync-external-store/shim" ||
        id === "use-sync-external-store/shim/index.js"
      ) {
        return shim;
      }
      if (
        id === "use-sync-external-store/shim/with-selector" ||
        id === "use-sync-external-store/shim/with-selector.js"
      ) {
        return withSelector;
      }
    },
    load(id) {
      if (id === shim) {
        return 'export { useSyncExternalStore } from "react";\n';
      }
      if (id === withSelector) {
        // Same contract as use-sync-external-store/shim/with-selector, but
        // wired to the app React module graph (no CJS require("react")).
        return `
import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

const objectIs =
  typeof Object.is === "function"
    ? Object.is
    : (x, y) =>
        (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y);

export function useSyncExternalStoreWithSelector(
  subscribe,
  getSnapshot,
  getServerSnapshot,
  selector,
  isEqual,
) {
  const instRef = useRef(null);
  if (instRef.current === null) {
    instRef.current = { hasValue: false, value: null };
  }
  const inst = instRef.current;

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot;
    let memoizedSelection;
    const memoizedSelector = (nextSnapshot) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }
      const currentSelection = memoizedSelection;
      if (objectIs(memoizedSnapshot, nextSnapshot)) {
        return currentSelection;
      }
      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(currentSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return currentSelection;
      }
      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
    return [
      () => memoizedSelector(getSnapshot()),
      getServerSnapshot === undefined
        ? undefined
        : () => memoizedSelector(getServerSnapshot()),
    ];
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection,
  );
  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [value]);
  useDebugValue(value);
  return value;
}
`;
      }
    },
  };
}
