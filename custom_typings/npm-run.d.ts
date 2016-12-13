declare module 'npm-run' {
  import {ChildProcess} from 'child_process';
  interface Options {
    cwd?: string;
    env?: Object;
    argv0?: string;
    stdio?: string[]|string;
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
