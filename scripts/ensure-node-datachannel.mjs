import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const moduleDir = path.join(rootDir, 'node_modules', 'node-datachannel')
const binaryPath = path.join(moduleDir, 'build', 'Release', 'node_datachannel.node')
const prebuildInstaller = path.join(rootDir, 'node_modules', 'prebuild-install', 'bin.js')

if (existsSync(binaryPath)) {
  console.log('[native] node-datachannel binary is present')
  process.exit(0)
}

if (!existsSync(prebuildInstaller)) {
  throw new Error('node-datachannel is not installed. Run npm ci before packaging.')
}

console.log('[native] Downloading the node-datachannel N-API prebuild...')
const result = spawnSync(process.execPath, [prebuildInstaller, '-r', 'napi'], {
  cwd: moduleDir,
  stdio: 'inherit'
})

if (result.status !== 0 || !existsSync(binaryPath)) {
  throw new Error(
    'node-datachannel native binary is unavailable. Run "npm install-scripts approve node-datachannel", then run npm run prepare:native again.'
  )
}

console.log('[native] node-datachannel binary downloaded')
