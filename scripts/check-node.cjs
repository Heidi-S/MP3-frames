/*
 * Node version guard.
 *
 * Written in ES5 CommonJS on purpose: it has to run and print a useful message
 * on the very old Node versions it is meant to catch, so it must not use any
 * syntax those versions would fail to parse.
 */

'use strict';

var REQUIRED_MAJOR = 20;

var current = process.versions.node;
var major = parseInt(current.split('.')[0], 10);

if (isNaN(major) || major < REQUIRED_MAJOR) {
  console.error('');
  console.error('  This project requires Node.js ' + REQUIRED_MAJOR + ' or newer.');
  console.error('  You are running Node.js ' + current + '.');
  console.error('');
  console.error('  The dev/test tooling (tsx, vitest) requires Node 18+, and the');
  console.error('  source uses modern JavaScript that older versions cannot parse.');
  console.error('');
  console.error('  Fix it with nvm:');
  console.error('');
  console.error('      nvm install 20 && nvm use 20');
  console.error('      node -v        # should print v20.x or newer');
  console.error('      rm -rf node_modules package-lock.json && npm install');
  console.error('');
  process.exit(1);
}
