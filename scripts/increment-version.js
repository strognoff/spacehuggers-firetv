import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read package.json
const packageJsonPath = join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

// Increment patch version
const versionParts = packageJson.version.split('.');
versionParts[2] = parseInt(versionParts[2]) + 1;
const newVersion = versionParts.join('.');

// Update package.json
packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// Update the in-game About screen version constant in the root source file.
const appJsPath = join(rootDir, 'app.js');
try {
  let appJs = readFileSync(appJsPath, 'utf8');
  appJs = appJs.replace(/const APP_VERSION = '[^']+'/g, `const APP_VERSION = '${newVersion}'`);
  writeFileSync(appJsPath, appJs);
} catch (err) {
  console.log('⚠️  app.js not found or no APP_VERSION constant');
}

// Update Android build.gradle (only after `npx cap add android` has run)
const buildGradlePath = join(rootDir, 'android', 'app', 'build.gradle');
let newVersionCode = null;
try {
    let buildGradle = readFileSync(buildGradlePath, 'utf8');

    // Increment versionCode
    const versionCodeMatch = buildGradle.match(/versionCode (\d+)/);
    newVersionCode = versionCodeMatch ? parseInt(versionCodeMatch[1]) + 1 : 1;

    buildGradle = buildGradle.replace(/versionCode \d+/, `versionCode ${newVersionCode}`);
    buildGradle = buildGradle.replace(/versionName "[^"]+"/, `versionName "${newVersion}"`);
    writeFileSync(buildGradlePath, buildGradle);
} catch (err) {
    console.log('⚠️  android/app/build.gradle not found - run `npx cap add android` first');
}

console.log(`✅ Version incremented to ${newVersion}` +
    (newVersionCode !== null ? ` (build ${newVersionCode})` : ''));
console.log(`📦 package.json: ${newVersion}`);
if (newVersionCode !== null) {
    console.log(`🤖 Android versionCode: ${newVersionCode}`);
    console.log(`🤖 Android versionName: ${newVersion}`);
}