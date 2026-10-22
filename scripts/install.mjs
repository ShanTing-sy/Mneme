import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const source = resolve(process.cwd());
const target = 'D:/sl/SillyTavern/data/default-user/extensions/Mneme';

if (!existsSync(resolve(source, 'dist/index.js'))) {
  console.error('缺少 dist/index.js，请先运行 npm run build');
  process.exit(1);
}

// 本机环境下 fs.cpSync 会被沙箱静默终止，改用递归读写
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const fromPath = join(from, name);
    const toPath = join(to, name);
    if (statSync(fromPath).isDirectory()) copyDir(fromPath, toPath);
    else writeFileSync(toPath, readFileSync(fromPath));
  }
}

mkdirSync(target, { recursive: true });
rmSync(resolve(target, 'dist'), { recursive: true, force: true });
copyDir(resolve(source, 'dist'), resolve(target, 'dist'));
mkdirSync(dirname(resolve(target, 'manifest.json')), { recursive: true });
writeFileSync(resolve(target, 'manifest.json'), readFileSync(resolve(source, 'manifest.json')));

console.log(`已安装到 ${target}，刷新酒馆页面即可生效。`);
