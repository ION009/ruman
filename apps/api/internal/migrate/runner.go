package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"anlticsheat/api/internal/storage"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RunClickHouse(ctx context.Context, store *storage.ClickHouseStore, migrationsDir string) error {
	if store == nil {
		return nil
	}
	dir, err := resolveMigrationsDir(migrationsDir)
	if err != nil {
		return err
	}

	files, err := migrationFiles(dir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}

	if err := store.Exec(ctx, `
CREATE TABLE IF NOT EXISTS _migrations
(
    version String,
    applied_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY version`); err != nil {
		return fmt.Errorf("ensure clickhouse migrations table: %w", err)
	}

	applied, err := queryClickHouseApplied(ctx, store)
	if err != nil {
		return err
	}

	if len(applied) == 0 {
		nonMigrationTables, err := store.QueryStrings(ctx, `SELECT name FROM system.tables WHERE database = currentDatabase() AND name != '_migrations' ORDER BY name FORMAT TabSeparatedRaw`)
		if err != nil {
			return fmt.Errorf("detect existing clickhouse schema: %w", err)
		}
		if len(nonMigrationTables) > 0 {
			return bootstrapClickHouseMigrations(ctx, store, files)
		}
	}

	legacyCompatRequired, err := clickHouseLegacyCompatRequired(ctx, store)
	if err != nil {
		return err
	}
	sort.Slice(files, func(i, j int) bool {
		if legacyCompatRequired {
			if files[i] == "011_legacy_compat_columns.sql" && files[j] == "010_materialized_columns.sql" {
				return true
			}
			if files[j] == "011_legacy_compat_columns.sql" && files[i] == "010_materialized_columns.sql" {
				return false
			}
		}
		return files[i] < files[j]
	})

	for _, file := range files {
		if applied[file] {
			continue
		}

		if !clickHouseMigrationApplies(file, legacyCompatRequired) {
			if err := recordClickHouseMigration(ctx, store, file); err != nil {
				return err
			}
			continue
		}

		content, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			return fmt.Errorf("read clickhouse migration %s: %w", file, err)
		}
		for _, statement := range splitSQLStatements(string(content)) {
			if strings.TrimSpace(statement) == "" {
				continue
			}
			if err := store.Exec(ctx, statement); err != nil {
				return fmt.Errorf("apply clickhouse migration %s: %w", file, err)
			}
		}
		if err := recordClickHouseMigration(ctx, store, file); err != nil {
			return err
		}
	}

	return nil
}

func RunNeon(ctx context.Context, pool *pgxpool.Pool, migrationsDir string) error {
	if pool == nil {
		return nil
	}
	dir, err := resolveMigrationsDir(migrationsDir)
	if err != nil {
		return err
	}
	files, err := migrationFiles(dir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}

	if _, err := pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS _migrations
(
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
)`); err != nil {
		return fmt.Errorf("ensure neon migrations table: %w", err)
	}

	applied, err := queryNeonApplied(ctx, pool)
	if err != nil {
		return err
	}

	if len(applied) == 0 {
		var existingTables int
		if err := pool.QueryRow(ctx, `
SELECT count(*)
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename != '_migrations'`).Scan(&existingTables); err != nil {
			return fmt.Errorf("detect existing neon schema: %w", err)
		}
		if existingTables > 0 {
			return bootstrapNeonMigrations(ctx, pool, files)
		}
	}

	for _, file := range files {
		if applied[file] {
			continue
		}

		content, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			return fmt.Errorf("read neon migration %s: %w", file, err)
		}

		tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return fmt.Errorf("begin neon migration %s: %w", file, err)
		}
		if _, err := tx.Exec(ctx, string(content)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply neon migration %s: %w", file, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO _migrations (version, applied_at) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`, file, time.Now().UTC()); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record neon migration %s: %w", file, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit neon migration %s: %w", file, err)
		}
	}
	return nil
}

