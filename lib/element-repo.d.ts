import * as github from 'github';
import { Analyzer } from 'hydrolysis';
import * as nodegit from 'nodegit';
export declare class ElementRepo {
    constructor(args: {
        dir: string;
        ghRepo: github.Repo;
        repo: nodegit.Repository;
        analyzer: Analyzer;
    });
    /**
     * A relative path like 'repos/paper-input' that's points to a
     * directory that contains a pristine checkout of the element as it
     * exists at master.
     */
    dir: string;
    /**
     * Metadata about the elements' github repo.
     */
    ghRepo: github.Repo;
    /**
     * The git repo to commit to.
     */
    repo: nodegit.Repository;
    /**
     * A hydrolysis Analyzer for *all* elements in the PolymerElements
     * org and their dependencies.
     */
    analyzer: Analyzer;
    /**
     * If true, commits made to the repo will be pushed.
     */
    dirty: boolean;
    pushStatus: PushStatus;
}
export declare enum PushStatus {
    /**
     * We haven't yet tried to push the element
     */
    unpushed = 0,
    /**
     * We tried and succeded!
     */
    succeeded = 1,
    /**
     * We tried and failed!
     */
    failed = 2,
    /**
     * We tried but were denied locally. i.e. because max_changes wasn't large
     * enough and we'd already used up all of our pushes this run.
     */
    denied = 3,
}
