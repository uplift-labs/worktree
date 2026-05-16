declare module "@opentui/solid/jsx-runtime" {
  export namespace JSX {
    interface IntrinsicElements {
      [name: string]: any
    }
  }
  export const jsx: any
  export const jsxs: any
  export const Fragment: any
}

declare namespace JSX {
  interface IntrinsicElements {
    [name: string]: any
  }
}