func resolveMigrationsDir(input string) (string, error) {
	candidates := []string{input}
	if strings.HasPrefix(input, "db/") {
		candidates = append(candidates, filepath.Join("..", "..", input))
	}
	if strings.HasPrefix(input, "../../db/") {
		candidates = append(candidates, strings.TrimPrefix(input, "../../"))
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("migrations directory not found: %s", input)
}

func migrationFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir: %w", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		files = append(files, entry.Name())
	}
	sort.Strings(files)
	return files, nil
}

func queryClickHouseApplied(ctx context.Context, store *storage.ClickHouseStore) (map[string]bool, error) {
	rows, err := store.QueryStrings(ctx, `SELECT version FROM _migrations ORDER BY version FORMAT TabSeparatedRaw`)
	if err != nil {
		return nil, fmt.Errorf("query clickhouse applied migrations: %w", err)
	}
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		out[strings.TrimSpace(row)] = true
	}
	return out, nil
}

func queryNeonApplied(ctx context.Context, pool *pgxpool.Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT version FROM _migrations ORDER BY version`)
	if err != nil {
		return nil, fmt.Errorf("query neon applied migrations: %w", err)
	}
	defer rows.Close()

	out := map[string]bool{}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan neon migration version: %w", err)
		}
		out[strings.TrimSpace(version)] = true
	}
	return out, rows.Err()
}

func bootstrapClickHouseMigrations(ctx context.Context, store *storage.ClickHouseStore, files []string) error {
	for _, file := range files {
		if err := recordClickHouseMigration(ctx, store, file); err != nil {
			return fmt.Errorf("bootstrap clickhouse migration %s: %w", file, err)
		}
	}
	return nil
}

func bootstrapNeonMigrations(ctx context.Context, pool *pgxpool.Pool, files []string) error {
	for _, file := range files {
		if _, err := pool.Exec(ctx, `INSERT INTO _migrations (version, applied_at) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`, file, time.Now().UTC()); err != nil {
			return fmt.Errorf("bootstrap neon migration %s: %w", file, err)
		}
	}
	return nil
}

func recordClickHouseMigration(ctx context.Context, store *storage.ClickHouseStore, version string) error {
	return store.Exec(ctx, fmt.Sprintf(
		"INSERT INTO _migrations (version, applied_at) VALUES (%s, now())",
		quoteClickHouseString(version),
	))
}

func clickHouseLegacyCompatRequired(ctx context.Context, store *storage.ClickHouseStore) (bool, error) {
	columns, err := store.QueryStrings(ctx, `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = 'events' AND name IN ('props', 'meta') ORDER BY name FORMAT TabSeparatedRaw`)
	if err != nil {
		return false, fmt.Errorf("inspect clickhouse events schema: %w", err)
	}
	hasProps := false
	hasMeta := false
	for _, column := range columns {
		switch strings.TrimSpace(column) {
		case "props":
			hasProps = true
		case "meta":
			hasMeta = true
		}
	}
	return hasProps && !hasMeta, nil
}

func clickHouseMigrationApplies(file string, legacyCompatRequired bool) bool {
	switch file {
	case "011_legacy_compat_columns.sql":
		return legacyCompatRequired
	default:
		return true
	}
}

func splitSQLStatements(input string) []string {
	statements := []string{}
	var current strings.Builder
	inSingleQuote := false
	inDoubleQuote := false

	for _, r := range input {
		switch r {
		case '\'':
			if !inDoubleQuote {
				inSingleQuote = !inSingleQuote
			}
		case '"':
			if !inSingleQuote {
				inDoubleQuote = !inDoubleQuote
			}
		case ';':
			if !inSingleQuote && !inDoubleQuote {
				statement := strings.TrimSpace(current.String())
				if statement != "" {
					statements = append(statements, statement)
				}
				current.Reset()
				continue
			}
		}
		current.WriteRune(r)
	}

	if tail := strings.TrimSpace(current.String()); tail != "" {
		statements = append(statements, tail)
	}
	return statements
}

func quoteClickHouseString(value string) string {
	escaped := strings.ReplaceAll(value, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "'", "\\'")
	return "'" + escaped + "'"
}
