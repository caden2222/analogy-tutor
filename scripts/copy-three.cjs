// Copy only Three's browser modules and license, never node_modules as a whole.
const fs = require('node:fs');
const path = require('node:path');
const build = path.dirname(require.resolve('three'));
const target = path.join(__dirname, '..', 'public', 'vendor');
fs.mkdirSync(target, {recursive: true});
for (const name of ['three.module.js', 'three.core.js']) fs.copyFileSync(path.join(build, name), path.join(target, name));
fs.copyFileSync(path.join(build, '..', 'LICENSE'), path.join(target, 'THREE-LICENSE.txt'));
console.log('Local Three.js browser modules prepared.');
