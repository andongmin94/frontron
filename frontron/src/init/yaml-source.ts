export type YamlLine = {
  text: string
  ending: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

// splitYamlLines 함수는 각 줄의 원래 줄바꿈 문자를 보존한 채 YAML 원문을 나눈다.
export function splitYamlLines(source: string) {
  const lines: YamlLine[] = []
  let start = 0

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character !== '\n' && character !== '\r') {
      continue
    }

    const ending = character === '\r' && source[index + 1] === '\n' ? '\r\n' : character
    lines.push({ text: source.slice(start, index), ending })
    index += ending.length - 1
    start = index + 1
  }

  if (start < source.length) {
    lines.push({ text: source.slice(start), ending: '' })
  }

  return lines
}

// joinYamlLines 함수는 보존한 줄바꿈과 함께 YAML 줄을 다시 합친다.
export function joinYamlLines(lines: YamlLine[]) {
  return lines.map((line) => `${line.text}${line.ending}`).join('')
}

// findPreferredEol 함수는 새 줄에 사용할 기존 YAML 문서의 대표 줄바꿈을 찾는다.
export function findPreferredEol(lines: YamlLine[]) {
  return lines.find((line) => line.ending)?.ending || '\n'
}

// getYamlLineText 함수는 첫 줄의 UTF-8 BOM만 파싱 대상에서 제외한다.
export function getYamlLineText(line: YamlLine, lineIndex: number) {
  return lineIndex === 0 && line.text.startsWith('\uFEFF') ? line.text.slice(1) : line.text
}

// isYamlTrivia 함수는 빈 줄과 주석 전용 줄을 구분한다.
export function isYamlTrivia(text: string) {
  const trimmed = text.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

// formatLineReason 함수는 YAML 문제 위치를 사람이 바로 찾을 수 있도록 줄 번호를 붙인다.
export function formatLineReason(lineIndex: number, reason: string) {
  return `${reason} (line ${lineIndex + 1})`
}

// findInlineCommentStart 함수는 따옴표 안의 #을 제외하고 inline comment 시작점을 찾는다.
export function findInlineCommentStart(text: string, start: number) {
  let quote: 'single' | 'double' | null = null

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]

    if (quote === 'single') {
      if (character === "'" && text[index + 1] === "'") {
        index += 1
      } else if (character === "'") {
        quote = null
      }
      continue
    }

    if (quote === 'double') {
      if (character === '\\') {
        index += 1
      } else if (character === '"') {
        quote = null
      }
      continue
    }

    if (character === "'") {
      quote = 'single'
    } else if (character === '"') {
      quote = 'double'
    } else if (character === '#' && (index === start || /\s/.test(text[index - 1]))) {
      return index
    }
  }

  return -1
}
