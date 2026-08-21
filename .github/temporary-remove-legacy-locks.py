from pathlib import Path


def update(path: str, transform):
    file_path = Path(path)
    before = file_path.read_text()
    after = transform(before)
    if after == before:
        raise RuntimeError(f"No changes produced for {path}")
    file_path.write_text(after)


def update_transaction(source: str) -> str:
    block = """// Doctor also reports stale artifacts left by older releases; current transactions use only the journal.
export const TRANSACTION_JOURNAL_PREPARING_PREFIX = '.frontron-transaction-journal.preparing-'
export const TRANSACTION_LOCK_PATH = '.frontron-transaction.lock'
export const TRANSACTION_LOCK_PREPARING_PREFIX = '.frontron-transaction.lock.preparing-'
export const TRANSACTION_RECOVERY_LOCK_PATH = '.frontron-transaction-recovery.lock'
export const TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX =
  '.frontron-transaction-recovery.lock.preparing-'

"""
    if source.count(block) != 1:
        raise RuntimeError("Legacy transaction constant block not found")
    return source.replace(block, "")


def update_doctor(source: str) -> str:
    import_block = """import {
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_RECOVERY_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
} from './transaction-journal'
"""
    state_block = """const TRANSACTION_STATE_NAMES = new Set([
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PATH,
  '.frontron-transaction.lock.releasing',
  '.frontron-transaction-recovery.lock.releasing',
])

const TRANSACTION_STATE_PREFIXES = [
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
]

// collectPendingTransactionState 함수는 복구가 필요한 저널과 잠금 파일을 읽기만 한다.
function collectPendingTransactionState(cwd: string) {
  return readdirSync(cwd)
    .filter(
      (entry) =>
        TRANSACTION_STATE_NAMES.has(entry) ||
        TRANSACTION_STATE_PREFIXES.some((prefix) => entry.startsWith(prefix)),
    )
    .sort()
}

// describePendingTransactionState 함수는 발견한 트랜잭션 파일의 역할을 설명한다.
function describePendingTransactionState(entry: string) {
  const isJournal =
    entry === TRANSACTION_JOURNAL_PATH || entry.startsWith(TRANSACTION_JOURNAL_PREPARING_PREFIX)

  return `Pending transaction ${isJournal ? 'journal' : 'lock'} detected: ${entry}`
}
"""
    next_state = """// collectPendingTransactionState 함수는 복구가 필요한 현재 저널만 읽기 전용으로 확인한다.
function collectPendingTransactionState(cwd: string) {
  return readdirSync(cwd).filter((entry) => entry === TRANSACTION_JOURNAL_PATH)
}

function describePendingTransactionState(entry: string) {
  return `Pending transaction journal detected: ${entry}`
}
"""
    if source.count(import_block) != 1 or source.count(state_block) != 1:
        raise RuntimeError("Doctor legacy transaction blocks not found")
    return source.replace(import_block, "import { TRANSACTION_JOURNAL_PATH } from './transaction-journal'\n").replace(state_block, next_state)


def update_test(source: str) -> str:
    replacements = {
        "import { TRANSACTION_JOURNAL_PATH, TRANSACTION_LOCK_PATH } from '../src/transaction-journal'\n": "import { TRANSACTION_JOURNAL_PATH } from '../src/transaction-journal'\n",
        "    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)\n": "",
        "    const lockSource = 'pending lock sentinel\\n'\n": "",
        "    writeFileSync(lockPath, lockSource)\n": "",
        "    expect(report).toContain(`Pending transaction lock detected: ${TRANSACTION_LOCK_PATH}`)\n": "",
        "    expect(readFileSync(lockPath, 'utf8')).toBe(lockSource)\n": "",
    }
    for before, after in replacements.items():
        if source.count(before) != 1:
            raise RuntimeError(f"Doctor test target not found: {before!r}")
        source = source.replace(before, after)
    return source


update('frontron/src/transaction-journal.ts', update_transaction)
update('frontron/src/doctor.ts', update_doctor)
update('frontron/__tests__/doctor.spec.ts', update_test)
