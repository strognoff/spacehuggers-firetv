#!/usr/bin/env node
// scripts/parse-www.js
//
// Parse-check every .js file under www/ using `node --check` and exit non-zero
// if any file has a syntax error. Designed to be a build-time guard so a
// half-written edit in a source file (or a botched sync) can't ship to the
// APK and crash the WebView at startup.
//
// Walks www/ recursively, so engine/, app.js, appLevel.js, etc. are all
// covered. Ignores node_modules and non-.js files.
//
// Usage:
//   node scripts/parse-www.js
//
// Exits 0 on success, 1 on any parse failure (with the failing path printed).

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const WWW_DIR = join(REPO_ROOT, 'www');

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            out.push(...walk(full));
        } else if (entry.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

const files = walk(WWW_DIR);
if (files.length === 0) {
    console.error('No .js files found under www/. Did you run sync:source?');
    process.exit(1);
}

let failed = 0;
for (const f of files) {
    try {
        // --check parses without executing. stderr is captured to suppress
        // node's version banner on success; we only print on failure.
        execFileSync('node', ['--check', f], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        failed++;
        const rel = relative(REPO_ROOT, f);
        console.error(`PARSE FAIL: ${rel}`);
        // node --check writes the error to stderr; surface it for diagnosis.
        if (e.stderr) process.stderr.write(e.stderr);
    }
}

if (failed > 0) {
    console.error(`\n${failed} file(s) failed to parse.`);
    process.exit(1);
}
console.log(`OK: ${files.length} .js file(s) in www/ parse cleanly`);
