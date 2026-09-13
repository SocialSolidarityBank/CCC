#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { assertSafeOutput } from '../supabase/report.mjs';
import { checkMessage, initialView, ONBOARDING_MODES, stagePrompt } from './flow.mjs';

const HELP = `relayer 설치 단계 안내
사용법: node scripts/onboarding/cli.mjs [--mode <mode>] [--format text|json]
모드: community-cloud, local-single, local-office
--format json은 --mode와 함께 초기 입력 대기 상태만 출력합니다.
명령: plan(계획 안내), help(고정 도움), cancel(선택 취소), exit(종료)
현재 도구는 안내 전용입니다. 설치, 자원 생성과 AI 호출을 실행하지 않습니다.
키, 비밀번호, 연결 문자열이나 상담 내용을 입력하지 마세요.
입력 원문은 화면에 표시하지 않습니다. 선택이나 명령을 입력한 뒤 Enter를 누르세요.
`;

function print(text) {
  assertSafeOutput(text);
  process.stdout.write(text);
}

function show(current) {
  const prompt = stagePrompt(current);
  print(`\n${current.mode} [${current.stageId}] ${current.status}\n${prompt.question ?? ''}\n${prompt.guidance}\n`);
  for (const check of current.checks) print(`[${check.code}] ${checkMessage(check.code)}\n`);
  print('> ');
}

function parseArgs(argv) {
  const options = { mode: null, format: 'text', help: false };
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { ...options, help: true };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--mode', '--format'].includes(flag) || seen.has(flag) || value === undefined) throw new Error();
    seen.add(flag);
    if (flag === '--mode') {
      if (!ONBOARDING_MODES.includes(value)) throw new Error();
      options.mode = value;
    } else {
      if (!['text', 'json'].includes(value)) throw new Error();
      options.format = value;
    }
  }
  if (options.format === 'json' && options.mode === null) throw new Error();
  return options;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch {
    process.stderr.write('[ONBOARDING_INPUT_INVALID] 지원하는 인자를 확인하세요. --help로 도움말을 봅니다.\n');
    process.exitCode = 2;
    return;
  }
  if (options.help) { print(HELP); return; }
  if (options.format === 'json') {
    print(`${JSON.stringify(initialView(options.mode), null, 2)}\n`);
    return;
  }

  print(HELP);
  let current = options.mode === null ? null : initialView(options.mode);
  const selectMode = () => print('\n어떤 방식으로 사용하나요?\n1. Community Cloud\n2. Local Single\n3. Local Office\n> ');
  if (current === null) selectMode(); else show(current);
  // Readline's TTY echo and history must not retain an accidentally pasted secret.
  const input = createInterface({
    input: process.stdin,
    output: new Writable({ write(_chunk, _encoding, done) { done(); } }),
    terminal: process.stdin.isTTY === true,
    historySize: 0,
  });
  const interrupt = () => { process.exitCode = 130; input.close(); };
  const terminate = () => { process.exitCode = 143; input.close(); };
  input.on('SIGINT', interrupt);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    for await (const line of input) {
      const command = line.trim();
      if (['exit', 'quit', '종료'].includes(command)) break;
      if (['cancel', '취소'].includes(command)) {
        current = current === null ? null : initialView(current.mode);
        print('\n[CANCELLED] 선택을 취소했습니다. 외부 설정은 변경하지 않았습니다.\n');
      } else if (['help', '?', '도움말'].includes(command)) {
        print('\n질문은 외부로 보내지 않습니다. 현재 입력을 유지한 채 고정 안내를 보여드립니다.\n');
      } else if (['plan', '계획'].includes(command)) {
        print('\n단계 계획 안내\n실행 계획: 아직 만들지 않았습니다.\n변경 대상: 아직 검증하지 않았습니다.\n변경 내용: 없음\n비용 발생과 외부 전송: 없음\n승인과 실행: 실제 검사 결과, 대상과 서명 검증이 준비된 뒤에만 가능합니다.\n');
      } else if (command === '이대로 설정') {
        print('\n[EXECUTION_UNAVAILABLE] 실행 도구가 연결되지 않았습니다. 승인을 만들거나 설정을 변경하지 않습니다.\n');
      } else if (current === null) {
        const mode = ONBOARDING_MODES.includes(command) ? command
          : /^[1-3]$/u.test(command) ? ONBOARDING_MODES[Number(command) - 1] : null;
        if (mode !== null) current = initialView(mode);
        else print('\n모드 번호나 모드 이름을 선택하세요. 입력 원문은 저장하거나 전송하지 않습니다.\n');
      } else if (current.stageId === 'environment' && ['1', '2', 'new', 'existing', '처음', '이어가기'].includes(command)) {
        const newCloud = current.mode === 'community-cloud' && ['1', 'new', '처음'].includes(command);
        current = initialView(current.mode, newCloud ? 'cloud-resources' : 'installation');
      } else {
        print('\n자유 질문은 아직 처리하지 않습니다. 입력 원문을 저장하거나 전송하지 않고 현재 단계의 안내를 유지합니다.\n');
      }
      if (current === null) selectMode(); else show(current);
    }
  } finally {
    input.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    print('\n[CLOSED] 안내를 종료했습니다. 설치나 외부 변경을 실행하지 않았습니다.\n');
  }
}

try { await main(); } catch {
  process.stderr.write('[ONBOARDING_FAILED] 안내를 완료하지 못했습니다. 실제 설치 상태는 확인되지 않았습니다.\n');
  process.exitCode = 1;
}
