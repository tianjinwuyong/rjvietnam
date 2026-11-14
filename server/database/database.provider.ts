import { Provider } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DRIZZLE_DATABASE = 'DRIZZLE_DATABASE';
export type PostgresJsDatabase = ReturnType<typeof drizzle<typeof schema>>;

export const databaseProvider: Provider = {
  provide: DRIZZLE_DATABASE,
  useFactory: () => {
    const connectionString =
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'wms'}`;

    const queryClient = postgres(connectionString, { max: 10 });
    const db = drizzle(queryClient, { schema });
    return db;
  },
};
