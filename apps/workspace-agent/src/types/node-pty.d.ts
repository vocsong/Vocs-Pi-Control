/**
 * Ambient types for node-pty (loaded dynamically; the package itself is
 * installed only inside the container image — never on the host, where it
 * would need a C toolchain).
 */
declare module "node-pty" {
  export interface IPty {
    on(event: string, callback: (...args: never[]) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    readonly process: string;
    readonly pid: number;
  }

  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  }

  export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
  export function open(options?: IPtyForkOptions): IPty;
}
