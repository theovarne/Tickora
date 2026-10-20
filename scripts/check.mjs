#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set([
  'vendor', 'node_modules', 'dist', 'build', 'out', 'coverage', 'generated',
  '.git', '.vercel', '.next', '.nuxt', '.cache', 'work',
]);
const javascriptExtension = /\.(?:[cm]?js)$/i;
const assetExtension = /\.(?:html?|css|[cm]?js|json|webmanifest|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|pdf)$/i;
const errors = [];
const references = { modules: 0, assets: 0, package: 0 };
const assetFiles = new Set();
const moduleFiles = new Set();
const moduleQueue = [];
const display = file => path.relative(root, file).split(path.sep).join('/') || '.';

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Tickora check requires Node.js 22 or newer.');
  process.exit(1);
}

function walk(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name) && !entry.name.startsWith('.')) walk(file, result);
    } else if (entry.isFile()) result.push(file);
  }
  return result;
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) { errors.push(`${display(file)}: ${error.message}`); return null; }
}

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith('&#x') ? parseInt(key.slice(3, -1), 16) : Number(key.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function localPath(reference, owner, category, { module = false, directoryIndex = false, allowDirectory = false } = {}) {
  const value = decodeEntities(String(reference)).trim();
  if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  // Bare ESM imports refer to packages, while local browser modules must have
  // a relative or root-relative specifier. Node built-ins are schemes above.
  if (module && !value.startsWith('.') && !value.startsWith('/')) return null;
  let pathname;
  try { pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]); }
  catch { errors.push(`${display(owner)}: invalid URL encoding in ${value}`); return null; }
  if (!pathname) return null;
  references[category]++;
  let destination = pathname.startsWith('/')
    ? path.resolve(root, `.${pathname}`)
    : path.resolve(path.dirname(owner), pathname);
  const relative = path.relative(root, destination);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    errors.push(`${display(owner)}: local reference leaves the source root: ${value}`);
    return null;
  }
  try {
    if (directoryIndex && fs.statSync(destination).isDirectory()) destination = path.join(destination, 'index.html');
    const stat = fs.statSync(destination);
    if (!stat.isFile() && !(allowDirectory && stat.isDirectory())) throw new Error('not a file');
  } catch {
    errors.push(`${display(owner)}: missing local ${category === 'modules' ? 'module' : 'file'} ${value}`);
    return null;
  }
  if (category === 'assets') assetFiles.add(destination);
  return destination;
}

// Keep quoted content intact while removing comments, so documentation imports
// and commented-out code do not become dependencies. No code is executed.
function withoutJSComments(source) {
  return source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    token => token.startsWith('//') || token.startsWith('/*') ? token.replace(/[^\r\n]/g, ' ') : token);
}

