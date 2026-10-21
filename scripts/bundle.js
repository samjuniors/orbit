// Tiny dependency-free bundler: turns bin/orbit.js and the relative modules it requires into ONE
// CommonJS file (needed for a Node single-executable app). Handles .js and .json requires with
// literal relative paths, which is all this codebase uses; anything else fails the build loudly.
const fs = require('node:fs');
const path = require('node:path');

function bundle(entry, root) {
  const mods = new Map();
  const resolveFile = (fromDir, spec) => {
    const base = path.resolve(fromDir, spec);
    for (const c of [base, base + '.js', base + '.json', path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    throw new Error(`bundle: cannot resolve "${spec}" from ${fromDir}`);
  };
  const visit = file => {
    if (mods.has(file)) return;
    const src = fs.readFileSync(file, 'utf8');
    mods.set(file, src);
    if (file.endsWith('.json')) return;
    for (const m of src.matchAll(/\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) visit(resolveFile(path.dirname(file), m[2]));
  };
  const entryAbs = path.resolve(entry);
  visit(entryAbs);
  const id = f => path.relative(root, f).split(path.sep).join('/');
  const defs = [...mods].map(([file, src]) => {
    const body = file.endsWith('.json') ? `module.exports = ${src.trim()};` : src.replace(/^#!.*\r?\n/, '\n');
    return `${JSON.stringify(id(file))}: function (module, exports, require, __filename, __dirname) {\n${body}\n}`;
  });
  return `(function (nativeRequire) {
var defs = {
${defs.join(',\n')}
};
var cache = {};
function load(id) {
  if (cache[id]) return cache[id].exports;
  var module = { exports: {} };
  cache[id] = module;
  var dir = id.split('/').slice(0, -1);
  function req(spec) {
    if (spec.charAt(0) !== '.') return nativeRequire(spec);
    var parts = dir.slice();
    spec.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    var base = parts.join('/');
    var cands = [base, base + '.js', base + '.json', base + '/index.js'];
    for (var i = 0; i < cands.length; i++) if (defs[cands[i]]) return load(cands[i]);
    throw new Error('bundle: cannot resolve ' + spec + ' from ' + id);
  }
  req.main = undefined;
  defs[id].call(module.exports, module, module.exports, req, id, dir.join('/'));
  return module.exports;
}
load(${JSON.stringify(id(entryAbs))});
})(require);
`;
}

module.exports = { bundle };
