declare module 'command-line-args' {
  function commandLineArgs(args: commandLineArgs.ArgDescriptor[]):
      commandLineArgs.CLI;

  namespace commandLineArgs {
    interface ArgDescriptor {
      name: string;
      // type: Object;
      alias?: string;
      description: string;
      defaultValue?: any;
      type: (val: string) => any;
      multiple?: boolean;
    }
    interface UsageOpts {
      title: string;
      header?: string;
      description?: string;
    }
    interface CLI {
      parse(): any;
      getUsage(opts: UsageOpts): string;
    }
  }

  export = commandLineArgs;
}
