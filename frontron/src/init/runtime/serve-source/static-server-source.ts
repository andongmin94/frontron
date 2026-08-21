// renderStaticServerSource 함수는 canonical static server를 generated serve.ts에 연결한다.
export function renderStaticServerSource() {
  return `// startRendererRuntime 함수는 정적 렌더러 서버를 시작하고 접속 URL을 반환한다.
export async function startRendererRuntime() {
  return startStaticRendererServer(getRendererRuntimeRootDir())
}

// stopRendererRuntime 함수는 실행 중인 정적 렌더러 서버를 종료한다.
export async function stopRendererRuntime() {
  await stopStaticRendererServer()
}`
}
