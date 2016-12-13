import {ChildProcess} from 'child_process';

declare module 'npm-run' {
  interface Options {
    cwd?: string;
    env?: Object;
    argv0?: string;
    stdio?: Array|string;
    detached?: boolean;
    uid?: number;
    gid?: number;
    shell?: boolean|string;
  }
  namespace npmRun {
    function spawn(command: string, args: string[], options: Options):
        ChildProcess;
  }
  export = npmRun;
}
