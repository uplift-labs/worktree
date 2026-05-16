declare module "solid-js" {
  export function createSignal<T>(value: T): [() => T, (value: T | ((previous: T) => T)) => void]
  export function onCleanup(fn: () => void): void
  export const For: any
  export const Show: any
}
