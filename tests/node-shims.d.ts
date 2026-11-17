declare namespace NodeJS {
  type ProcessEnv = Record<string, string | undefined>;
  type Signals = string;
}

declare const process: {
  execPath: string;
  env: Record<string, string | undefined>;
  stdout: {
    write(chunk: string): void;
  };
};

declare const Buffer: {
  from(input: string, encoding?: string): any;
};

declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:child_process" {
  export function spawn(
    command: string,
    args?: readonly string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdio?: readonly ["ignore", "pipe", "pipe"] | string;
    },
  ): any;
}

declare module "node:events" {
  export function once(emitter: any, event: string): Promise<any[]>;
}
