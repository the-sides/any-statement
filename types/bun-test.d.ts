declare module "bun:test" {
  type TestFn = () => void | Promise<void>;

  export function describe(name: string, fn: TestFn): void;
  export function test(name: string, fn: TestFn): void;
  export function expect<T>(value: T): {
    toBe(expected: T): void;
  };
}
