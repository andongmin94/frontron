export type StoreMigration<T> = (value: unknown) => T;
export type StoreValidator<T> = (value: unknown) => T;

export interface StoreOptions<T> {
  filePath: string;
  defaults: T;
  version: number;
  migrations?: Record<number, StoreMigration<T>>;
  validate?: StoreValidator<T>;
}

export interface FrontronStore<T> {
  readonly filePath: string;
  get(): T;
  set(value: T): void;
  patch(value: Partial<T>): void;
  reset(): void;
}