function importsIn(source) {
  const clean = withoutJSComments(source);
  const patterns = [
    /\bimport\s*(?!\s*\()(?:(?:[\w$*\s,{}]+?)\s*from\s*)?(['"])([^'"\r\n]+)\1/g,
    /\bexport\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\r\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*(?:,|\))/g,
  ];
  return patterns.flatMap(pattern => [...clean.matchAll(pattern)].map(match => match[2]));
}

function checkJSAssets(file, source) {
  const clean = withoutJSComments(source);
  const checkedLiterals = new Set();
  for (const match of clean.matchAll(/\bnew\s+URL\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*,\s*import\s*\.\s*meta\s*\.\s*url\s*\)/g)) {
    if (match[2].includes('${') || match[2].split(/[?#]/, 1)[0].endsWith('/')) continue;
    checkedLiterals.add(match.index + match[0].indexOf(match[1]));
    localPath(match[2], file, 'assets');
  }
  for (const match of clean.matchAll(/(['"`])((?:\.{1,2}\/)+assets\/[^'"`\r\n]+)\1/g)) {
    if (checkedLiterals.has(match.index) || match[2].includes('${') || match[2].split(/[?#]/, 1)[0].endsWith('/')) continue;
    localPath(match[2], file, 'assets');
  }
}

function queueModule(file) {
  if (!javascriptExtension.test(file) || moduleFiles.has(file)) return;
  moduleFiles.add(file);
  moduleQueue.push(file);
}

function attributes(text) {
  const values = new Map();
  for (const match of text.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    values.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
  }
  return values;
}

function checkHTML(file, source) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if ((attributes(match[1]).get('type') || '').toLowerCase() !== 'importmap') continue;
    let importMap;
    try { importMap = JSON.parse(match[2]); }
    catch (error) { errors.push(`${display(file)}: invalid inline importmap JSON (${error.message})`); continue; }
    const maps = [importMap?.imports, ...Object.values(importMap?.scopes || {})];
    for (const map of maps) {
      if (!map || typeof map !== 'object') continue;
      for (const [alias, reference] of Object.entries(map)) {
        if (typeof reference !== 'string') continue;
        if (alias.endsWith('/') && !reference.endsWith('/')) {
          errors.push(`${display(file)}: importmap prefix ${alias} must target a directory ending in /`);
          continue;
        }
        const linked = localPath(reference, file, 'modules', {
          module: true, allowDirectory: alias.endsWith('/') && reference.endsWith('/'),
        });
        if (linked) queueModule(linked);
      }
    }
  }
  for (const match of clean.matchAll(/<([a-z][\w:-]*)\b([^<>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);
    if (attrs.has('src')) {
      const linked = localPath(attrs.get('src'), file, 'assets', { directoryIndex: tag === 'iframe' });
      if (linked && tag === 'script') queueModule(linked);
    }
    if (attrs.has('poster')) localPath(attrs.get('poster'), file, 'assets');
    if (!attrs.has('href') || /(?:^|\s)canonical(?:\s|$)/i.test(attrs.get('rel') || '')) continue;
    const reference = attrs.get('href');
    const pathname = decodeEntities(reference).split(/[?#]/, 1)[0];
    // Navigation routes are application state, not necessarily disk files.
    // The site home and source-like links are still checked.
    if (tag === 'link' || assetExtension.test(pathname) || /^(?:\.?\.?\/)+$/.test(pathname)) {
      localPath(reference, file, 'assets', { directoryIndex: true });
    }
  }
}

function checkCSS(file, source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    const reference = (match[1] ?? match[2] ?? match[3]).replace(/\\([ ()'"\\])/g, '$1');
    localPath(reference, file, 'assets');
  }
  for (const match of clean.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) localPath(match[2], file, 'assets');
}

function parseJSON(file) {
  const source = read(file);
  if (source === null) return null;
  try { return JSON.parse(source); }
  catch (error) { errors.push(`${display(file)}: invalid JSON (${error.message})`); return null; }
}

function checkManifest(file) {
  const manifest = parseJSON(file);
  if (!manifest) return;
  if (!Array.isArray(manifest.icons)) {
    errors.push(`${display(file)}: icons must be an array`);
    return;
  }
  for (const icon of manifest.icons || []) {
    if (!icon || typeof icon.src !== 'string' || !icon.src.trim()) errors.push(`${display(file)}: icon is missing its src`);
    else localPath(icon.src, file, 'assets');
  }
}

function checkPackage() {
  const file = path.join(root, 'package.json');
  const pkg = parseJSON(file);
  if (!pkg) return;
  if (typeof pkg !== 'object' || Array.isArray(pkg)) {
    errors.push('package.json: package metadata must be an object');
    return;
  }
  for (const key of ['main', 'module', 'types', 'typings']) {
    if (typeof pkg[key] === 'string') localPath(pkg[key], file, 'package');
  }
  function packageTargets(value) {
    if (typeof value === 'string') {
      if (!/[*?{}[\]]/.test(value) && (value.startsWith('./') || value.startsWith('/'))) localPath(value, file, 'package');
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) packageTargets(child);
    }
  }
  for (const key of ['exports', 'imports', 'browser']) packageTargets(pkg[key]);
  for (const reference of typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {})) {
    if (typeof reference === 'string') localPath(reference, file, 'package');
  }
  for (const [name, command] of Object.entries(pkg.scripts || {})) {
    if (typeof command !== 'string') { errors.push(`package.json: script ${name} must be a string`); continue; }
    // Validate literal Node entry files, without invoking npm scripts or shell
    // commands. Globs and inline --eval expressions are not file references.
    for (const segment of command.split(/&&|\|\||;/)) {
      const words = [...segment.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map(match => match[1] ?? match[2] ?? match[3]);
      const nodeIndex = words.findIndex(word => /(?:^|[/\\])node(?:\.exe)?$/.test(word));
      if (nodeIndex < 0 || words.slice(nodeIndex + 1).some(word => ['-e', '--eval', '-p', '--print'].includes(word))) continue;
      for (const word of words.slice(nodeIndex + 1)) {
        if (javascriptExtension.test(word) && !word.startsWith('-') && !/[*?{}[\]]/.test(word)) localPath(word, file, 'package');
      }
    }
  }
}

const files = walk(root).sort();
const sourceJS = files.filter(file => javascriptExtension.test(file));
for (const file of sourceJS) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    errors.push(`${display(file)}: JavaScript syntax check failed\n${(result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim()}`);
  }
  queueModule(file);
  const source = read(file);
  if (source !== null) checkJSAssets(file, source);
}
for (const file of files) {
  if (/\.html?$/i.test(file)) { const source = read(file); if (source !== null) checkHTML(file, source); }
  else if (/\.css$/i.test(file)) { const source = read(file); if (source !== null) checkCSS(file, source); }
  else if (/\.webmanifest$/i.test(file)) checkManifest(file);
}
// Follow the complete local import graph, including referenced vendored files,
// while keeping third-party syntax checks outside the authored-source count.
for (let index = 0; index < moduleQueue.length; index++) {
  const file = moduleQueue[index];
  const source = read(file);
  if (source === null) continue;
  for (const reference of importsIn(source)) {
    const linked = localPath(reference, file, 'modules', { module: true });
    if (linked) queueModule(linked);
  }
}
checkPackage();

const counts = `${sourceJS.length} source JS files; ${moduleFiles.size} modules in the local import closure; ${references.modules} local module references; ${references.assets} asset references (${assetFiles.size} distinct local files); ${references.package} package file references`;
if (errors.length) {
  console.error(`Tickora check failed: ${errors.length} problem${errors.length === 1 ? '' : 's'}.`);
  for (const error of errors) console.error(`\n- ${error}`);
  console.error(`\nChecked ${counts}.`);
  process.exitCode = 1;
} else {
  console.log(`Tickora check passed: ${counts}.`);
}
