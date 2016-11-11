import * as nodegit from 'nodegit';
export declare function checkoutLatestRelease(repo: nodegit.Repository, dir?: string): Promise<nodegit.Repository>;
