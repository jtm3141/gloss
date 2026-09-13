// Minimal sql.js type shim — enough for how we use it.
declare module "sql.js" {
  export interface QueryResult {
    columns: string[];
    values: unknown[][];
  }
  export interface Database {
    exec(sql: string): QueryResult[];
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
