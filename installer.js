
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const nodePath = process.env.NODE_PATH || '/usr/local/bin/node'; // 필요시 수정
const scriptName = 'index.js';
const plistName = 'com.dnfh.plist';
const credentialsFile = 'credentials.json';
const cwd = process.cwd();

function askCredentials() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('ID를 입력하세요: ', (id) => {
      rl.question('PW를 입력하세요: ', (pw) => {
        rl.close();
        resolve({ id, pw });
      });
    });
  });
}

async function main() {
  // credentials.json 생성
  const credentials = await askCredentials();
  fs.writeFileSync(path.join(cwd, credentialsFile), JSON.stringify(credentials, null, 2));
  console.log(`${credentialsFile} 파일이 생성되었습니다.`);

  // plist 생성
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dnfh</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${path.join(cwd, scriptName)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/dnfh.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/dnfh.err</string>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(cwd, plistName), plistContent);
  console.log(`${plistName} 파일이 생성되었습니다.`);
}

main();
