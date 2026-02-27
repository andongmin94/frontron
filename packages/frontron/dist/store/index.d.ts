type StoreMigration<T> = (value: unknown) => T;
type StoreValidator<T> = (value: unknown) => T;
interface StoreOptions<T> {
    filePath: string;
    defaults: T;
    version: number;
    migrations?: Record<number, StoreMigration<T>>;
    validate?: StoreValidator<T>;
}
interface FrontronStore<T> {
    readonly filePath: string;
    get(): T;
    set(value: T): void;
    patch(value: Partial<T>): void;
    reset(): void;
}

declare function createStore<T>(options: StoreOptions<T>): FrontronStore<T>;

export { createStore };
export type { FrontronStore, StoreMigration, StoreOptions, StoreValidator };
