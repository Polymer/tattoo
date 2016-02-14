declare module "bottleneck" {

  interface PromiseProducer<T> {
    (...args: any[]): Promise<T>;
  }

  class Bottleneck {
    constructor(maxConcurrent: number, minDelay: number);
    schedule<T>(promise: PromiseProducer<T>): Promise<T>;
    schedule<T>(promise: PromiseProducer<T>, A1: any): Promise<T>;
    schedule<T>(promise: PromiseProducer<T>, A1: any, A2: any): Promise<T>;
    schedule<T>(promise: PromiseProducer<T>, A1: any, A2: any, A3: any): Promise<T>;
  }
  namespace Bottleneck {

  }
  export = Bottleneck;
}
