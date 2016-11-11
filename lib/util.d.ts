/// <reference types="node" />
/// <reference types="progress" />
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
import * as fs from 'fs';
import * as ProgressBar from 'progress';
/**
 * Synchronously determines whether the given file exists.
 */
export declare function existsSync(fn: string): boolean;
/**
 * Synchronously determines whether the given file exists.
 */
export declare function isDirSync(fn: string): boolean;
/**
 * Synchronously determines whether the given file exists.
 */
export declare function safeStatSync(fn: string): fs.Stats;
/**
 * Like Promise.all, but also displays a progress bar that fills as the
 * promises resolve. The label is a helpful string describing the operation
 * that the user is waiting on.
 */
export declare function promiseAllWithProgress<T>(promises: Promise<T>[], label: string): Promise<T[]>;
export declare function standardProgressBar(label: string, total: number): ProgressBar;
