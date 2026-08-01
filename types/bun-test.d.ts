declare module "bun:test" {
  type TestFn = () => void | Promise<void>;

  type Matchers<T> = {
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toContain(expected: unknown): void;
  };

  export function describe(name: string, fn: TestFn): void;
  export function test(name: string, fn: TestFn): void;
  export function expect<T>(value: T): Matchers<T> & {
    not: Matchers<T>;
  };
}
