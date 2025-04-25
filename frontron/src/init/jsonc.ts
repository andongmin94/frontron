// stripJsonComments 함수는 JSONC 원문에서 문자열은 보존하고 주석만 제거한다.
function stripJsonComments(source: string) {
  let result = ''
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]

    if (inLineComment) {
      if (current === '\n' || current === '\r') {
        inLineComment = false
        result += current
      }
      continue
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false
        index += 1
      } else if (current === '\n' || current === '\r') {
        result += current
      }
      continue
    }

    if (inString) {
      result += current

      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === '"') {
        inString = false
      }

      continue
    }

    if (current === '"') {
      inString = true
      result += current
      continue
    }

    if (current === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (current === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    result += current
  }

  return result
}

// stripTrailingCommas 함수는 JSONC 원문에서 trailing comma를 제거한다.
function stripTrailingCommas(source: string) {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]

    if (inString) {
      result += current

      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === '"') {
        inString = false
      }

      continue
    }

    if (current === '"') {
      inString = true
      result += current
      continue
    }

    if (current === ',') {
      let nextIndex = index + 1

      while (/\s/.test(source[nextIndex] ?? '')) {
        nextIndex += 1
      }

      if (source[nextIndex] === '}' || source[nextIndex] === ']') {
        continue
      }
    }

    result += current
  }

  return result
}

// parseJsonc 함수는 JSONC 원문에서 주석과 trailing comma를 제거한 뒤 JSON으로 파싱한다.
export function parseJsonc<T>(source: string) {
  // tsconfig.json commonly contains comments and trailing commas. We normalize
  // just those JSONC features before handing the result to JSON.parse.
  return JSON.parse(stripTrailingCommas(stripJsonComments(source))) as T
}
