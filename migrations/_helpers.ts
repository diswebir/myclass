/** Helper برای migrationها — self-contained (بدون import از src؛ per tsconfig.migrations rootDir). */
export type MigrateCtx = { dialect: 'mysql' | 'sqlite' };

/** نوع ستون id (auto-increment) per dialect */
export function idType(ctx: MigrateCtx): 'integer' | 'bigint' {
  return ctx.dialect === 'sqlite' ? 'integer' : 'bigint';
}
