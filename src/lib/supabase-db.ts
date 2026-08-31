import { Client, types } from 'pg';

export type DatabaseValue = string | number | boolean | null;

export type DatabaseResult<T> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
    last_row_id: number;
  };
};

export interface PreparedStatement {
  bind(...values: DatabaseValue[]): PreparedStatement;
  all<T>(): Promise<DatabaseResult<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<DatabaseResult<Record<string, unknown>>>;
}

export interface Database {
  prepare(query: string): PreparedStatement;
}

export type PostgresDatabaseConfig = {
  connectionString?: string;
};

type QueryMode = 'all' | 'first' | 'run';

types.setTypeParser(20, (value) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(1082, (value) => value);

function postgresQuery(query: string, valueCount: number): string {
  let result = '';
  let placeholder = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    const next = query[index + 1];
    if (character === "'" && !inDoubleQuote) {
      result += character;
      if (inSingleQuote && next === "'") {
        result += next;
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (character === '"' && !inSingleQuote) {
      result += character;
      if (inDoubleQuote && next === '"') {
        result += next;
        index += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }
    if (character === '?' && !inSingleQuote && !inDoubleQuote) {
      placeholder += 1;
      result += `$${placeholder}`;
      continue;
    }
    result += character;
  }

  if (placeholder !== valueCount) {
    throw new Error(`SQL placeholder count mismatch: expected ${placeholder}, received ${valueCount}`);
  }
  return result;
}

function returningQuery(query: string): string {
  const trimmed = query.trim().replace(/;$/, '');
  if (!/^\s*(insert|update|delete)\b/i.test(trimmed) || /\breturning\b/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} RETURNING *`;
}

class PostgresPreparedStatement implements PreparedStatement {
  private values: DatabaseValue[] = [];

  constructor(
    private readonly config: PostgresDatabaseConfig,
    private readonly query: string,
  ) {}

  bind(...values: DatabaseValue[]): PreparedStatement {
    const statement = new PostgresPreparedStatement(this.config, this.query);
    statement.values = values;
    return statement;
  }

  private async execute(mode: QueryMode): Promise<{ rows: Record<string, unknown>[]; changes: number }> {
    const connectionString = this.config.connectionString?.trim();
    if (!connectionString) throw new Error('PostgreSQL database configuration is missing');

    const client = new Client({ connectionString });
    try {
      await client.connect();
      const query = postgresQuery(mode === 'run' ? returningQuery(this.query) : this.query, this.values.length);
      const result = await client.query<Record<string, unknown>>(query, this.values);
      return { rows: result.rows, changes: result.rowCount ?? 0 };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async all<T>(): Promise<DatabaseResult<T>> {
    const payload = await this.execute('all');
    const results = payload.rows as T[];
    return {
      results,
      success: true,
      meta: { changes: payload.changes, last_row_id: 0 },
    };
  }

  async first<T>(): Promise<T | null> {
    const payload = await this.execute('first');
    return (payload.rows[0] as T | undefined) ?? null;
  }

  async run(): Promise<DatabaseResult<Record<string, unknown>>> {
    const payload = await this.execute('run');
    const results = payload.rows;
    const first = results[0];
    const lastRowId = typeof first?.id === 'number'
      ? first.id
      : typeof first?.wedding_id === 'number'
        ? first.wedding_id
        : 0;
    return {
      results,
      success: true,
      meta: { changes: payload.changes, last_row_id: lastRowId },
    };
  }
}

export function createPostgresDatabase(config: PostgresDatabaseConfig): Database {
  return {
    prepare(query: string) {
      return new PostgresPreparedStatement(config, query);
    },
  };
}
