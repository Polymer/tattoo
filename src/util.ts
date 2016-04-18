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
import * as fs from "fs";

/**
 * Synchronously determines whether the given file exists.
 */
export function existsSync(fn: string): boolean {
  return safeStatSync(fn) != null;
}

/**
 * Synchronously determines whether the given file exists.
 */
export function isDirSync(fn: string): boolean {
  const stats = safeStatSync(fn);
  if (stats == null) return false;
  return stats.isDirectory();
}

/**
 * Synchronously determines whether the given file exists.
 */
export function safeStatSync(fn: string): fs.Stats {
  try {
    return fs.statSync(fn);
  } catch (_) {
    return null;
  }
}
