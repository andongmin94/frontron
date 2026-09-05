// Standalone regression checks use the actual TypeScript sources, not a reimplementation.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontron-recovery-check-'))
let passed = 0
try {
  const runtime = path.join(root, 'runtime')
  fs.mkdirSync(runtime)
  for (const name of ['project-paths', 'transaction-journal']) {
    const source = fs.readFileSync(path.join(packageRoot, 'src', `${name}.ts`), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText.replaceAll("'./project-paths'", "'./project-paths.mjs'")
    fs.writeFileSync(path.join(runtime, `${name}.mjs`), compiled)
  }
  const moduleUrl = pathToFileURL(path.join(runtime, 'transaction-journal.mjs')).href
  const j = await import(moduleUrl)
  const check = async (label, run) => {
    const project = path.join(root, `case-${passed}`)
    fs.mkdirSync(project)
    await run(project)
    console.log(`PASS ${++passed}: ${label}`)
  }
  const write = (p, text) => fs.writeFileSync(p, text)
  const read = (p) => fs.readFileSync(p, 'utf8')
  const plan = (project, paths) => j.beginTransaction(project, 'init', paths.map((p) => ({ path: p, safetyRoot: project })))
  const apply = (tx, p, text) => j.writeTransactionFile(tx, p, text, tx.projectRoot)
  const journal = (p) => path.join(p, j.TRANSACTION_JOURNAL_PATH)

  await check('rollback restores old files and removes unedited generated files', (p) => {
    const old = path.join(p, 'old.txt'), fresh = path.join(p, 'new.txt')
    write(old, 'before')
    const tx = plan(p, [old, fresh]); apply(tx, old, 'after'); apply(tx, fresh, 'generated')
    j.rollbackTransaction(tx)
    assert.equal(read(old), 'before'); assert.equal(fs.existsSync(fresh), false)
    assert.equal(fs.existsSync(journal(p)), false)
  })
  await check('edited old file blocks all rollback before any write', (p) => {
    const a = path.join(p, 'a'), b = path.join(p, 'b')
    write(a, 'a0'); write(b, 'b0')
    const tx = plan(p, [a, b]); apply(tx, a, 'a1'); apply(tx, b, 'b1'); write(b, 'user')
    assert.throws(() => j.rollbackTransaction(tx), /Recovery conflict/)
    assert.equal(read(a), 'a1'); assert.equal(read(b), 'user'); assert.ok(fs.existsSync(journal(p)))
    write(b, 'b1'); j.rollbackTransaction(tx); assert.equal(read(a), 'a0')
  })
  await check('edited generated file is not deleted', (p) => {
    const f = path.join(p, 'new'); const tx = plan(p, [f]); apply(tx, f, 'generated'); write(f, 'user')
    assert.throws(() => j.rollbackTransaction(tx), /Recovery conflict/)
    assert.equal(read(f), 'user'); assert.ok(fs.existsSync(journal(p)))
  })
  await check('unmodified planned file preserves an external edit', (p) => {
    const a = path.join(p, 'a'), b = path.join(p, 'b'); write(a, 'a0'); write(b, 'b0')
    const tx = plan(p, [a, b]); apply(tx, a, 'a1'); write(b, 'user'); j.rollbackTransaction(tx)
    assert.equal(read(a), 'a0'); assert.equal(read(b), 'user')
  })
  await check('repeated writes validate the last recorded post-image', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f])
    apply(tx, f, 'first'); apply(tx, f, 'second'); j.rollbackTransaction(tx); assert.equal(read(f), 'before')
  })
  await check('a later write cannot overwrite a user edit', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f]); apply(tx, f, 'first'); write(f, 'user')
    assert.throws(() => apply(tx, f, 'second'), /changed after/); assert.equal(read(f), 'user')
    assert.throws(() => j.rollbackTransaction(tx), /Recovery conflict/)
  })
  await check('delete rollback refuses a new user file at the deleted path', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f]); j.removeTransactionFile(tx, f, p); write(f, 'user')
    assert.throws(() => j.rollbackTransaction(tx), /Recovery conflict/); assert.equal(read(f), 'user')
  })
  await check('hard-linked recovery target cannot modify an external file', (p) => {
    const f = path.join(p, 'f'), outside = path.join(root, 'outside')
    write(f, 'before'); const tx = plan(p, [f]); apply(tx, f, 'after'); fs.unlinkSync(f); write(outside, 'after'); fs.linkSync(outside, f)
    assert.throws(() => j.rollbackTransaction(tx), /single-link/)
    assert.equal(read(outside), 'after'); assert.ok(fs.existsSync(journal(p)))
  })
  await check('unexpected content in a new directory prevents partial cleanup', (p) => {
    const dir = path.join(p, 'newdir'), f = path.join(dir, 'generated')
    const tx = plan(p, [f]); apply(tx, f, 'after'); write(path.join(dir, 'user'), 'keep')
    assert.throws(() => j.rollbackTransaction(tx), /Recovery conflict/)
    assert.equal(read(f), 'after'); assert.equal(read(path.join(dir, 'user')), 'keep')
  })
  await check('a torn target is preserved as a conflict', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f]); apply(tx, f, 'long-after'); write(f, 'long-')
    assert.throws(() => j.rollbackTransaction(tx), /Recovery conflict/); assert.equal(read(f), 'long-')
  })
  await check('an intent recorded before the write can safely roll back', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f]); apply(tx, f, 'after'); write(f, 'before')
    j.rollbackTransaction(tx); assert.equal(read(f), 'before')
  })
  await check('old journal schema is rejected without migration or data loss', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f]); apply(tx, f, 'after')
    const lines = read(journal(p)).split('\n'); const h = JSON.parse(lines[0]); h.schemaVersion = 2; lines[0] = JSON.stringify(h)
    write(journal(p), lines.join('\n'))
    assert.throws(() => j.recoverPendingTransaction(p), /unsupported/); assert.equal(read(f), 'after'); assert.ok(fs.existsSync(journal(p)))
  })
  await check('live transaction recovery remains blocked', (p) => {
    const f = path.join(p, 'f'); write(f, 'before'); const tx = plan(p, [f]); apply(tx, f, 'after')
    assert.throws(() => j.recoverPendingTransaction(p), /still active/); j.rollbackTransaction(tx)
  })
  await check('commit leaves applied content and removes only the journal', (p) => {
    const f = path.join(p, 'f'); const tx = plan(p, [f]); apply(tx, f, 'after'); j.commitTransaction(tx)
    assert.equal(read(f), 'after'); assert.equal(j.hasPendingTransaction(p), false)
  })
  await check('manual partial restoration is idempotent', (p) => {
    const a = path.join(p, 'a'), b = path.join(p, 'b'); write(a, 'a0'); write(b, 'b0')
    const tx = plan(p, [a, b]); apply(tx, a, 'a1'); apply(tx, b, 'b1'); write(a, 'a0')
    j.rollbackTransaction(tx); assert.equal(read(a), 'a0'); assert.equal(read(b), 'b0')
  })
  await check('a dangling symlink is not treated as an absent target', (p) => {
    const f = path.join(p, 'f'); const tx = plan(p, [f]); apply(tx, f, 'after'); fs.unlinkSync(f)
    // Windows directory junctions do not require Developer Mode or symlink privileges.
    fs.symlinkSync(path.join(p, 'missing'), f, process.platform === 'win32' ? 'junction' : 'file')
    assert.throws(() => j.rollbackTransaction(tx)); assert.ok(fs.lstatSync(f).isSymbolicLink())
  })

  const worker = path.join(runtime, 'worker.mjs')
  fs.writeFileSync(worker, `import * as fs from 'node:fs'; import path from 'node:path'; import * as j from ${JSON.stringify(moduleUrl)};
const p=process.argv[2]; const a=path.join(p,'a'), b=path.join(p,'b'), n=path.join(p,'new');
const tx=j.beginTransaction(p,'init',[a,b,n].map(f=>({path:f,safetyRoot:p})));
j.writeTransactionFile(tx,a,'after',p); j.writeTransactionFile(tx,n,'generated',p);
process.send('ready'); setInterval(()=>{},1000);`)
  for (const scenario of ['normal', 'untouched-edit', 'old-edit', 'new-edit']) {
    await check(`real child-process kill: ${scenario}`, async (p) => {
      write(path.join(p, 'a'), 'before'); write(path.join(p, 'b'), 'b0')
      const child = spawn(process.execPath, [worker, p], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      let timer
      try {
        await Promise.race([
          once(child, 'message'),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('worker readiness timeout')), 10000) }),
          once(child, 'exit').then(() => { throw new Error('worker exited before handshake') }),
        ])
        clearTimeout(timer)
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
        if (scenario === 'untouched-edit') write(path.join(p, 'b'), 'user')
        if (scenario === 'old-edit') write(path.join(p, 'a'), 'user')
        if (scenario === 'new-edit') write(path.join(p, 'new'), 'user')
        if (scenario.endsWith('-edit') && scenario !== 'untouched-edit') {
          assert.throws(() => j.recoverPendingTransaction(p), /Recovery conflict/)
          assert.equal(read(path.join(p, scenario === 'old-edit' ? 'a' : 'new')), 'user')
          assert.ok(fs.existsSync(journal(p)))
        } else {
          assert.equal(j.recoverPendingTransaction(p).recovered, true)
          assert.equal(read(path.join(p, 'a')), 'before'); assert.equal(fs.existsSync(path.join(p, 'new')), false)
          assert.equal(read(path.join(p, 'b')), scenario === 'untouched-edit' ? 'user' : 'b0')
          assert.equal(j.recoverPendingTransaction(p).recovered, false)
        }
      } finally {
        clearTimeout(timer)
        if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited }
      }
    })
  }
  console.log(`Recovery safety checks: ${passed} passed`)
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
