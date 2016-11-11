import { ElementRepo } from './element-repo';
export interface TestResult {
    result: TestResultValue;
    output: string;
    elementRepo: ElementRepo;
}
export declare enum TestResultValue {
    passed = 0,
    failed = 1,
    skipped = 2,
}
