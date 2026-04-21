import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface AppEnv {
  Variables: {
    db?: NodePgDatabase;
    params?: Record<string, string>;
    appName?: string;
    version?: string;
  };
}

export interface Route {
  pattern: string;
  file: string;
  params: string[];
}

export type RouteModule = {
  default: (c: any) => unknown | Promise<unknown>;
};



export interface Manifest {
  routes: Route[];
}

export type ManifestFetcher = (appName: string, version: string) => Promise<Manifest>;
export type ModuleFetcher = (appName: string, version: string, filePath: string) => Promise<string>;

export interface AppConfig {
  port?: number;
  databaseUrl?: string;
  fetchManifest: ManifestFetcher;
  fetchModule: ModuleFetcher;
}