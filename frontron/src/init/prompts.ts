import readline from 'node:readline/promises'

import type { InitPrompter, PackageJson } from './shared'
import { normalizeValue } from './shared'

// createReadlinePrompter 함수는 터미널 입출력을 사용해 init 질문을 처리하는 프롬프터를 만든다.
export function createReadlinePrompter(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): InitPrompter {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  return {
    // text 메서드는 사용자에게 문자열 값을 묻고 빈 답변이면 기본값을 돌려준다.
    async text(message, defaultValue) {
      const answer = await rl.question(`${message} [${defaultValue}]: `)
      return answer.trim() || defaultValue
    },
    // close 메서드는 readline 인터페이스를 닫아 터미널 리소스를 정리한다.
    close() {
      rl.close()
    },
  }
}

// askText 함수는 프롬프트가 켜져 있으면 사용자에게 값을 묻고 아니면 기본값을 돌려준다.
export async function askText(
  prompter: InitPrompter | null,
  enabled: boolean,
  message: string,
  defaultValue: string,
) {
  if (!enabled || !prompter) {
    return defaultValue
  }

  return prompter.text(message, defaultValue)
}

// normalizeDesktopScriptName 함수는 생성할 desktop script 이름을 안전한 문자만 쓰도록 검증한다.
function normalizeDesktopScriptName(value: string, fallback: string) {
  const candidate = normalizeValue(value, fallback)

  // 새로 생성하는 npm script 이름은 package.json 키이면서 사용자 셸에서 자주 복사된다.
  // 공백, 따옴표, 제어문자를 허용하지 않아 명령 조립과 안내 문구를 예측 가능하게 유지한다.
  if (!/^[A-Za-z0-9:_.-]+$/.test(candidate)) {
    throw new Error(
      `Script name "${candidate}" is invalid. Use only letters, numbers, ":", "_", "-", and ".".`,
    )
  }

  return candidate
}

// chooseDesktopScriptName 함수는 중복을 피하면서 새 데스크톱 npm script 이름을 선택한다.
export async function chooseDesktopScriptName(
  prompter: InitPrompter | null,
  promptEnabled: boolean,
  packageJson: PackageJson,
  message: string,
  defaultValue: string,
  takenNames: Set<string>,
  conflictFallback: string,
  explicitValue: boolean,
  allowedExistingNames = new Set<string>(),
) {
  let candidate = normalizeDesktopScriptName(
    await askText(prompter, promptEnabled, message, defaultValue),
    defaultValue,
  )

  while (
    (packageJson.scripts?.[candidate] && !allowedExistingNames.has(candidate)) ||
    takenNames.has(candidate)
  ) {
    if (!promptEnabled || !prompter) {
      if (!explicitValue) {
        for (const fallback of [
          conflictFallback,
          `${defaultValue}:electron`,
          `${conflictFallback}:2`,
        ]) {
          if (!packageJson.scripts?.[fallback] && !takenNames.has(fallback)) {
            return fallback
          }
        }
      }

      throw new Error(
        `Script name "${candidate}" already exists. Choose a different desktop script name.`,
      )
    }

    candidate = normalizeDesktopScriptName(
      await askText(
        prompter,
        true,
        `${message} (already in use; choose another name)`,
        conflictFallback,
      ),
      conflictFallback,
    )
  }

  return candidate
}
