import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { assertSecureProbe, createHarness, installProbe, readJson, reactProbe, repoRoot, writeFiles, writeJson } from './consumer-smoke/harness.mjs'

assert.equal(process.platform, 'linux', 'This fixture currently validates the Linux packaged Next.js runtime.')
const harness = createHarness('next-standalone')
const { root, reports, npm, pack, run } = harness
const appRoot = join(root, 'next-standalone-consumer')
mkdirSync(appRoot)
const template = readJson(join(repoRoot, 'create-frontron/template/package.json'))
const pkg = {
  name: 'next-standalone-consumer', version: '0.1.0', private: true, type: 'module',
  scripts: { dev: 'next dev --hostname 127.0.0.1', build: 'next build' },
  dependencies: { next: '16.3.4', react: template.dependencies.react, 'react-dom': template.dependencies['react-dom'] },
}
writeJson(join(appRoot, 'package.json'), pkg)

// A real App Router app with an application-owned nonce CSP. This deliberately
// does not claim support for default inline scripts without an upstream policy,
// static export, cookies, server actions, or arbitrary Next.js configurations.
const sources = {
  'next.config.mjs': "export default { output: 'standalone' }\n",
  'app/layout.jsx': `import './globals.css';
export const dynamic = 'force-dynamic';
export default function Layout({children}) { return <html lang="en"><body>{children}</body></html>; }\n`,
  'app/globals.css': 'h1 { font-size: 31px; }\n',
  'app/page.jsx': `'use client';
import {useState} from 'react';
import Link from 'next/link';
export default function Page() {
  const [n, set] = useState(0);
  return <main><h1>Desktop app ready</h1>
    <button id="counter" data-value={n} onClick={() => set(n+1)}>Count {n}</button>
    <Link id="next-link" href="/second?from=client" prefetch={false}>Second page</Link>
  </main>;
}\n`,
  'app/second/page.jsx': 'export default function Page() { return <h1>Second page ready</h1>; }\n',
  'app/api/echo/route.js': `export async function GET(request) {
  return Response.json({query: new URL(request.url).searchParams.get('value')});
}
export async function POST(request) { return Response.json({body: await request.json()}); }\n`,
  'app/redirect/route.js': `import {NextResponse} from 'next/server';
export function GET(request) { return NextResponse.redirect(new URL('/second?from=redirect', request.url)); }\n`,
  'public/probe.txt': 'packaged Next.js public asset\n',
  'proxy.js': `import {NextResponse} from 'next/server';
export function proxy(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = "default-src 'self'; script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({request: {headers}});
  response.headers.set('Content-Security-Policy', csp);
  return response;
}
export const config = {matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']};\n`,
}
writeFiles(appRoot, sources)
const rendererProbe = `(async () => {
  const checkedFetch = async (input, init) => {
    try { return await fetch(input, init); }
    catch (error) { throw new Error('Fetch failed for ' + input + ': ' + String(error)); }
  };
  const base = await ${reactProbe};
  if (getComputedStyle(document.querySelector('h1')).fontSize !== '31px') throw new Error('CSS asset did not load');
  const asset = await checkedFetch('/probe.txt');
  if (!asset.ok || await asset.text() !== 'packaged Next.js public asset\\n') throw new Error('Missing public asset');
  const get = await checkedFetch('/api/echo?value=frontron%20query');
  if (!get.ok || (await get.json()).query !== 'frontron query') throw new Error('GET query was not preserved');
  const post = await checkedFetch('/api/echo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:'body preserved', unicode:'한글'})});
  const postBody = await post.json();
  if (!post.ok || postBody.body.message !== 'body preserved' || postBody.body.unicode !== '한글') throw new Error('POST body was not preserved');
  const nonce = async () => {
    const response = await checkedFetch('/', {cache:'no-store'});
    const policy = response.headers.get('content-security-policy') || '';
    const value = policy.match(/'nonce-([^']+)'/);
    if (!response.ok || !value || policy.includes('unsafe-eval')) throw new Error('Application CSP was not preserved');
    return value[1];
  };
  if (await nonce() === await nonce()) throw new Error('Nonce was reused across responses');
  const redirect = await checkedFetch('/redirect');
  if (!redirect.ok || !redirect.url.startsWith(location.origin + '/second?from=redirect')) throw new Error('Redirect escaped the application origin: ' + redirect.url);
  window.__frontronNavigationProbe = 'client-side';
  document.querySelector('#next-link').click();
  const deadline = Date.now() + 15000;
  while (document.querySelector('h1')?.textContent !== 'Second page ready') {
    if (Date.now() > deadline) throw new Error('Client navigation failed');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (window.__frontronNavigationProbe !== 'client-side') throw new Error('Navigation was a document reload, not client routing');
  if (location.pathname !== '/second' || location.search !== '?from=client') throw new Error('Navigation URL mismatch');
  return {...base, css: true, publicAsset: true, getQuery: true, postBody: true,
    noncePolicy: true, nonceChanges: true, redirect: true, clientNavigation: true};
})()`

