interface MigrateOptions {
    projectDir?: string;
    dryRun?: boolean;
    force?: boolean;
}
interface MigrateResult {
    projectDir: string;
    dryRun: boolean;
    backupDir: string | null;
    writtenFiles: string[];
    removedFiles: string[];
    dependencyUpdated: boolean;
}
declare function migrateProject(options?: MigrateOptions): MigrateResult;

export { migrateProject };
export type { MigrateOptions, MigrateResult };
