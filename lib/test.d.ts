import { ElementRepo } from './element-repo';
import { TestResult } from './test-result';
export declare function test(element: ElementRepo, flags: string[]): Promise<TestResult>;