try {
  const createTarball = await pack('create-frontron')
  const frontronTarball = await pack('frontron')
  await npm(['install', '-D', createTarball, frontronTarball, '--fund=false'], appRoot)
  await npm(['run', 'build'], appRoot)
  await npm(['exec', '--', 'frontron', 'init', '--yes', '--adapter', 'next-standalone'], appRoot)
  await npm(['install', '--fund=false'], appRoot)
  await npm(['audit', '--audit-level=moderate'], appRoot)
  await npm(['exec', '--', 'frontron', 'update', '--yes'], appRoot)
  const restoreProbe = installProbe(appRoot, 'electron', rendererProbe)
  try {
    await npm(['run', 'frontron:build', '--', '--dir'], appRoot)
    copyFileSync(join(appRoot, 'package-lock.json'), join(reports, 'next-package-lock.json'))
    const configured = readJson(join(appRoot, 'package.json'))
    const unpacked = join(appRoot, configured.build.directories.output, 'linux-unpacked')
    const detached = join(root, 'detached runtime')
    renameSync(unpacked, detached)
    const sourceOffline = `${appRoot}-unavailable`
    renameSync(appRoot, sourceOffline)
    try {
      const executable = join(detached, pkg.name)
      assert.ok(existsSync(executable))
      const cwd = join(root, 'unrelated working directory')
      mkdirSync(cwd)
      const probePath = join(reports, 'next-packaged.json')
      await run('xvfb-run', ['-a', executable, '--no-sandbox', '--enable-logging=stderr'], cwd, {timeout: 120_000, env: {FRONTRON_CONSUMER_PROBE: probePath, NODE_ENV:'production'}})
      const probe = assertSecureProbe(probePath, {counter: true, sandbox: false})
      for (const name of ['css', 'publicAsset', 'getQuery', 'postBody', 'noncePolicy', 'nonceChanges', 'redirect', 'clientNavigation']) assert.equal(probe[name], true)
      writeJson(join(reports, 'summary.json'), {next: pkg.dependencies.next, strategy: 'next-standalone', sourceUnavailable: true, passed: true, linuxSandboxCertified: false, cookiesTested: false})
    } finally {
      renameSync(sourceOffline, appRoot)
    }
  } finally {
    restoreProbe()
  }
  await npm(['exec', '--', 'frontron', 'clean', '--yes'], appRoot)
  assert.deepEqual(readJson(join(appRoot, 'package.json')).scripts, pkg.scripts)
  for (const [name, content] of Object.entries(sources)) assert.equal(readFileSync(join(appRoot, name), 'utf8'), content)
  await npm(['run', 'build'], appRoot)
  console.log('[consumer] Real Next.js standalone build, isolated packaged renderer, nonce CSP, APIs, redirects, navigation and clean passed.')
  harness.cleanup()
} catch (error) {
  console.error(error)
  console.error(`[consumer] Failed consumer retained at ${root}; reports at ${reports}`)
  process.exitCode = 1
}
