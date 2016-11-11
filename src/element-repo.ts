/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
'use strict';

import * as github from 'github';
import {Analyzer} from 'hydrolysis';
import * as nodegit from 'nodegit';

export class ElementRepo {
  constructor(args: {
    dir: string,
    ghRepo: github.Repo,
    repo: nodegit.Repository,
    analyzer: Analyzer
  }) {
    this.dir = args.dir;
    this.ghRepo = args.ghRepo;
    this.repo = args.repo;
    this.analyzer = args.analyzer;
  }

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
  dirty: boolean = false;

  pushStatus: PushStatus = PushStatus.unpushed;
}

export enum PushStatus {
  /**
   * We haven't yet tried to push the element
   */
  unpushed,
  /**
   * We tried and succeded!
   */
  succeeded,
  /**
   * We tried and failed!
   */
  failed,
  /**
   * We tried but were denied locally. i.e. because max_changes wasn't large
   * enough and we'd already used up all of our pushes this run.
   */
  denied
}
