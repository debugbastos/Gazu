// Declarações simplificadas de React SOMENTE para verificação de tipos neste ambiente sem @types/react.
declare module 'react' {
  export type ReactNode = string | number | boolean | null | undefined | ReactElement | Iterable<ReactNode>;
  export interface ReactElement { type: unknown; props: unknown; key: string | null }
  export type Key = string | number | bigint;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(cb: T, deps: readonly unknown[]): T;
  export interface MutableRefObject<T> { current: T }
  export interface RefObject<T> { current: T }
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useId(): string;
  export interface Context<T> { Provider: (p: { value: T; children?: ReactNode }) => ReactElement }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export function useReducer<S, A>(r: (s: S, a: A) => S, i: S): [S, Dispatch<A>];
  export const StrictMode: (p: { children?: ReactNode }) => ReactElement;
  export const Fragment: unknown;
  export interface SyntheticEvent<T = Element> { currentTarget: T; target: EventTarget & T; preventDefault(): void; stopPropagation(): void; defaultPrevented: boolean }
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> { target: EventTarget & T }
  export interface MouseEvent<T = Element> extends SyntheticEvent<T> { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; clientX: number; clientY: number }
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
  export interface TouchEvent<T = Element> extends SyntheticEvent<T> { touches: TouchList; changedTouches: TouchList }
  export interface PointerEvent<T = Element> extends MouseEvent<T> { pointerId: number }
  export interface DragEvent<T = Element> extends MouseEvent<T> { dataTransfer: DataTransfer }
  export interface CSSProperties { [k: string]: string | number | undefined }
  export interface HTMLAttributes<T> { className?: string; id?: string; style?: CSSProperties; title?: string; role?: string; tabIndex?: number; hidden?: boolean; children?: ReactNode;
    onClick?: (e: MouseEvent<T>) => void; onKeyDown?: (e: KeyboardEvent<T>) => void; onFocus?: (e: SyntheticEvent<T>) => void; onMouseEnter?: (e: MouseEvent<T>) => void; onMouseLeave?: (e: MouseEvent<T>) => void;
    [aria: `aria-${string}`]: unknown; [data: `data-${string}`]: unknown; }
  export interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> { href?: string; target?: string; rel?: string; download?: unknown }
  export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> { type?: 'button' | 'submit' | 'reset'; disabled?: boolean; name?: string; value?: string }
  export interface InputHTMLAttributes<T> extends HTMLAttributes<T> { type?: string; value?: string | number | readonly string[]; defaultValue?: string | number; checked?: boolean; disabled?: boolean; placeholder?: string; required?: boolean; name?: string;
    autoComplete?: string; inputMode?: string; maxLength?: number; min?: number | string; max?: number | string; step?: number | string; readOnly?: boolean; accept?: string; multiple?: boolean; pattern?: string;
    onChange?: (e: ChangeEvent<T>) => void; onBlur?: (e: SyntheticEvent<T>) => void; autoFocus?: boolean; list?: string }
  export interface SelectHTMLAttributes<T> extends HTMLAttributes<T> { value?: string | number; disabled?: boolean; required?: boolean; name?: string; onChange?: (e: ChangeEvent<T>) => void; multiple?: boolean }
  export interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> { value?: string; rows?: number; disabled?: boolean; required?: boolean; maxLength?: number; placeholder?: string; readOnly?: boolean; onChange?: (e: ChangeEvent<T>) => void; name?: string }
  export type ComponentProps<T> = T extends (p: infer P) => unknown ? P : never;
  export type FC<P = {}> = (p: P) => ReactElement | null;
  export function lazy<T>(f: () => Promise<{ default: T }>): T;
  export const Suspense: (p: { fallback?: ReactNode; children?: ReactNode }) => ReactElement;
  const React: { StrictMode: typeof StrictMode };
  export default React;
}
declare module 'react/jsx-runtime' { export const jsx: unknown; export const jsxs: unknown; export const Fragment: unknown; }
declare module 'react-dom/client' { export function createRoot(el: Element): { render(n: unknown): void }; export function hydrateRoot(el: Element, n: unknown): void; }
declare namespace JSX {
  interface Element { type: unknown; props: unknown; key: string | null }
  interface IntrinsicAttributes { key?: string | number | null }
  interface IntrinsicElements { [el: string]: any }
  interface ElementChildrenAttribute { children: {} }
}
