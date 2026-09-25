// Isolated design artifact. No API, storage, cookies, credentials or download operations.
// Shared lane contract owns policy; role previews are not production authorization.
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  org: '<path d="M8 1.8l5.4 3.1v6.2L8 14.2 2.6 11.1V4.9z"/>',
  people: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4"/>',
  settings: '<path d="M2.5 4.5h5.2M12.3 4.5h1.2M2.5 11.5h1.2M7.3 11.5h6.2"/><circle cx="10.2" cy="4.5" r="1.9"/><circle cx="5.4" cy="11.5" r="1.9"/>',
  link: '<path d="M6.4 9.6 9.6 6.4M8.6 4.9 10 3.5a2.5 2.5 0 0 1 3.5 3.5l-1.4 1.4M7.4 11.1 6 12.5A2.5 2.5 0 0 1 2.5 9l1.4-1.4"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
  share: '<path d="M8 10V2.5M5 5.5 8 2.5l3 3M3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4"/>',
  panel: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6.2 2.5v11"/>',
  'theme-dark': '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/>',
  'theme-light': '<circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06"/>',
  check: '<path d="m3 8 3 3 7-7"/>'
};
const icon = (name) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name] || icons.settings}</svg>`;
const chevron = '<svg class="wire-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.3 4.65 6 7.35 8.7 4.65" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const badge = (text) => `<span class="wire-badge"><span class="wire-badge-label">${esc(text)}</span></span>`;
const button = (text, action, disabled = false, primary = false) => `<button type="button" class="wire-button" data-variant="${primary ? 'primary' : 'neutral'}" data-action="${esc(action)}" ${disabled ? 'disabled' : ''}>${primary ? icon('check') : ''}${esc(text)}</button>`;
const rows = (values) => `<dl class="wire-data-rows">${values.map(([label,value]) => `<div class="wire-data-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
const section = (title, body) => `<section class="wire-card-section"><h3>${esc(title)}</h3>${body}</section>`;
const card = (title, status, body, id = '') => `<section class="surface-card wire-card" ${id ? `id="${esc(id)}"` : ''}><div class="wire-card-head"><h2 class="wire-card-title">${esc(title)}</h2>${status ? badge(status) : ''}</div><hr class="wire-card-divider"><div class="wire-card-body">${body}</div></section>`;
const item = (title, description, status, action = '') => `<div class="wire-item"><div class="wire-item-status"><h3 class="wire-item-title">${esc(title)}</h3>${badge(status)}</div><p class="wire-item-desc">${esc(description)}</p>${action ? `<div class="wire-item-action">${action}</div>` : ''}</div>`;
const list = (entries) => `<div class="item-list">${entries.join('')}</div>`;
const paragraph = (text) => `<p class="reading">${esc(text)}</p>`;
const roleNames = {all:'전체 둘러보기',admin:'기관 관리자',tech:'기관 기술 관리자',both:'기관 관리자 + 기관 기술 관리자',lead:'실무 책임자',counselor:'실무자'};
const roleSets = {all:['institution-admin','technical-admin','supervisor','worker'],admin:['institution-admin'],tech:['technical-admin'],both:['institution-admin','technical-admin'],lead:['supervisor'],counselor:['worker']};
const groups = ['기관 관리','기록 관리','AI 연결 및 설정','저장 및 백업','시스템 관리'];
const adminRoles = ['admin','both'];
const technicalRoles = ['tech','both'];
const managerRoles = ['admin','tech','both'];
const everyRole = Object.keys(roleNames);
const modules = [
  {id:'institution',title:'기관 정보',group:0,icon:'org',roles:adminRoles,purpose:'기관의 기본정보와 업무 연락처를 관리합니다.',status:'등록됨',rows:[['기관 이름','햇살연대'],['기관 코드','haetsal-demo'],['업무 시간대','Asia/Seoul'],['운영 규모','직원 12명 / 팀 3개 / 사업 3개']]},
  {id:'programs',title:'사업 관리',group:0,icon:'org',roles:adminRoles,purpose:'사업의 담당 구성과 저장 및 처리 조건을 확인합니다.',status:'진행 2개',rows:[['등록 사업','3개 / 진행 2개 / 종료 1개'],['케이스','청년 자립 30개 / 생활 회복 18개'],['도입 확인','생활 회복 1개 사업 확인 전'],['현재 설치','STT off / LLM off']]},
  {id:'accounts',title:'계정 및 권한',group:0,icon:'people',roles:managerRoles,purpose:'직원 초대와 계정 상태, 역할 및 팀 배정을 관리합니다.',status:'직원 12명',rows:[['직원 계정','사용 중 12명 / 초대 대기 1명'],['팀 구성','자립지원팀 5명 / 생활회복팀 4명 / 지역협력팀 3명'],['감독 구성','각 팀 실무 책임자 1명'],['배정 요청','공동 담당 1건 / 이관 1건']]},
  {id:'consent',title:'동의서 설정',group:1,icon:'panel',roles:adminRoles,purpose:'기관 동의 문안과 적용 버전을 관리합니다.',status:'6영역',rows:[['현재 버전','2026-09-v2 (가상 문안)'],['적용 시작','2026-09-01'],['작성 중 버전','2026-09-v3'],['기존 동의','자동 승격하지 않음']]},
  {id:'retention',title:'보관 및 파기',group:1,icon:'clock',roles:adminRoles,purpose:'보관 기준과 기간이 도래한 자료의 처리 결정을 구분합니다.',status:'검토 3건',rows:[['기본 보관 기간','1년'],['보존 시계 시작','마지막 활성 케이스 종결'],['기간 도래 후','암호화 아카이브로 이동 / 일반 조회에서 제외'],['비법적 보존 상한','종결 후 총 5년']]},
  {id:'exports',title:'기록 내보내기',group:1,icon:'share',roles:['admin','both','lead','counselor'],purpose:'업무에 필요한 범위만 선택합니다. 복원용 백업과는 다릅니다.',status:'가상 이력 2건',rows:[['출력 형식','가명 통계 CSV / 공식 기록 PDF'],['기본 포함 범위','수기 기록과 승인된 AI 기록'],['제외','승인 전 AI 초안 / 별도 허가 없는 개인정보'],['파일 생성','이 시안에서는 제공하지 않음']]},
  {id:'audit',title:'열람 및 변경 이력',group:1,icon:'clock',roles:adminRoles,purpose:'열람과 변경이 언제, 어떤 범위에서 일어났는지 살펴봅니다.',status:'예시 5건',rows:[['기록 대상','열람 / 변경 / 개인정보 복호화 / 내보내기'],['검색 범위','햇살연대'],['기록 보존','추가만 가능 / 수정과 삭제 없음'],['표시 자료','가상 운영 사건 / 상담 원문 없음']]},
  {id:'speech',title:'음성 인식 연결',group:2,icon:'link',roles:managerRoles,purpose:'녹음을 글로 바꾸는 경로와 전송 조건을 확인합니다.',status:'꺼짐',rows:[['설치 STT','off'],['선택 엔진','null'],['로컬 음성 인식','STT-G1~G3 실측 및 Q 승인 전 사용 불가'],['현재 경로','수기 기록 / 자동 사업자 전환 없음']]},
  {id:'ai',title:'AI 에이전트 연결',group:2,icon:'link',roles:managerRoles,purpose:'OpenAI 연결 준비와 키 설정, 최종 시작을 구분합니다.',status:'꺼짐',rows:[['설치 LLM','off'],['사업자','OpenAI API / store:false'],['외부로 보내는 자료','처리 장비가 가린 텍스트 AI Packet만'],['연결 준비','연결 예시 있음 / 실제 점검하지 않음']]},
  {id:'agent',title:'로컬 에이전트 설정',group:2,icon:'panel',roles:managerRoles,purpose:'기관 PC의 처리 프로그램과 가림 처리 준비 상태를 확인합니다.',status:'장비 1대',rows:[['등록 장비','상담지원 PC 01'],['가상 마지막 폴링','2026-09-09 09:55'],['대기 작업','녹음 0건 / 텍스트 가림 4건'],['가림 처리','한국어 이름 및 주소 모델 준비 예시']]},
  {id:'memory',title:'AI 메모리 설정',group:2,icon:'settings',roles:managerRoles,purpose:'기관의 기능 설정과 처리 상태만 관리합니다.',status:'꺼짐',rows:[['기능 설정','꺼짐 / 설치 LLM off'],['처리 누계','48개 케이스 / 가상 처리 126건'],['남은 처리','가림 처리 대기 4건 / 재시도 대기 2건'],['자료 원칙','공식 기록과 가림 처리 스냅샷만']]},
  {id:'database',title:'데이터베이스 연결',group:3,icon:'org',roles:managerRoles,purpose:'업무 DB의 현재 위치와 변경 없는 사전 점검을 확인합니다.',status:'현황 예시',rows:[['배포 모드','Community Cloud'],['현재 DB','기관 소유 Supabase / 서울'],['설치 버전','가상 설치 2026.09.1'],['이전 상태','시작하지 않음 / 입력 중 연결 전환 없음']]},
  {id:'storage',title:'저장 위치 설정',group:3,icon:'panel',roles:managerRoles,purpose:'원음과 첨부파일의 저장 위치 및 사용량을 확인합니다.',status:'2.4 GB',rows:[['현재 위치','기관 소유 Supabase private Storage'],['사용량','첨부파일 2.4 GB / 원음 0 GB / 할당 20 GB'],['원음 삭제','처리 직후 삭제 / 업로드 후 7일 절대 상한'],['원음 입장 조건','경로별 동의와 건강한 Agent 필요']]},
  {id:'backup',title:'백업 및 복원',group:3,icon:'clock',roles:managerRoles,purpose:'백업의 검증 결과를 보고 복원 승인과 실행 준비를 나눕니다.',status:'이력 예시',rows:[['백업 형식','암호화 .cccx'],['보관 위치','기관 지정 암호화 보관소'],['최신 가상 백업','2026-09-09 02:00 / 2.4 GB'],['실제 복원','서버 미연결 / 실행 불가']]},
  {id:'security',title:'보안 설정',group:4,icon:'settings',roles:managerRoles,purpose:'기관 로그인 보호를 관리합니다. 업무 역할과는 별개입니다.',status:'MFA 필수',rows:[['현재 모드','Community Cloud / Supabase Auth'],['관리자 계정','3명 / MFA 설정 3명'],['로그인 방식','기관 코드 → 기관 로그인 → MFA'],['지원 접근','마스킹된 자료만']]},
  {id:'system',title:'시스템 상태',group:4,icon:'clock',roles:managerRoles,purpose:'연결 상태와 처리 지연을 확인하고 해당 설정으로 이동합니다.',status:'가상 점검',rows:[['DB','응답 정상 예시'],['STT / LLM','off / off'],['처리 장비','1대 / 마지막 폴링 5분 전 예시'],['대기 작업','텍스트 가림 4건 / 녹음 0건']]},
  {id:'updates',title:'업데이트',group:4,icon:'share',roles:managerRoles,purpose:'버전과 서명, 백업 및 되돌리기 준비를 확인합니다.',status:'새 버전 예시',rows:[['현재 버전','2026.09.1 (가상)'],['후보 버전','2026.09.2 (가상)'],['서명 manifest','검증 결과 예시 / 실제 검증하지 않음'],['적용 상태','미실행']]},
  {id:'account',title:'내 정보',group:null,icon:'people',roles:everyRole,purpose:'본인 계정과 역할, 내게 온 배정 요청을 확인합니다.',status:'사용 중',rows:[['표시 이름','시연 사용자'],['소속','햇살연대 / 자립지원팀'],['이메일','staff@example.invalid'],['계정 보호','MFA 설정 예시']]},
  {id:'guide',title:'사용 가이드',group:null,icon:'panel',roles:everyRole,purpose:'초기 설정 순서와 기능별 사용법, 권한 및 문제 해결을 찾습니다.',status:'19개 안내',rows:[]}
];
const scenarioNames = {basic:'기본 가상 자료',empty:'자료 없음',off:'꺼짐 / 중지',unavailable:'기능 미지원',failure:'처리 실패 (503)',conflict:'저장 충돌 (409)',disconnected:'연결 끊김',masking:'가림 처리 대기',syncing:'동기화 중'};
const state = {role:'all',module:'institution',scenario:'basic',topic:'',drafts:{},applied:{},notes:{},reconfirm:false,drawer:false};
const canAdmin = () => roleSets[state.role].includes('institution-admin');
const canTech = () => roleSets[state.role].includes('technical-admin');
const visible = () => modules.filter(m => state.role === 'all' || m.roles.includes(state.role));
const moduleById = id => modules.find(m => m.id === id);
const defaultModule = () => ['all','admin','both'].includes(state.role) ? 'institution' : state.role === 'tech' ? 'accounts' : 'account';
const scenariosFor = id => ['basic','empty','off','unavailable','failure','conflict',...(['agent','system','ai','speech','database'].includes(id) ? ['disconnected'] : []),...(id === 'memory' ? ['masking','syncing'] : [])];
const routeURL = (id, topic = '') => `?${new URLSearchParams({module:id,role:state.role,...(state.scenario !== 'basic' ? {state:state.scenario} : {}),...(topic ? {topic} : {})})}`;
const link = (text, id, topic = '') => `<a class="wire-button" data-variant="neutral" href="${esc(routeURL(id,topic))}" data-route="${esc(id)}" ${topic ? `data-topic="${esc(topic)}"` : ''}>${esc(text)}</a>`;
const related = (id) => `<div class="actions">${link('관련 사용 가이드','guide',id)}</div>`;
const consentAreas = ['개인정보 수집·이용','민감정보 처리','상담 녹음','외부 STT 처리','외부 LLM·국외 처리','음성 원본 보유기간'];
const basePrograms = [['청년 자립','진행 중','30개 케이스 / 실무자 5명 / Supabase 서울 / 외부 허용'],['생활 회복','도입 확인 전','18개 케이스 / 실무자 4명 / 저장 위치 나중에 정하기 / 기관 안'],['2025 재도약','종료','신규 등록 중지 / 보관 기록 유지']];
const selectField = (key,label,options,value,help='') => ({key,label,type:'select',options,value,help});
const textField = (key,label,value,help='') => ({key,label,type:'text',value,help,required:true});
// A form schema describes preview questions, not an API request or a server capability.
function formSpec(id) {
  const specs = {
    institution:{title:'기본정보 수정',access:'admin',inline:true,fields:[textField('name','기관 이름','햇살연대'),textField('contact','업무 이메일','office@example.invalid')],impact:'기관 이름만 바뀝니다. 사업 이름이나 로그인 기관 코드는 바뀌지 않습니다.'},
    programs:{title:'사업 등록 시연',access:'admin',fields:[textField('name','어떤 사업을 등록할까요?','지역 동행'),selectField('team','어느 팀이 담당하나요?',['자립지원팀','생활회복팀','지역협력팀'],'지역협력팀'),selectField('storage','어디에 기록을 보관하나요?',[['later','나중에 정하기'],['seoul','기본형 Supabase 서울'],['naver','네이버 클라우드 공공형 (준비 중)',true]],'later','별도 ADR 전에는 네이버 공공형을 선택할 수 없습니다.'),selectField('processing','어디에서 처리하나요?',[['later','나중에 정하기'],['external','외부 허용'],['inside','기관 안']],'later','기관 안 처리는 기관 PC, 노트북 또는 서버가 필요합니다. 권장 사양과 STT 실측 승인 전에는 수기 경로를 사용합니다.')],impact:'저장 위치와 처리 경로는 기관이 계약 조건을 확인해 정합니다. 미선택이나 미확인은 나중에 정하기입니다. 종료는 기존 케이스 종결이나 삭제가 아닙니다.'},
    accounts:{title:'직원 초대 시연',access:'manager',fields:[textField('email','누구를 초대하나요?','new.staff@example.invalid','가상 이메일 하나만 입력합니다. 1회용 초대이며 메일은 발송하지 않습니다.'),selectField('role','어떤 역할로 초대하나요?',canAdmin()?['실무자','실무 책임자','기관 관리자','기관 기술 관리자']:['역할 대기'],canAdmin()?'실무자':'역할 대기')],impact:canAdmin()?'업무 역할과 팀 감독, 케이스 담당 배정은 서로 다른 관계입니다. 마지막 관리자의 역할은 대체자 없이 회수하지 않습니다.':'초대받은 계정은 역할 대기입니다. 업무 역할은 기관 관리자가 지정합니다.'},
    consent:{title:'다음 문안 작성',access:'admin',fields:[selectField('area','어느 동의 문안을 바꾸나요?',consentAreas,consentAreas[0]),{key:'copy',label:'당사자에게 어떻게 안내하나요?',type:'textarea',required:true,value:'상담 지원을 위해 필요한 개인정보를 수집하고 이용합니다. 보관 기간과 열람 범위는 동의서에서 확인할 수 있습니다.'},textField('version','어떤 버전으로 구분하나요?','2026-09-v3')],impact:'새 문안은 이후 동의에 사용합니다. 기존 동의의 결정이나 효력을 자동 변경하지 않습니다. 예시 문안은 운영 동의서가 아닙니다.'},
    retention:{title:'보관 기준 수정',access:'admin',inline:true,fields:[selectField('years','기본 보관 기간',['1년','2년','3년','4년','5년'],'1년')],impact:'마지막 활성 케이스 종결부터 셉니다. 기간 도래는 즉시 삭제가 아니라 아카이브 전환입니다. 비법적 보존은 종결 후 5년을 넘지 않습니다.'},
    exports:{title:'내보낼 범위 선택',access:'reader',fields:[selectField('scope','어떤 범위를 내보내나요?',canAdmin()?['기관 가명 통계','청년 자립 사업 집계','생활 회복 사업 집계']:state.role==='lead'?['자립지원팀 감독 범위']:['본인 담당 범위'],canAdmin()?'기관 가명 통계':state.role==='lead'?'자립지원팀 감독 범위':'본인 담당 범위'),selectField('format','어떤 파일 형식이 필요한가요?',['가명 통계 CSV','공식 기록 PDF'],'가명 통계 CSV'),selectField('period','어느 기간을 포함하나요?',['2026년 9월','2026년 8월','2026년 전체'],'2026년 9월')],impact:'선택 범위를 검토하는 시연입니다. 파일을 생성하거나 내려받지 않습니다. 실제 범위는 담당 및 감독 관계와 내보내기 권한을 서버가 검사해야 합니다.'},
    speech:{title:'음성 인식 연결 준비',access:'manager',connection:true,fields:[selectField('path','어떤 음성 인식 경로를 준비하나요?',[['off','사용 안 함'],['local','기관 안 로컬 STT (Q 승인 전)',true],['azure','Azure 외부 STT (준비만)']],'off','Azure에는 가림 처리 전 원음이 나갑니다. 녹음 및 외부 STT 동의가 필요합니다. 준비해도 STT는 off, 엔진은 null입니다.'),selectField('credential','자격 준비 예시는 어떤 상태인가요?',[['missing','자격 미준비 예시'],['fixture','가상 자격 준비 예시']],'fixture','실제 키를 받지 않습니다. 키 설정과 최종 시작은 기관 관리자만 담당합니다.')]},
    ai:{title:'AI 연결 준비',access:'manager',connection:true,fields:[selectField('path','텍스트 AI 경로를 어떻게 준비하나요?',[['off','사용 안 함'],['openai','OpenAI 준비']],'openai','OpenAI에는 장비가 가린 텍스트만 보내며 store:false를 사용합니다. 원음은 보내지 않습니다.'),selectField('credential','키 설정 예시는 어떤 상태인가요?',[['missing','키 미설정 예시'],['fixture','가상 키 등록 예시']],'fixture','실제 키 입력칸이 아닙니다. 키 등록 상태만 시연하며 기관 관리자가 지정합니다.')]},
    agent:{title:'로컬 에이전트 설치',access:'tech',fields:[selectField('device','어느 기관 장비에 설치하나요?',['상담지원 PC 01','상담지원 PC 02 (새 장비)'],'상담지원 PC 01'),selectField('masking','어떤 준비 상태를 확인하나요?',['이름 및 주소 가림 모델 준비 예시','모델 미설정 예시'],'이름 및 주소 가림 모델 준비 예시')],impact:'설치 순서만 시연합니다. 설치 파일이나 장비 명령을 보내지 않습니다. 가림 모델이 없으면 Agent 시작과 외부 AI 처리를 중단합니다.'},
    memory:{title:'기능 설정',access:'admin',inline:true,fields:[selectField('enabled','누적 맥락 갱신',[['off','사용 안 함'],['on','사용 준비']],state.scenario==='syncing'?'on':'off')],impact:state.scenario==='syncing'?'동기화가 가능한 설치 조건의 별도 가상 예시입니다. 여기서 고른 변경은 적용 전이며 실제 외부 호출은 없습니다.':'사용 준비를 선택해도 LLM off 또는 가림 스냅샷 없음 상태에서는 처리하지 않습니다. 기존 유효 결과의 처리 정책과 상담 화면 열람 권한을 바꾸지 않습니다.'},
    database:{title:'읽기 전용 사전 점검',access:'tech',fields:[selectField('target','어떤 저장소를 점검하나요?',['현재 Supabase 서울','Local Single 이전 후보','Local Office 이전 후보'],'현재 Supabase 서울'),selectField('scope','무엇을 확인하나요?',['리전, 권한, 기존 데이터, 버전, RLS, Auth, Storage'],'리전, 권한, 기존 데이터, 버전, RLS, Auth, Storage')],impact:'plan은 변경 없는 점검입니다. 실행 전후 지문이 같아야 하며 실제 이전은 백업과 별도 승인 뒤에 진행합니다. 연결 문자열은 받지 않습니다.'},
    storage:{title:'저장 대상 검토',access:'tech',fields:[selectField('kind','어떤 파일의 위치를 검토하나요?',['첨부파일','임시 원음'],'첨부파일'),selectField('target','어떤 저장 위치를 준비하나요?',['기관 소유 private Storage','Local 암호화 파일 (이전 검토)'],'기관 소유 private Storage')],impact:'선택 중 파일은 옮겨지지 않습니다. 원음 기한은 첫 처리 기회 +24시간과 업로드 +7일 중 빠른 때입니다. 처리 뒤에는 즉시 삭제합니다.'},
    backup:{title:'복원 준비',access:'manager',fields:[selectField('source','어떤 백업을 검토하나요?',['2026-09-09 / 검증된 백업 예시','2026-09-08 / 검증 전 예시'],'2026-09-09 / 검증된 백업 예시'),selectField('target','어디로 복원하나요?',['격리된 복구 대상','현재 설치 (중단 및 별도 승인 필요)'],'격리된 복구 대상')],impact:'기관 관리자 승인과 기술 관리자 실행 준비가 각각 필요합니다. 겸임자는 둘 다 할 수 있습니다. 실제 백업과 복원은 실행하지 않습니다.'},
    security:{title:'로그인 보호 검토',access:'tech',fields:[selectField('mfa','어떤 MFA 정책을 준비하나요?',['관리자 필수 / 직원 사용 권장','전체 직원 MFA 필수'],'관리자 필수 / 직원 사용 권장'),selectField('recovery','복구 절차를 확인했나요?',['복구 담당자와 수단 확인 전','복구 담당자와 수단 확인 예시'],'복구 담당자와 수단 확인 예시')],impact:'본인 또는 마지막 관리자가 로그인할 수 없게 되는 변경을 방지해야 합니다. 이 시연은 MFA를 등록하거나 해제하지 않으며 업무 역할을 부여하지 않습니다.'},
    updates:{title:'업데이트 적용 준비',access:'tech',fields:[selectField('version','어떤 버전을 준비하나요?',['2026.09.2 (가상 후보)'],'2026.09.2 (가상 후보)'),selectField('window','언제 중단 시간을 확보하나요?',['업무 종료 후 19:00','관리자와 시간 협의 전'],'업무 종료 후 19:00')],impact:'서명 manifest 검증, 업데이트 전 백업, 복구 가능 여부 확인 후에만 적용합니다. 이 시안은 설치나 되돌리기를 실행하지 않습니다.'},
    account:{title:'내 표시 이름 수정',access:'self',inline:true,fields:[textField('name','표시 이름','시연 사용자')],impact:'현재 시연 계정의 표시 이름만 바꿉니다. 역할이나 소속 팀은 변경하지 않습니다.'}
  };
  return specs[id];
}
function allowed(spec) {
  return spec.access === 'admin' ? canAdmin() : spec.access === 'tech' ? canTech() : spec.access === 'manager' ? canAdmin() || canTech() : true;
}
function draftFor(id) {
  if (!state.drafts[id]) {
    const spec = formSpec(id);
    const values=Object.fromEntries(spec.fields.map(field=>{
      const saved=state.applied[id]?.[field.key] ?? field.value;
      const permitted=field.type!=='select'||field.options.some(option=>Array.isArray(option)?option[0]===saved&&!option[2]:option===saved);
      return [field.key,permitted?saved:field.value];
    }));
    state.drafts[id] = {values,step:0,checked:false,confirmed:false,approved:false,keyPrepared:false};
  }
  return state.drafts[id];
}
function fieldMarkup(field, draft) {
  const id = `field-${state.module}-${field.key}`;
  const secretExample = field.key === 'credential';
  const disabled = secretExample && !canAdmin();
  let control;
  if (field.type === 'select') control = `<select id="${id}" data-field="${field.key}" ${disabled?'disabled':''}>${field.options.map(option => {const [value,label,off] = Array.isArray(option) ? option : [option,option];return `<option value="${esc(value)}" ${draft.values[field.key]===value?'selected':''} ${off?'disabled':''}>${esc(label)}</option>`;}).join('')}</select>${chevron}`;
  else if (field.type === 'textarea') control = `<textarea id="${id}" data-field="${field.key}" rows="5" maxlength="1200" ${field.required?'required':''}>${esc(draft.values[field.key])}</textarea>`;
  else control = `<input id="${id}" data-field="${field.key}" type="${field.key==='email'||field.key==='contact'?'email':'text'}" value="${esc(draft.values[field.key])}" maxlength="120" autocomplete="off" ${field.required?'required':''}>`;
  return `<div class="wire-form-field"><label class="wire-form-label" for="${id}">${esc(field.label)}${field.required?'<span class="wire-badge wire-required-marker"><span class="wire-badge-label">필수</span></span>':''}</label><span class="wire-input-box" ${field.type==='textarea'?'data-control="textarea"':''}>${control}</span>${field.help ? `<p class="wire-form-hint">${esc(field.help)}</p>` : ''}</div>`;
}
function valueLabel(field,value) { const option = field.options?.find(o=>Array.isArray(o)?o[0]===value:o===value); return Array.isArray(option)?option[1]:value; }
function impactMarkup(id,spec,draft) {
  const connection = spec.connection;
  let body = spec.impact || '실제 연결은 하지 않습니다.';
  if (connection) body = id === 'speech' ? 'Azure는 마스킹 전 원음이 나갑니다. 녹음과 외부 STT 동의가 필요합니다. 로컬 STT는 실측 및 Q 승인 전 사용할 수 없습니다.' : 'OpenAI에는 가림 처리된 텍스트만 나갑니다. 원음은 보내지 않습니다. 동의와 AI Packet 검증이 선행합니다.';
  return `<aside class="impact" aria-label="변경 영향"><h3 class="impact-title">변경 영향</h3>${rows([['선택한 내용',spec.fields.filter(f=>f.key!=='copy').map(f=>`${f.label}: ${valueLabel(f,draft.values[f.key])}`).join('\n')],['적용 범위',body],...(connection?[['사업별 상한','청년 자립: 외부 허용 / 생활 회복: 기관 안. 설치 설정과 사업 선택 중 더 좁은 범위만 사용합니다.'],['다시 확인할 사업','2개 사업 재확인 필요. 시연 적용 뒤에도 확인 필요 상태를 유지합니다.']]:[]),['실제 적용','연결 전 시안 / 서버 작업 없음']])}${related(id)}</aside>`;
}
function formMarkup(id) {
  const spec = formSpec(id);
  if (!spec) return '';
  if (!allowed(spec)) return card(spec.title,'읽기 전용',paragraph('이 역할에는 변경 조작을 제공하지 않습니다.')+related(id));
  const draft = draftFor(id);
  const reviewStep = spec.fields.length;
  const reviewing = !spec.inline && draft.step >= reviewStep;
  const field = spec.fields[draft.step];
  const editable = !['unavailable','disconnected'].includes(state.scenario);
  let body = spec.inline ? spec.fields.map(f=>fieldMarkup(f,draft)).join('') : reviewing ? rows(spec.fields.map(f=>[f.label,valueLabel(f,draft.values[f.key])])) : fieldMarkup(field,draft);
  if (reviewing) {
    if (spec.connection) body += section('연결 준비와 시작',paragraph(draft.checked?'시연 점검표를 확인했습니다. 실제 연결 상태는 확인하지 않았습니다.':'연결 대상과 가림 처리, 동의 조건을 확인하는 절차입니다.')+`<div class="actions">${button('준비 점검 시연','check',!canTech()||!editable)}${!canTech()?button('준비된 결과 예시 보기','prepared-fixture',!editable):''}${button('가상 키 설정 시연','key',!canAdmin()||!editable)}</div>`+rows([['연결 준비',draft.checked?'시연 확인':'기술 관리자 준비 전'],['키 설정',draft.keyPrepared?'가상 상태 지정':'기관 관리자 설정 전'],['실제 작동',id==='speech'?'STT off / 엔진 null':'LLM off / 실제 시작 안 함']]));
    if (id === 'backup') body += section('승인과 실행 준비',rows([['기관 관리자 승인',draft.approved?'시연 승인':'승인 전'],['기술 관리자 점검',draft.checked?'시연 확인':'확인 전']])+`<div class="actions">${button('복원 승인 시연','approve',!canAdmin()||!editable)}${!canAdmin()?button('기존 승인 예시 보기','approved-fixture',!editable):''}${button('복원 준비 점검 시연','check',!canTech()||!editable)}</div>`);
    if (id === 'programs') body += paragraph(draft.values.storage==='later'||draft.values.processing==='later'?'나중에 정하기가 남아 있어 도입 확인을 받지 않습니다. 사업은 준비 상태로만 등록하는 시연입니다.':'우리 기관이 저장 위치와 처리 경로의 조건을 확인하고 정한 내용입니다.');
    if(id!=='programs'||(draft.values.storage!=='later'&&draft.values.processing!=='later')) body += `<label class="wire-choice"><input type="checkbox" data-confirm ${draft.confirmed?'checked':''} ${!editable?'disabled':''}><span class="wire-choice-text">${id==='programs'?'기관에서 선택 조건을 확인했습니다.':'선택 내용과 변경 영향을 확인했습니다.'}</span></label>`;
  }
  const canApply = editable && (spec.inline || draft.confirmed || id==='programs'&&(draft.values.storage==='later'||draft.values.processing==='later')) && (!spec.connection || canAdmin() && draft.checked && (draft.values.path==='off' || draft.keyPrepared)) && (id!=='backup' || canTech() && draft.approved && draft.checked);
  const actionLabel = spec.connection?'최종 시작 절차 시연':id==='backup'?'복원 실행 절차 시연':['database','storage','agent','updates','exports','security'].includes(id)?'선택 확인 시연':'시연 적용';
  const controls = `<div class="actions">${!spec.inline?button('이전','prev',draft.step===0):''}${spec.inline||reviewing?button(actionLabel,'apply',!canApply,true):button('다음','next',!editable)}${button('입력 되돌리기','cancel')}</div>`;
  const steps = spec.inline?'':`<ol class="steps" aria-label="설정 단계">${spec.fields.map((_,i)=>`<li ${draft.step===i?'aria-current="step"':''}>질문 ${i+1}</li>`).join('')}<li ${reviewing?'aria-current="step"':''}>내용 확인</li></ol>`;
  return card(spec.title,reviewing?'확인 단계':spec.inline?'시연 입력':`질문 ${draft.step+1} / ${reviewStep}`,steps+`<div class="detail-grid"><form class="detail-fields" id="settings-form">${body}${controls}<p class="meta" id="form-result" role="status" tabindex="-1">${esc(state.notes[id]||'선택과 실제 적용은 다릅니다.')}</p></form>${impactMarkup(id,spec,draft)}</div>`);
}
function statusRows(m) {
  let data = m.rows;
  if (m.id === 'institution') data = data.map(([k,v])=>[k,k==='기관 이름'?state.applied.institution?.name||v:v]);
  if (m.id === 'retention') data = data.map(([k,v])=>[k,k==='기본 보관 기간'?state.applied.retention?.years||v:v]);
  if (m.id === 'account') data = [...data.map(([k,v])=>[k,k==='표시 이름'?state.applied.account?.name||v:v]),['역할 합',roleNames[state.role]],['역할 식별자',roleSets[state.role].join(' / ')]];
  if (m.id === 'accounts' && !canAdmin()) data = [['직원 계정','사용 중 12명 / 초대 대기 1명'],['대기 초대','new.staff@example.invalid / 역할 대기'],['업무 자료','기술 관리자 보기에서는 제공하지 않음']];
  if (m.id === 'exports' && !canAdmin()) data = [['허용 범위 예시',state.role==='lead'?'자립지원팀 감독 범위':'본인 담당 범위'],...data.slice(1)];
  if (m.id==='programs' && state.applied.programs) data=data.map(([k,v])=>[k,k==='등록 사업'?'4개 / 기존 진행 2개 / 신규 준비 1개 / 종료 1개':v]);
  if (m.id==='memory' && state.scenario==='syncing') data=[['기관 기능','동기화 중 (가상 조건)'],['설치 LLM','OpenAI 사용 가능 조건 예시 / 실제 호출 없음'],['가림 처리','스냅샷 준비된 가상 작업 2건'],['처리 완료 누계','126건 (이전 가상 이력)']];
  if (state.reconfirm && ['programs','speech','ai'].includes(m.id)) data = [...data,['사업 확인','진행 사업 2개 재확인 필요']];
  return data;
}
const stateReasons = {
  institution:['등록된 기관 기본정보가 없습니다.','기관 이용이 중지된 예시입니다. 기존 정보는 보관됩니다.','기관 기본정보 수정 API가 제공되지 않은 설치입니다.','기관 정보 조회가 실패했습니다. 저장된 값을 정상이라고 표시하지 않습니다.'],
  programs:['등록된 사업이 없습니다.','새 사업 등록이 중지되었습니다. 기존 케이스는 삭제되지 않습니다.','사업 도입 확인 API가 연결되지 않았습니다. 문구로 실데이터 잠금을 대신하지 않습니다.','사업 목록 조회에 실패했습니다. 도입 확인 상태를 추정하지 않습니다.'],
  accounts:['등록된 직원 목록이 없습니다.','직원 초대가 중지된 예시입니다.','계정 관리 기능이 이 설치에서 제공되지 않습니다.','초대 준비에 실패했습니다. 메일이 발송되었다고 표시하지 않습니다.'],
  consent:['등록된 동의 문안이 없습니다.','새 문안 적용이 중지되었습니다. 기존 동의는 그대로입니다.','기관 문안 버전 기능이 연결되지 않았습니다.','문안 조회에 실패했습니다. 기존 동의를 새 문안으로 승격하지 않습니다.'],
  retention:['검토 기한이 도래한 항목이 없습니다.','파기 실행 잠금이 꺼져 있습니다. 보관 검토는 별도입니다.','보관 검토 서비스가 제공되지 않습니다.','보관 검토를 불러오지 못했습니다. 실제 파기는 수행하지 않았습니다.'],
  exports:['생성 이력이 없습니다.','내보내기가 중지되었습니다. 상담 기록은 유지됩니다.','파일 생성 서비스가 연결되지 않았습니다.','파일 생성 실패 예시입니다. 선택 범위는 유지되고 다운로드는 없습니다.'],
  audit:['선택한 기간에 감사 사건이 없습니다.','감사 조회가 중지된 예시입니다. 감사 수집을 끄는 설정은 아닙니다.','감사 조회 서비스가 연결되지 않았습니다.','감사 조회에 실패했습니다. 오류를 사건 0건으로 바꾸지 않습니다.'],
  speech:['음성 인식 연결이 없습니다. STT off / 엔진 null입니다.','STT off / 엔진 null입니다. 수기 기록을 계속 사용합니다.','STT 실측 및 Q 승인 전입니다. 로컬 엔진은 선택할 수 없습니다.','음성 인식 연결 확인 실패 예시입니다. 다른 사업자로 전환하지 않습니다.'],
  ai:['AI 연결이 없습니다. LLM off입니다.','LLM off입니다. 수기 기록을 계속 사용합니다.','AI Packet 검증과 연결 서비스가 준비되지 않았습니다.','연결 확인 실패 예시입니다. 외부 AI 호출을 하지 않습니다.'],
  agent:['등록 장비가 없습니다. 로컬 에이전트 설치 안내를 확인하세요.','처리 장비가 중지되었습니다. 새 일감을 받지 않습니다.','이 설치에는 Agent 연결 기능이 제공되지 않습니다.','local_ner_unavailable: 가림 모델을 사용할 수 없어 AI 처리를 멈춘 예시입니다.'],
  memory:['처리 이력이 없습니다. 새 공식 기록부터 준비합니다.','누적 맥락 갱신이 꺼져 있습니다. 기존 처리 누계와 기록은 삭제되지 않습니다.','기관 메모리 설정 API가 연결되지 않았습니다.','evidence_hash_mismatch: 근거 검증이 실패한 가상 작업 2건입니다. 원문을 이 화면에 보내지 않습니다.'],
  database:['등록된 DB 연결 정보가 없습니다.','DB 점검이 중지되었습니다. 연결을 해제한 것은 아닙니다.','이 모드의 DB 이전 서비스가 제공되지 않습니다.','사전 점검 실패 예시입니다. 연결 문자열과 공급자 원문 오류를 표시하지 않습니다.'],
  storage:['보관 중인 첨부파일과 원음이 없습니다.','새 파일 업로드가 중지되었습니다. 기존 파일을 삭제하지 않습니다.','선택 대상의 암호화 저장 어댑터가 준비되지 않았습니다.','저장 대상 확인이 실패했습니다. 파일을 옮기지 않았습니다.'],
  backup:['보관된 백업이 없습니다.','자동 백업 일정이 꺼진 예시입니다.','백업 및 복원 서비스가 연결되지 않았습니다.','백업 검증 실패 예시입니다. 이 파일로 복원할 수 없습니다.'],
  security:['로그인 보호 현황을 등록하기 전입니다.','직원 MFA 권장 안내가 꺼진 예시입니다. 관리자 MFA 필수는 유지합니다.','이 설치 모드의 인증 설정 변경을 지원하지 않습니다.','MFA 정책 확인에 실패했습니다. 기존 로그인 보호를 해제하지 않습니다.'],
  system:['진단 결과를 받은 적이 없습니다.','정기 진단이 중지된 예시입니다.','설치 capability를 확인할 수 없습니다. 지원 기능을 추정하지 않습니다.','진단 서비스 응답 실패 예시입니다. 정상 상태나 꺼짐으로 바꾸지 않습니다.'],
  updates:['확인된 릴리스 후보가 없습니다.','업데이트 자동 확인이 꺼져 있습니다.','서명된 설치 및 업데이트 서비스가 제공되지 않습니다.','후보 서명 검증 실패 예시입니다. 설치하지 않고 현재 버전을 유지합니다.'],
  account:['본인 계정 정보를 불러오기 전입니다.','본인 계정 사용이 중지된 예시입니다. 계정 상태를 직접 바꾸지 않습니다.','본인 정보 수정 API가 제공되지 않습니다.','계정 정보 조회 실패 예시입니다. 권한을 임의로 추정하지 않습니다.'],
  guide:['등록된 안내 항목이 없는 상태 예시입니다.','오프라인 안내 상태입니다. 아래 정적 설명은 읽을 수 있습니다.','이 환경에는 최신 매뉴얼 동기화가 제공되지 않습니다.','매뉴얼 갱신 실패 예시입니다. 아래 정적 안내를 확인하세요.']
};
function scenarioPanel(m) {
  if (state.scenario==='basic') return '';
  const index = {empty:0,off:1,unavailable:2,failure:3}[state.scenario];
  const reason = index !== undefined ? stateReasons[m.id][index] : state.scenario==='conflict' ? '409 충돌 예시: 다른 변경이 먼저 반영되어 적용하지 않았습니다. 입력값은 유지합니다. 기본 가상 자료로 돌아가 다시 확인하세요.' : state.scenario==='disconnected' ? '연결 끊김 예시: 마지막 폴링 7시간 전입니다. 현재 상태를 정상으로 추정하지 않으며 새 처리는 시작하지 않습니다.' : state.scenario==='masking' ? '가림 처리 대기 4건입니다. 스냅샷 준비 전에는 외부 호출과 누적 맥락 갱신을 하지 않습니다.' : '가상 동기화 중 2건 / 대기 4건입니다. 기존 유효 결과를 새 미검증 결과로 덮지 않습니다.';
  return card('상태 시연',scenarioNames[state.scenario],paragraph(reason)+`<div class="actions">${button('기본 가상 자료로 돌아가기','basic')}${link('문제 해결 안내','guide',m.id)}</div>`);
}
function detailsFor(id) {
  switch(id) {
    case 'institution': return card('기관 운영 기준','가상 자료',section('사업과 구성',rows([['진행 사업','청년 자립 / 생활 회복'],['종료 사업','2025 재도약'],['업무 연락처',state.applied.institution?.contact||'office@example.invalid']])));
    case 'programs': return card('등록 사업','가상 목록',list([...basePrograms.map(([name,status,description])=>item(name,description,state.reconfirm && status!=='종료'?'재확인 필요':status,button('운영 상태 보기 시연',`program:${name}`))),...(state.applied.programs?[item(state.applied.programs.name,`${state.applied.programs.team} / 신규 케이스 0개`,state.applied.programs.admitted?'도입 확인 시연':'도입 확인 전')]:[])])+paragraph(state.notes.programStatus||'사업 종료는 신규 운영을 멈추는 선택입니다. 케이스 일괄 종결이나 삭제를 하지 않습니다.'));
    case 'accounts': return card('직원과 초대','가상 목록',list([item('시연 운영 담당','admin@example.invalid / 사용 중','관리자',canAdmin()?button('역할 변경 검토 시연','role-review'):''),item('시연 기술 담당','tech@example.invalid / 사용 중','기술 관리자'),item('새 직원 초대',state.applied.accounts?.email||'new.staff@example.invalid',state.applied.accounts?.role||'초대 대기')])+(canAdmin()?section('팀 감독과 배정 요청',rows([['자립지원팀','5명 / 실무 책임자 1명'],['생활회복팀','4명 / 실무 책임자 1명'],['지역협력팀','3명 / 실무 책임자 1명']])+`<div class="actions">${button('공동 담당 검토 시연','assignment')}${button('이관 검토 시연','transfer')}</div>`):'')+paragraph(state.notes.accountAction||'계정의 사용 상태와 업무 권한을 따로 관리합니다.'));
    case 'consent': return card('기관 동의 문안','가상 문안',list(consentAreas.map((name,i)=>item(name,['상담 지원 목적의 수집 항목, 열람 범위와 보관 기간을 안내합니다.','건강 등 민감정보의 목적과 입력 범위를 따로 안내합니다.','녹음하지 않아도 수기 기록으로 상담할 수 있습니다.','Azure는 가림 처리 전 원음이 외부로 나갑니다.','OpenAI에는 장비가 가린 텍스트만 나갑니다.','처리 뒤 즉시 삭제하며 업로드 후 7일을 넘기지 않습니다.'][i],'2026-09-v2')))+section('문안 초안',paragraph(state.applied.consent?`${state.applied.consent.version}: ${state.applied.consent.copy}`:'새 문안 v3을 작성 중입니다. 현재 당사자의 동의는 변경되지 않습니다.')));
    case 'retention': return card('보존 검토 대상','가상 3건',list([item('검토 R-101','종결 1년 경과 / 연장 동의 확인 필요','아카이브',button('보존 검토 시연','retain')),item('검토 R-102','진행 중 업무 사유 / 종결 후 5년 상한 이내','검토 중'),item('검토 R-103','법적 보존 근거 확인 필요 / 별도 승인 대상','파기 잠금',button('파기 조건 보기','purge'))])+paragraph(state.notes.retentionAction||'PII_PURGE_ENABLED=1과 기관 관리자 승인이 모두 있어야 최종 파기합니다. 이 시안에서는 파기하지 않습니다.'));
    case 'exports': return card('생성 이력','가상 예시',list([item('9월 업무 집계',canAdmin()?'기관 가명 통계 / CSV / 2026-09-08':'내 허용 범위 / CSV / 2026-09-08','완료 이력 예시'),item('8월 업무 보고','공식 기록 / PDF / 2026-09-03','실패 이력 예시')])+paragraph('예시 이력에는 내려받을 파일이 없습니다. 선택을 확인해도 생성 완료 상태로 바꾸지 않습니다.'));
    case 'audit': return auditPanel();
    case 'speech': return card('전송 경로','승인 전',list([item('사용 안 함','설치 기본값 off / 수기 기록 사용','기본값'),item('기관 안 로컬 STT','기관 장비 필요 / 실측 및 Q 승인 전 engine null','사용 불가'),item('Azure 외부 STT','마스킹 전 원음 전송 / 녹음 및 외부 STT 동의 필요','준비만')])+paragraph('건강한 Agent와 유효한 동의가 없으면 업로드를 받지 않는 경로입니다. 이 화면은 그 서버 잠금의 구현 증거가 아닙니다.'));
    case 'ai': return card('시작 전 조건','4개 확인',list([item('키 등록 상태','가상 키 준비 상태만 지정 / 실제 키 입력 없음','미설정 예시'),item('연결 준비','대상, 장비, 유효 동의 및 사업 조건 확인','점검 전'),item('가림 처리 및 검증','스냅샷 없음, 식별자 검출, hash 불일치면 외부 호출 중지','시작 조건'),item('사업 도입 확인','설치와 사업 허용 범위의 교집합만 사용합니다.','별도 확인')]));
    case 'agent': return card('처리 장비','가상 상태',section('상담지원 PC 01',rows([['운영체제','Windows 기관 장비 예시'],['Agent 버전','2026.09.1'],['원음 작업','0건'],['텍스트 작업','가림 대기 4건']]))+section('준비 점검',list([item('이름 및 주소 가림','한국어 가림 모델 준비 상태 예시','준비 예시'),item('폴링 중단 알림','6시간 이상 폴링 중단 시 관리자에게 알림','6시간 기준')]))+`<div class="actions">${link('업데이트 보기','updates')}</div>`);
    case 'memory': return card('처리 현황','기관 집계',rows([['기관 기능',state.scenario==='syncing'?'동기화 중 (가상 조건)':state.applied.memory?.enabled==='on'?'사용 준비 시연 / 설치 LLM off로 처리 중지':'꺼짐'],['처리 완료 누계','126건 (이전 가상 이력)'],['가림 처리 대기','4건'],['재시도 대기','2건 / 처리 오류'],['이번 처리',state.scenario==='syncing'?'2건 진행 예시 / 실제 외부 호출 없음':'0건 / 외부 호출 없음']])+paragraph('이 설정에는 당사자별 기억 내용이나 승인 및 정정 작업을 두지 않습니다.'));
    case 'database': return card('변경 없는 점검 항목','plan',list([item('접속과 위치','서울 리전 / 읽기 권한 / 설치 대상 일치','읽기 전용'),item('기존 자원','데이터 존재 / 설치 버전 / RLS / Auth / Storage','변경 없음'),item('점검 지문','실행 전후 자원 지문 비교가 필요합니다.','실측 전')])+`<div class="actions">${link('백업 및 복원 보기','backup')}</div>`);
    case 'storage': return card('파일별 보관 기준','가상 자료',section('임시 원음',rows([['현재 원음','0건'],['삭제 기한','min(첫 처리 기회 +24시간, 업로드 +7일)'],['처리 완료 후','즉시 삭제 / 삭제 증거 기록']] ))+section('첨부파일',rows([['가상 사용량','2.4 GB / 320개'],['접근','기관 소유 private Storage / 업무 권한 검사'],['위치 변경','검토 전 / 실제 이동 없음']])));
    case 'backup': return card('백업 이력','가상 자료',list([item('2026-09-09 02:00','암호화 .cccx / 2.4 GB / 격리 복원 검증 예시','검증 이력'),item('2026-09-08 02:00','암호화 .cccx / 2.4 GB / 복원 검증 전','검증 전'),item('2026-09-07 02:00','대상 저장소 용량 부족 / 보관 위치 확인','실패 이력')])+paragraph('백업 이력을 누적한 예시일 뿐입니다. 실제 백업 생성, 검증, 복원은 실행하지 않습니다.'));
    case 'security': return card('모드별 로그인 보호','현황 예시',list([item('Community Cloud','기관 소유 Supabase Auth / 관리자 MFA','현재 모드'),item('Local Office','Argon2id 로컬 계정 / 관리자 MFA / 내부망 HTTPS','모드 안내'),item('Local Single','OS 사용자 / 앱 잠금 / 127.0.0.1 전용','모드 안내')])+`<div class="actions">${link('내 정보 보기','account')}</div>`);
    case 'system': return card('점검 항목','가상 진단',list([item('데이터베이스','서울 / 마지막 응답 예시 42ms','정상 예시',link('연결 설정','database')),item('AI 연결','STT off / LLM off / 실제 호출 없음','꺼짐',link('AI 연결 설정','ai')),item('처리 장비','텍스트 가림 대기 4건 / 녹음 0건','대기',link('장비 설정','agent'))])+section('진단 보고서',paragraph('코드, 비식별 작업 ID, 시각만 다루는 진단입니다. 키나 공급자 원문 오류를 포함하지 않습니다.')+button('보고서 범위 시연','diagnostic')));
    case 'updates': return card('릴리스와 복구','가상 예시',section('2026.09.2 변경 내용',list([item('설치 점검 표시 개선','현재 버전과 준비 결과를 구분하는 가상 릴리스','후보'),item('되돌리기 대상','2026.09.1 / 업데이트 전 백업 필요','현재 버전 유지')]))+section('적용 조건',rows([['서명 검증','실제 검증 전'],['업데이트 전 백업','생성 및 검증 전'],['복구 결과','실행 안 함']])));
    case 'account': return card('본인 계정과 요청','가상 자료',section('계정 보호',rows([['로그인 이메일','staff@example.invalid'],['MFA','설정 예시 / 실제 등록 안 함']])+button('MFA 변경 안내','mfa'))+(roleSets[state.role].includes('worker')?section('내게 온 배정 요청',item('청년 자립 공동 담당 요청','요청 A-001 / 수락 후 담당 범위에 추가되는 예시',state.applied.assignment?'수락 시연':'수락 전',button('배정 요청 수락 시연','accept',Boolean(state.applied.assignment)))):''));
    case 'guide': return guidePanel();
    default: return '';
  }
}
function auditPanel() {
  const filter = state.applied.auditFilter || '전체';
  const events = [['열람','2026-09-09 09:10','시연 운영 담당','기관 설정'],['변경','2026-09-09 09:00','시연 운영 담당','동의 문안 초안'],['복호화','2026-09-08 16:30','시연 실무자','권한 있는 조회 / 식별값 미표시'],['내보내기','2026-09-08 15:20','시연 운영 담당','가명 통계'],['변경','2026-09-08 11:00','시연 운영 담당','팀 감독 지정']].filter(e=>filter==='전체'||e[0]===filter);
  return card('감사 사건','가상 목록',`<label class="wire-form-field"><span class="wire-form-label">사건 종류</span><span class="wire-input-box"><select id="audit-filter">${['전체','열람','변경','복호화','내보내기'].map(v=>`<option ${filter===v?'selected':''}>${v}</option>`).join('')}</select>${chevron}</span></label>`+list(events.map(([kind,time,actor,target])=>item(target,`${time} / ${actor}`,kind))));
}
const guideCopy = {
  institution:'기관 이름은 표시용 정보입니다. 사업 이름과 로그인 기관 코드를 함께 덮어쓰지 않습니다.',
  programs:'사업 등록에서 저장 위치와 처리 경로를 따로 고릅니다. 조건을 나중에 정하거나 확인하지 않았다면 실제 자료 생성과 AI 사용 조건을 충족하지 않은 상태입니다. 설치 STT 또는 LLM 설정과 문안 버전이 바뀌면 사업별로 다시 확인합니다. 판단은 사용기관이 합니다.',
  accounts:'기관 관리자는 업무 역할과 팀 감독, 담당 배정을 관리합니다. 기술 관리자만 초대하면 가입자는 역할 대기입니다. 초대는 이메일 하나, 1회용입니다. 마지막 기관 관리자와 마지막 기술 관리자는 대체자를 정하기 전 비활성화하지 않습니다.',
  consent:'개인정보, 민감정보, 녹음, 외부 STT, 외부 LLM 및 국외 처리, 음성 보유기간의 여섯 영역입니다. 문안 버전과 hash를 동의 사건에 남기고 과거 동의를 새 동의로 자동 승격하지 않습니다.',
  retention:'마지막 활성 케이스 종결부터 보존 시계가 시작됩니다. 기간 도래 시 먼저 암호화 아카이브로 이동합니다. 연장 동의, 진행 업무, 법적 보존 근거를 검토하고 별도 파기 승인을 받습니다. 비법적 보존 상한은 종결 후 총 5년입니다.',
  exports:'가명 통계와 공식 기록의 업무 반출입니다. .cccx 복원용 백업이 아닙니다. 담당 및 감독 범위, 기관 정책과 감사 기록을 확인합니다. 409나 실패 뒤에도 선택 범위를 보존해야 합니다.',
  audit:'열람, 변경, 개인정보 복호화와 내보내기를 추가 전용 이력으로 남깁니다. 기술 관리자에게 상담 자료를 보내지 않습니다. 조회 실패는 사건 없음과 다릅니다.',
  speech:'설치 기본값은 STT off, 승인 전 엔진은 null입니다. Azure는 마스킹 전 원음이 나가므로 녹음과 외부 STT 동의가 필요합니다. 기관 안 처리는 기관 PC, 노트북 또는 서버가 필요하며 권장 사양과 STT-G1~G3 결과 승인 전에는 수기 경로를 사용합니다.',
  ai:'기술 관리자는 연결을 준비하고 기관 관리자는 키 설정과 최종 시작을 담당합니다. 겸임자는 한 흐름에서 수행할 수 있습니다. OpenAI에는 장비가 가린 텍스트만 보내며 store:false를 사용합니다. 설정과 사업 선택 중 좁은 범위만 사용하고 실패 시 다른 사업자로 자동 전환하지 않습니다.',
  agent:'로컬 에이전트 설치는 기관의 처리 장비를 준비하는 절차입니다. STT 또는 텍스트 AI 사용 시 기관 장비 1대가 필요합니다. 가림 모델이 준비되지 않으면 시작하지 않습니다. 6시간 폴링 중단 시 전원, 네트워크, Agent 실행 상태를 확인합니다.',
  memory:'설정에서는 기관 기능과 가림 대기, 동기화 중, 실패 집계만 봅니다. 당사자별 내용과 근거, 승인 및 정정은 상담 화면의 담당 권한 아래 둡니다. 가림 스냅샷이 없으면 외부 처리하지 않습니다.',
  database:'첫 공개 동작 plan은 읽기 전용입니다. 리전과 권한, 기존 데이터, 설치 버전, RLS, Auth, Storage를 확인하고 실행 전후 지문이 같아야 합니다. 변경은 백업과 승인 뒤 별도 단계입니다.',
  storage:'Community Cloud는 기관 소유 private Storage, Local은 암호화 파일을 사용합니다. 원음은 동의와 건강한 Agent가 있어야 받고 처리 직후 삭제합니다. 업로드 후 7일과 첫 처리 기회 후 24시간 중 빠른 기한을 넘기지 않습니다.',
  backup:'암호화 .cccx와 검증 이력을 확인합니다. 기관 관리자가 복원을 승인하고 기술 관리자가 실행을 준비합니다. 백업 검증은 복원 완료가 아닙니다. 검증되지 않은 백업으로 복원하지 않습니다.',
  security:'로그인 보호와 업무 접근 권한은 별개입니다. Cloud는 Supabase Auth 및 MFA, Office는 로컬 계정과 관리자 MFA, Single은 OS 사용자와 앱 잠금입니다. 로그인 복구 수단을 확인한 뒤 정책을 바꿉니다.',
  system:'진단은 기능 가용성이지 사람의 접근 권한이 아닙니다. 응답 실패를 정상이나 off로 표시하지 않습니다. 코드와 비식별 작업 ID 및 시각만 보고하고 비밀값이나 공급자 원문 오류는 표시하지 않습니다.',
  updates:'서명된 manifest 검증, 업데이트 전 백업, 적용, 장애 시 되돌리기 순서입니다. 후보 버전을 확인했다고 설치가 끝난 것은 아닙니다.',
  account:'역할은 합으로 표시합니다. 실무자는 담당 배정된 케이스를 작성하고 실무 책임자는 지정 팀을 읽기 전용으로 감독합니다. 본인에게 온 배정 요청 수락과 기관 전체 배정 관리는 다른 화면입니다.'
};
function guidePanel() {
  const topic = moduleById(state.topic);
  const order = ['institution','database','storage','programs','consent','accounts','agent','speech','ai','backup'];
  return card('초기 설정 순서','안내',paragraph('기관 설치 후 기본정보와 저장 위치를 확인하고 사업 및 동의 조건을 정합니다. AI는 준비와 사용 시작을 나눕니다.')+`<ol class="guide-order">${order.filter(id=>visible().some(m=>m.id===id)).map(id=>`<li>${link(moduleById(id).title,id)}</li>`).join('')}</ol>`)
    +card('역할별 사용 범위','프리뷰 정책',rows([['기관 관리자','기관 및 업무 정책 / AI 키 설정과 최종 시작 / 복원 승인'],['기관 기술 관리자','계정과 연결 준비 / 장비 및 로그인 보호 / 승인 후 복원 실행 준비 / 상담 자료 열람 없음'],['실무 책임자','지정 팀 읽기 전용 감독 / 허용된 내보내기'],['실무자','본인 담당 케이스 작성 / 본인 배정 요청 수락'],['겸임','보유한 역할의 합 / 업무 쓰기는 실무자 역할과 담당 배정 모두 필요'],['전체 둘러보기','모든 가상 화면을 보는 시안 도구 / 운영 권한 아님']]))
    +(topic && topic.id!=='guide' ? card(`${topic.title} 사용법`,'관련 안내',paragraph(guideCopy[topic.id])+`<div class="actions">${visible().some(m=>m.id===topic.id)?link(`${topic.title}로 돌아가기`,topic.id):''}</div>`,'guide-topic') : '')
    +card('기능별 안내','목차',list(visible().filter(m=>m.id!=='guide').map(m=>item(m.title,guideCopy[m.id],'안내',link('설정 화면 보기',m.id)))))
    +card('사업 조건 확인과 문제 해결','안내',section('확인하는 법',paragraph('기록을 어디에 보관해야 하는 조건이 있는 경우 사용기관의 사업 지침과 계약 조건을 확인하세요. 외부 처리가 제한되는 경우 기관 안 경로를 검토하세요. 선택을 확정하기 어렵다면 나중에 정하기로 두세요.')+paragraph('기존 매뉴얼: docs/manual/project-admission-check.md. 정적 서버 허용 범위 밖의 문서라 이 시안에서는 원문을 제공하지 않습니다.'))+section('실패 후 다시 확인',rows([['403','권한 확인 / 역할 선택은 프리뷰에서만 가능'],['409','입력 유지 / 최신 조건 확인 후 다시 시도'],['503 또는 연결 끊김','기능 사용 가능 여부와 장비 상태 확인 / 다른 사업자로 자동 전환하지 않음'],['미지원','지원 서비스 연결 전 실행 불가 / 성공 표시 금지']])));
}
function renderNavigation() {
  const entries = visible();
  if (state.module==='work') {
    $('#navigation').innerHTML = `<div class="navigation-group"><p class="navigation-section-title">업무 공간 시연</p>${['일정','당사자 목록'].map((name,i)=>`<a class="navigation-link" href="${esc(routeURL('work'))}" data-work="${i===0?'일정':'당사자 목록'}">${icon(i===0?'clock':'people')}<span>${name}</span></a>`).join('')}</div><div class="navigation-independent">${link('설정으로 이동',defaultModule())}</div>`;
  } else {
    const navLink = m=>`<a class="navigation-link" href="${esc(routeURL(m.id))}" data-route="${m.id}" ${state.module===m.id?'aria-current="page"':''}>${icon(m.icon)}<span>${m.title}</span></a>`;
    $('#navigation').innerHTML = groups.map((name,i)=>{const children=entries.filter(m=>m.group===i);return children.length?`<div class="navigation-group"><p class="navigation-section-title" id="settings-group-${i}">${name}</p><div class="navigation-items" role="group" aria-labelledby="settings-group-${i}">${children.map(navLink).join('')}</div></div>`:'';}).join('')+entries.filter(m=>m.group===null).map(m=>`<div class="navigation-independent">${navLink(m)}</div>`).join('');
  }
  $('.sidebar-return').hidden = state.module==='work';
  $('[data-route="work"]')?.setAttribute('href',routeURL('work'));
}
function render() {
  renderNavigation();
  $('#role').value = state.role;
  $('#scenario').innerHTML = scenariosFor(state.module).map(id=>`<option value="${id}" ${state.scenario===id?'selected':''}>${scenarioNames[id]}</option>`).join('');
  document.querySelectorAll('[data-institution]').forEach(el=>el.textContent=state.applied.institution?.name||'햇살연대');
  const m = moduleById(state.module);
  const permitted = m && visible().some(entry=>entry.id===m.id);
  const title = state.module==='work'?'업무 공간 시연':!m?'없는 설정 화면':!permitted?'접근할 수 없는 설정':m.title;
  $('#page-title').textContent = title;
  $('#header-title').textContent = state.module==='work'?'업무 공간 / 시연':`설정 / ${title}`;
  $('#page-description').textContent = permitted ? m.purpose : '실제 업무 서비스와 연결되지 않은 독립 시안입니다.';
  document.title = `${title} | CCC 시연`;
  if (state.module==='work') $('#content').innerHTML = card('업무 메뉴로 돌아왔습니다.','시연',paragraph('이 아티팩트에는 상담 업무 화면이 없습니다. 같은 사이드바를 업무 메뉴 상태로 바꾸었습니다. 실제 일정이나 당사자 자료를 불러오지 않습니다.')+`<div class="actions">${link('설정으로 이동',defaultModule())}</div><p class="meta" id="work-result" role="status"></p>`);
  else if (!permitted) $('#content').innerHTML = card(title,m?'권한 없음':'404',paragraph(m?'선택한 가상 역할에는 이 메뉴를 제공하지 않습니다. 역할 변경은 프리뷰 조건에서만 가능합니다.':'알 수 없는 메뉴 ID입니다. URL을 확인하거나 허용된 설정으로 이동하세요.')+`<div class="actions">${link('허용된 설정으로 이동',defaultModule())}</div>`);
  else {
    const normal = ['basic','conflict','masking','syncing'].includes(state.scenario);
    const current = m.id==='guide'?'':card('현재 설정',state.scenario==='basic'?m.status:scenarioNames[state.scenario],normal?rows(statusRows(m)):paragraph(state.scenario==='empty'?'현재 조회 결과가 없습니다. 아래 입력은 새 설정을 준비하는 가상 예시입니다.':state.scenario==='off'?'작동이 중지된 상태 예시입니다. 아래 선택은 다시 준비하는 시연이며 실제 작동 상태를 바꾸지 않습니다.':state.scenario==='unavailable'?'현재 설치에서 이 기능을 제공하지 않습니다. 아래 입력 예시는 적용할 수 없습니다.':'현재 값을 확인할 수 없습니다. 아래 입력은 마지막 시연 초안이며 정상 응답이 아닙니다.'));
    $('#content').innerHTML = scenarioPanel(m)+current+(normal||m.id==='guide'?detailsFor(m.id):'')+formMarkup(m.id)+(m.id==='guide'?'':related(m.id));
  }
}
function announce(text) { $('#announcement').textContent = text; }
function clearDrafts() { state.drafts={};state.notes={}; }
function readRoute() {
  const p = new URLSearchParams(location.search);
  const role = Object.hasOwn(roleNames,p.get('role')) ? p.get('role') : 'all';
  if (state.role!==role) clearDrafts();
  state.role = role;
  state.module = p.get('module') || defaultModule();
  state.scenario = scenariosFor(state.module).includes(p.get('state')) ? p.get('state') : 'basic';
  state.topic = moduleById(p.get('topic'))?.id || '';
  // Canonical URLs contain only allowlisted state, never form values or return URLs.
  history.replaceState(null,'',routeURL(state.module,state.topic));
}
function navigate(id,topic='') {
  if (state.drafts[state.module]) {state.drafts[state.module].confirmed=false;state.drafts[state.module].approved=false;}
  state.module=id;state.topic=topic;
  if (!scenariosFor(id).includes(state.scenario)) state.scenario='basic';
  history.pushState(null,'',routeURL(id,topic));
  setDrawer(false,false);render();announce('');$('#page-title').focus();window.scrollTo(0,0);
  if (topic) $('#guide-topic')?.scrollIntoView({block:'start'});
}
function setDrawer(open,restoreFocus=true) {
  state.drawer=open && matchMedia('(max-width: 767px)').matches;
  document.body.classList.toggle('drawer-open',state.drawer);
  $('#scrim').hidden=!state.drawer;
  $('#open-menu').setAttribute('aria-expanded',String(state.drawer));
  $('#main').inert=state.drawer;$('.app-header').inert=state.drawer;
  if(state.drawer){$('#sidebar').setAttribute('role','dialog');$('#sidebar').setAttribute('aria-modal','true');$('#close-menu').focus();}
  else {$('#sidebar').removeAttribute('role');$('#sidebar').removeAttribute('aria-modal');if(restoreFocus && matchMedia('(max-width: 767px)').matches)$('#open-menu').focus();}
}
function validateCurrentForm() {
  const form=$('#settings-form');
  if(form&&!form.reportValidity())return false;
  const d=state.drafts[state.module];
  if(d && formSpec(state.module).fields.some(field=>field.required&&!String(d.values[field.key]).trim())){announce('빈 입력을 채워 주세요. 시연 값은 유지했습니다.');return false;}
  return true;
}
function operationFailure() {
  if(['failure','conflict','unavailable','disconnected'].includes(state.scenario)) {
    state.notes[state.module] = `${scenarioNames[state.scenario]} 시연: 적용하지 않았습니다. 입력값은 유지했습니다. 실제 요청은 없습니다.`;
    render();$('#form-result')?.focus();announce(state.notes[state.module]);return true;
  }
  return false;
}
function handleFormAction(action) {
  const id=state.module,spec=formSpec(id);
  if(!spec||!allowed(spec))return;
  const d=draftFor(id);
  if(action==='cancel'){delete state.drafts[id];delete state.notes[id];render();$('#settings-form input, #settings-form select')?.focus();return;}
  if(action==='prev')d.step=Math.max(0,d.step-1);
  if(action==='next'){if(!validateCurrentForm())return;d.step=Math.min(spec.fields.length,d.step+1);}
  if(['check','key','approve','apply','prepared-fixture','approved-fixture'].includes(action)&&operationFailure())return;
  if(action==='prepared-fixture'&&spec.connection&&canAdmin()&&!canTech()){
    d.checked=true;state.notes[id]='프리뷰 조건: 기술 관리자가 미리 준비한 가상 결과를 불러왔습니다. 이 역할이 연결 점검을 실행한 것은 아닙니다.';
  }
  if(action==='approved-fixture'&&id==='backup'&&canTech()&&!canAdmin()){
    d.approved=true;state.notes[id]='프리뷰 조건: 기관 관리자의 기존 승인 예시를 불러왔습니다. 이 역할이 복원을 승인한 것은 아닙니다.';
  }
  if(action==='check'&&canTech()) {
    if((id==='backup'&&d.values.source.includes('검증 전'))||(spec.connection&&d.values.path!=='off'&&d.values.credential==='missing'))state.notes[id]='준비 조건 미충족 시연입니다. 입력은 유지하며 실제 점검을 하지 않았습니다.';
    else {d.checked=true;state.notes[id]='준비 점검표를 확인하는 시연입니다. 실제 연결 또는 백업 검증 결과가 아닙니다.';}
  }
  if(action==='key'&&canAdmin()){d.keyPrepared=d.values.credential==='fixture';state.notes[id]=d.keyPrepared?'가상 키 등록 상태를 지정했습니다. 실제 키는 받거나 저장하지 않았습니다.':'키 미설정 예시입니다. 최종 시작 조건을 충족하지 않습니다.';}
  if(action==='approve'&&canAdmin()){d.approved=true;state.notes[id]='복원 승인 시연입니다. 실제 승인이나 복원은 발생하지 않았습니다.';}
  if(action==='apply') {
    if(!validateCurrentForm()||(!spec.inline&&!d.confirmed&&!(id==='programs'&&(d.values.storage==='later'||d.values.processing==='later'))))return;
    if(spec.connection&&(!canAdmin()||!d.checked||(d.values.path!=='off'&&!d.keyPrepared)))return;
    if(id==='backup'&&(!canTech()||!d.checked||!d.approved))return;
    if(id==='security'&&d.values.recovery.includes('확인 전')){state.notes[id]='로그인 복구 수단 확인이 먼저입니다. 입력을 유지하고 적용하지 않았습니다.';}
    else if(id==='agent'&&d.values.masking.includes('미설정')){state.notes[id]='가림 모델이 없어 시작 조건을 충족하지 않습니다. 실제 설치는 하지 않았습니다.';}
    else {
      const previous=state.applied[id];
      state.applied[id]={...d.values};
      if(id==='programs')state.applied[id].admitted=d.values.storage!=='later'&&d.values.processing!=='later'&&d.confirmed;
      if(spec.connection){state.reconfirm ||= (previous?.path ?? 'off')!==d.values.path;state.notes[id]='최종 시작 절차를 시연했습니다. 실제 STT와 LLM은 off, STT 엔진은 null입니다. 2개 사업 재확인은 별도로 남습니다.';}
      else if(['backup','database','storage','exports','agent','updates','security'].includes(id))state.notes[id]='선택과 확인 절차만 시연했습니다. 실제 실행, 파일 생성, 연결 변경, 설치는 하지 않았습니다.';
      else state.notes[id]='시연 값을 이 페이지 메모리에만 적용했습니다. 실제 자료와 계정은 변경하지 않았습니다.';
      d.confirmed=false;
      if(id==='backup'){d.approved=false;d.checked=false;}
    }
  }
  render();
  if(['prev','next'].includes(action))$('#settings-form input, #settings-form select, #settings-form textarea')?.focus();else $('#form-result')?.focus();
  announce(state.notes[id]||'시연 단계만 이동했습니다. 아직 적용하지 않았습니다.');
}
$('#content').addEventListener('submit',e=>{e.preventDefault();handleFormAction(formSpec(state.module)?.inline?'apply':'next');});
$('#content').addEventListener('input',e=>{
  const key=e.target.dataset.field;
  if(!key||!formSpec(state.module)||!allowed(formSpec(state.module)))return;
  const d=draftFor(state.module);
  d.values[key]=e.target.value;d.confirmed=false;d.approved=false;d.checked=false;
  if(formSpec(state.module).connection)d.keyPrepared=false;
  state.notes[state.module]='입력 중입니다. 적용 전이며 이전 확인은 해제했습니다.';
  const result=$('#form-result');if(result)result.textContent=state.notes[state.module];
  const impact=$('#settings-form + .impact');
  if(impact)impact.outerHTML=impactMarkup(state.module,formSpec(state.module),d);
});
$('#content').addEventListener('change',e=>{
  if(e.target.matches('[data-confirm]')){draftFor(state.module).confirmed=e.target.checked;render();$('[data-confirm]')?.focus();}
  if(e.target.id==='audit-filter'){state.applied.auditFilter=e.target.value;render();$('#audit-filter').focus();}
});
document.addEventListener('click',e=>{
  const route=e.target.closest('a[data-route]');
  if(route){if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(route.dataset.route,route.dataset.topic||'');return;}
  const work=e.target.closest('[data-work]');
  if(work){e.preventDefault();setDrawer(false,false);$('#work-result').textContent=`${work.dataset.work} 업무 메뉴 시연입니다. 실제 업무 화면은 이 아티팩트에 없습니다.`;$('#page-title').focus();return;}
  const target=e.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=target.dataset.action;
  if(['prev','next','cancel','check','key','approve','apply','prepared-fixture','approved-fixture'].includes(action)){handleFormAction(action);return;}
  if(action==='basic'){state.scenario='basic';history.pushState(null,'',routeURL(state.module,state.topic));render();$('#page-title').focus();return;}
  const messages={
    'role-review':'역할 변경 검토 시연: 역할의 합, 팀 감독과 마지막 관리자 보호를 확인합니다. 실제 권한은 바꾸지 않았습니다.',
    assignment:'공동 담당 검토 시연: 기존 담당을 유지하고 요청자를 추가하는 조건을 확인합니다. 실제 배정은 변경하지 않았습니다.',
    transfer:'이관 검토 시연: 기존 담당과 새 담당의 책임 이전을 확인합니다. 실제 이관은 하지 않았습니다.',
    retain:'보존 검토 시연: 연장 동의와 진행 업무, 법적 근거를 확인합니다. 실제 기한은 변경하지 않았습니다.',
    purge:'파기 조건: PII_PURGE_ENABLED=1과 기관 관리자 승인 모두 필요합니다. 실제 파기를 실행하지 않았습니다.',
    diagnostic:'진단 보고 범위 시연: 코드와 비식별 작업 ID 및 시각만 포함합니다. 보고서 파일은 생성하지 않았습니다.',
    mfa:'MFA 변경은 로그인 복구 수단을 확인한 뒤 본인 인증으로 진행합니다. 이 시안에서는 실제 등록이나 변경을 하지 않습니다.'
  };
  if(action==='accept'&&roleSets[state.role].includes('worker')){if(operationFailure())return;state.applied.assignment=true;render();announce('배정 요청 수락 시연입니다. 실제 담당 관계는 바뀌지 않았습니다.');return;}
  if(action.startsWith('program:')&&canAdmin()){state.notes.programStatus=`${action.slice(8)} 운영 상태 검토 시연: 신규 등록 중지와 케이스 종결은 별개입니다. 실제 운영 상태는 바꾸지 않았습니다.`;render();announce(state.notes.programStatus);return;}
  if(['role-review','assignment','transfer','retain','purge'].includes(action)&&!canAdmin())return;
  if(messages[action]){announce(messages[action]);}
});
$('#role').addEventListener('change',e=>{state.role=e.target.value;clearDrafts();navigate(defaultModule());announce('프리뷰 역할을 바꿨습니다. 미적용 입력과 확인은 지웠고 실제 권한은 바꾸지 않았습니다.');});
$('#scenario').addEventListener('change',e=>{state.scenario=e.target.value;const d=state.drafts[state.module];if(d){d.confirmed=false;d.checked=false;d.approved=false;d.keyPrepared=false;}history.pushState(null,'',routeURL(state.module,state.topic));render();$('#scenario').focus();announce('화면 상태만 바꿨습니다. 시연 입력은 유지했습니다.');});
$('#reset').addEventListener('click',()=>{clearDrafts();state.applied={};state.reconfirm=false;state.scenario='basic';history.replaceState(null,'',routeURL(state.module,state.topic));render();announce('시연 자료를 초기화했습니다. 서버 자료는 변경하지 않았습니다.');});
function positionThemeControl() {
  const control=$('#theme');
  (matchMedia('(max-width: 767px)').matches?$('#drawer-actions'):$('#header-actions')).append(control);
  const dark=document.documentElement.dataset.theme==='dark';
  const label=dark?'라이트 모드':'다크 모드';
  control.setAttribute('aria-label',label);control.title=label;control.setAttribute('aria-pressed',String(dark));
  control.innerHTML=icon(dark?'theme-light':'theme-dark');
}
$('#theme').addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';positionThemeControl();});
$('#open-menu').addEventListener('click',()=>setDrawer(true));
$('#close-menu').addEventListener('click',()=>setDrawer(false));
$('#scrim').addEventListener('click',()=>setDrawer(false));
document.addEventListener('keydown',e=>{
  if(!state.drawer)return;
  if(e.key==='Escape'){e.preventDefault();setDrawer(false);return;}
  if(e.key==='Tab'){
    const focusable=[...$('#sidebar').querySelectorAll('a[href],button:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
matchMedia('(max-width: 767px)').addEventListener('change',()=>{setDrawer(false,false);positionThemeControl();});
window.addEventListener('popstate',()=>{clearDrafts();readRoute();setDrawer(false,false);render();announce('브라우저 이력의 메뉴와 역할을 복원했습니다.');$('#page-title').focus();});
readRoute();render();positionThemeControl();
