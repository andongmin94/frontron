import fs from 'fs';
import path from 'path';

/**
 * Vite 설정 파일에서 서버 포트를 추출합니다.
 * @param {string} configPath - vite.config.ts 파일 경로
 * @returns {number | null} 추출된 포트 번호 또는 null
 */
function getPortFromViteConfig(configPath:string) {
  try {
    if (!fs.existsSync(configPath)) {
      console.log(`Vite config not found at ${configPath}, using default port.`);
      return null;
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    // 개선된 정규 표현식: server 블록 내에서 'port: 숫자' 패턴을 찾습니다.
    // 주석이나 다른 속성들에 조금 더 강인하게 대응하도록 시도합니다.
    // 예: server: { ..., port: 5173, ... } 또는 server: { port: 5173 } 등
    const portMatch = configContent.match(
      // server 키와 여는 중괄호 { 찾기 (공백 허용)
      /server\s*:\s*\{([\s\S]*?)\}/
    );

    if (portMatch && portMatch[1]) {
      // server 블록 내용에서 port: 숫자 찾기
      const serverBlockContent = portMatch[1];
      const portLineMatch = serverBlockContent.match(/port\s*:\s*(\d+)/);

      if (portLineMatch && portLineMatch[1]) {
        const port = parseInt(portLineMatch[1], 10);
        console.log(`Found port ${port}.`);
        return port;
      }
    } else {
      console.log(`Port configuration not found in ${configPath}, using default port.`);
      return null;
    }
  } catch (error) {
    console.error(`Error reading or parsing ${configPath}:`, error);
    return null;
  }
}

/**
 * 개발 또는 프로덕션 환경에 맞는 포트를 결정합니다.
 * @param {boolean} isDev - 개발 모드 여부
 * @param {string} __dirname - 현재 디렉토리 경로
 * @returns {Promise<number|null>} 사용할 포트 번호 또는 실패 시 null
 */
export async function determinePort(isDev:boolean, __dirname:string) {
  if (!isDev) {
    // --- 프로덕션 로직 (변경 없음) ---
    try {
      const express = (await import('express')).default;
      const server = express();
      const distPath = path.join(__dirname, '../../dist');

      if (!fs.existsSync(distPath)) {
        throw new Error(`Distribution directory not found: ${distPath}`);
      }
      server.use(express.static(distPath));
      server.get('/', (_, res) => {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('index.html not found');
        }
      });

      return new Promise((resolve, reject) => {
        const listener = server.listen(0, 'localhost', () => {
          const address = listener.address();
          const port = typeof address === 'object' && address !== null ? address.port : null;
          console.log(`Production server listening on port ${port}`);
          resolve(port);
        });
        listener.on('error', (err) => {
          console.error('Failed to start production server:', err);
          reject(err); // 여기서 reject를 호출해야 오류가 상위로 전파됨
        });
      });
    } catch (error) {
      console.error('Error setting up production server:', error);
      // throw error; // 오류를 다시 던져서 initializeApp에서 잡도록 함
      return null; // 또는 null 반환 유지 (initializeApp에서 null 체크 필요)
    }
  } else {
    // --- 개발 로직 수정 ---
    const viteConfigPath = path.join(__dirname, '../../vite.config.ts');
    const vitePort = getPortFromViteConfig(viteConfigPath);
    const portToUse = vitePort !== null ? vitePort : 0;
    console.log(`Using development port: ${portToUse}`);
    return portToUse; // 개발 모드에서는 Promise가 아닌 숫자 바로 반환
  }
}