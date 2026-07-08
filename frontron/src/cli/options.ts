import type { InitOptions } from '../init/shared'

// splitOptionArgument 함수는 CLI 옵션을 이름과 --name=value 형태의 inline 값으로 나눈다.
function splitOptionArgument(argument: string) {
  // 긴 옵션은 "--name value"와 "--name=value"를 모두 받는다.
  // 짧은 옵션은 기존처럼 "-y" 형태만 허용해서 파서 규칙을 단순하게 유지한다.
  const equalsIndex = argument.startsWith('--') ? argument.indexOf('=') : -1

  if (equalsIndex === -1) {
    return { name: argument, inlineValue: null }
  }

  return {
    name: argument.slice(0, equalsIndex),
    inlineValue: argument.slice(equalsIndex + 1),
  }
}

// rejectInlineValue 함수는 값을 받을 수 없는 boolean 옵션에 값이 붙었는지 검사한다.
function rejectInlineValue(name: string, inlineValue: string | null) {
  if (inlineValue !== null) {
    throw new Error(`${name} does not accept a value.`)
  }
}

// readOptionValue 함수는 파일이나 문자열에서 필요한 값을 읽는다.
function readOptionValue(name: string, inlineValue: string | null, argv: string[], index: number) {
  if (inlineValue !== null) {
    if (!inlineValue) {
      throw new Error(`${name} requires a value.`)
    }

    return {
      value: inlineValue,
      nextIndex: index,
    }
  }

  const nextValue = argv[index + 1]

  if (!nextValue) {
    throw new Error(`${name} requires a value.`)
  }

  return {
    value: nextValue,
    nextIndex: index + 1,
  }
}

// parseCliOptions 함수는 CLI 인자를 명령 옵션과 위치 인자로 나눈다.
export function parseCliOptions(argv: string[]) {
  const options: InitOptions = {
    yes: false,
    force: false,
  }
  const positional: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const rawArgument = argv[index]

    if (!rawArgument.startsWith('-')) {
      positional.push(rawArgument)
      continue
    }

    const { name: argument, inlineValue } = splitOptionArgument(rawArgument)

    switch (argument) {
      case '--help':
      case '-h':
        rejectInlineValue(argument, inlineValue)
        positional.push(argument)
        break
      case '--yes':
      case '-y':
        rejectInlineValue(argument, inlineValue)
        options.yes = true
        break
      case '--force':
        rejectInlineValue(argument, inlineValue)
        options.force = true
        break
      case '--dry-run':
        rejectInlineValue(argument, inlineValue)
        options.dryRun = true
        break
      case '--adapter': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.adapter = next.value
        index = next.nextIndex
        break
      }
      case '--desktop-dir': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.desktopDir = next.value
        index = next.nextIndex
        break
      }
      case '--app-script': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.appScript = next.value
        index = next.nextIndex
        break
      }
      case '--build-script': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.buildScript = next.value
        index = next.nextIndex
        break
      }
      case '--package-script': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.packageScript = next.value
        index = next.nextIndex
        break
      }
      case '--web-dev': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.webDevScript = next.value
        index = next.nextIndex
        break
      }
      case '--web-build': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.webBuildScript = next.value
        index = next.nextIndex
        break
      }
      case '--out-dir': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.outDir = next.value
        index = next.nextIndex
        break
      }
      case '--server-root': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.serverRoot = next.value
        index = next.nextIndex
        break
      }
      case '--server-entry': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.serverEntry = next.value
        index = next.nextIndex
        break
      }
      case '--product-name': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.productName = next.value
        index = next.nextIndex
        break
      }
      case '--app-id': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.appId = next.value
        index = next.nextIndex
        break
      }
      case '--preset': {
        const next = readOptionValue(argument, inlineValue, argv, index)
        options.preset = next.value
        index = next.nextIndex
        break
      }
      default:
        throw new Error(`Unknown option "${rawArgument}".`)
    }
  }

  return { options, positional }
}
