import path from "path";
import { fileURLToPath } from "url";
import { BrowserWindow } from "electron";

// 폰트 파일 경로 설정 (public/fonts/PretendardVariable.woff2 라고 가정)
const fontPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/fonts/PretendardVariable.woff2",
);

// 경로 구분자를 웹 표준인 '/'로 변경하고 file:// 프로토콜 추가
const fontSrcUrl = `file://${fontPath.replace(/\\/g, "/")}`;

let splashWindow: BrowserWindow | null;
export function createSplash() {
  splashWindow = new BrowserWindow({
    width: 300, // 창 크기는 적절히 조절
    height: 200,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    transparent: false, // 배경을 투명하게 하려면 true로 설정하고 아래 body 배경색 제거
    skipTaskbar: true,
  });

  // HTML 내용에 CSS 스피너 애니메이션 추가
  const htmlContent = `
    <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Loading...</title>
            <style>
                /* @font-face 규칙 추가 */
                @font-face {
                    font-family: 'Pretendard';
                    src: url('${fontSrcUrl}') format('woff2'); /* 폰트 경로 및 포맷 지정 */
                    font-weight: 400; /* 필요한 경우 폰트 두께 지정 */
                    font-style: normal; /* 필요한 경우 폰트 스타일 지정 */
                }

                body {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    /* background-color: transparent; */ /* transparent: true 이므로 배경색 제거 또는 transparent 명시 */
                    overflow: hidden;
                    /* font-family 적용: 정의한 Pretendard 와 폴백 폰트 */
                    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif;
                    user-select: none;
                }
                .spinner {
                    border: 4px solid rgba(0, 0, 0, 0.1);
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border-left-color: #09f;
                    animation: spin 1s ease-in-out infinite;
                    margin-top: 30px;
                    margin-bottom: 10px;
                }
                .loading-text {
                    color: #333;
                    font-size: 20px;
                }
                .dots::after {
                    content: '.';
                    animation: dots 1.5s steps(3, end) infinite;
                    display: inline-block;
                    width: 1.5em;
                    text-align: left;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes dots {
                    0% { content: '.'; }       /* 시작 시점 */
                    35% { content: '..'; }  /* 전체 시간의 1/3 지점 */
                    70% { content: '...'; } /* 전체 시간의 2/3 지점 */
                }
            </style>
        </head>
        <body>
            <div class="spinner"></div>
            <div class="loading-text">
                <h3> 로딩 중<span class="dots"></span> </h3>
            </div>
        </body>
    </html>
`;

  // data URI로 HTML 로드
  splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
  );

  // 창이 닫힐 때 참조 제거
  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  return splashWindow;
}

export function closeSplash() {
  // 창이 존재하고 파괴되지 않았는지 확인 후 destroy 호출
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}
