/**
 * 리스크 플래그 제안 평가 데이터셋 (CCC-130 · D72).
 *
 * 합성 한국어 상담 전사 30건 — 유형 6종 × 5건. 유형별 구성은 항상
 * clear 2 · ambiguous 2 · trap 1 이고, 기대 판정은 다음과 같다.
 *
 * - clear: 전사에 그 유형의 명확한 근거가 있다 → 기대 플래그 = [해당 유형]
 * - ambiguous: 안전 2종(위기 발언, 폭력·착취 피해)은 [해당 유형], 나머지는 [].
 *   D72의 고정 민감도 2단을 검증한다.
 * - trap: 유형을 떠올리게 하는 미끼가 있으나 실제로는 아니다 → 기대 플래그 = [] (명시적 무플래그)
 *
 * 모든 텍스트는 합성·가명 처리본이다(R3). 실명·연락처·계좌·주민번호 패턴이 없고,
 * 인명은 화자 구분(당사자/실무자)과 가족·이웃 호칭만 쓴다. 플래그는 전사 발언 인용으로만
 * 제안되므로(D72), 각 사례의 기대 판정도 전사 내용만으로 정해진다.
 *
 * 이 파일은 런타임에 ai-provider 를 import 하지 않는다(타입 전용). node 로 직접 실행하는
 * apps/api/eval/run-flag-eval.ts 가 실제 검증 함수를 주입한다.
 */
import type {
  AiEvidenceReference,
  AiFlagType,
  AiProviderMaterial,
  AiProviderRequest,
} from '../src/ai-provider';

/**
 * 평가가 다루는 플래그 유형 — ai-provider 의 AI_FLAG_TYPES 와 같아야 한다(테스트가 대조).
 * 점수 집계가 이 순서를 따른다.
 */
export const FLAG_EVAL_TYPES: readonly AiFlagType[] = [
  'crisis_utterance',
  'contact_loss_risk',
  'housing_livelihood_shock',
  'debt_deterioration',
  'repeated_noncompliance',
  'violence_exploitation',
];

export type FlagEvalCategory = 'clear' | 'ambiguous' | 'trap';

export interface FlagEvalCase {
  /** 사람이 읽는 사례 id. 소문자·하이픈만 쓴다. */
  id: string;
  category: FlagEvalCategory;
  /** 이 사례가 겨냥하는 플래그 유형 (평가 보고의 유형별 집계 기준). */
  flagType: AiFlagType;
  /** 기대 플래그 유형. clear 는 [flagType], ambiguous·trap 은 [] 이다. */
  expectedFlagTypes: readonly AiFlagType[];
  /** 마스킹된 합성 전사 — 플래그 근거는 여기서만 나온다. */
  transcript: string;
  /** 마스킹된 합성 수기 메모 (텍스트 맥락 재료). 플래그 판정에 쓰지 않는다. */
  textContext: string;
  /** 사례 설계 의도 (한국어). 실패 사례 보고에 함께 보인다. */
  note: string;
}

const SAFETY_FLAG_TYPES: ReadonlySet<AiFlagType> = new Set([
  'crisis_utterance',
  'violence_exploitation',
]);

function clearCase(
  id: string,
  flagType: AiFlagType,
  transcript: string,
  textContext: string,
  note: string,
): FlagEvalCase {
  return { id, category: 'clear', flagType, expectedFlagTypes: [flagType], transcript, textContext, note };
}

function noFlagCase(
  id: string,
  flagType: AiFlagType,
  category: 'ambiguous' | 'trap',
  transcript: string,
  textContext: string,
  note: string,
): FlagEvalCase {
  const expectedFlagTypes = category === 'ambiguous' && SAFETY_FLAG_TYPES.has(flagType)
    ? [flagType]
    : [];
  return { id, category, flagType, expectedFlagTypes, transcript, textContext, note };
}

export const FLAG_EVAL_CASES: readonly FlagEvalCase[] = [
  // ── crisis_utterance ──────────────────────────────────────────────────────
  clearCase(
    'crisis-utterance-clear-1',
    'crisis_utterance',
    [
      '당사자: 요즘 계속 잠이 안 와요. 밤에 누우면 죽고 싶다는 생각만 들어요.',
      '실무자: 그런 생각이 얼마나 자주 드나요?',
      '당사자: 거의 매일이에요. 이대로 살아야 하나 싶어요.',
    ].join('\n'),
    [
      '[회기 목표] 수면 어려움과 심리 상태 확인',
      '수기 메모: 당사자가 수면 어려움을 호소했다. 다음 회차에 상태 변화를 확인하기로 했다.',
    ].join('\n'),
    '매일 드는 자살 관념을 명시적으로 말한다 — 즉시 플래그.',
  ),
  clearCase(
    'crisis-utterance-clear-2',
    'crisis_utterance',
    [
      '당사자: 저는 이제 다 끝났어요. 약을 많이 먹고 잠들고 싶어요.',
      '실무자: 지금 그런 생각을 하고 계신 건가요?',
      '당사자: 네. 언제 할지는 아직 정하지 않았지만, 그렇게 하고 싶어요.',
    ].join('\n'),
    [
      '[회기 목표] 심리 상태와 안전 확인',
      '수기 메모: 당사자가 매우 처진 상태로 내원했다. 안전 확인이 필요하다.',
    ].join('\n'),
    '구체적인 자살 방법(과다복용)과 의지를 말한다 — 즉시 플래그.',
  ),
  noFlagCase(
    'crisis-utterance-ambiguous-1',
    'crisis_utterance',
    'ambiguous',
    [
      '당사자: 요즘 너무 지쳐서 그냥 사라지고 싶다는 생각이 들 때가 있어요.',
      '실무자: 구체적으로 다치게 할 생각까지 하신 적이 있나요?',
      '당사자: 거기까지 생각한 건 아닌데, 혼자 있으면 그런 생각이 자꾸 돌아요.',
    ].join('\n'),
    [
      '[회기 목표] 피로감과 안전 상태 확인',
      '수기 메모: 사라지고 싶다는 표현이 있었고 구체적인 계획은 확인되지 않았다.',
    ].join('\n'),
    '구체적인 계획은 없지만 사라지고 싶다는 현재 발언이 반복된다. 안전 유형은 애매해도 제안한다.',
  ),
  noFlagCase(
    'crisis-utterance-ambiguous-2',
    'crisis_utterance',
    'ambiguous',
    [
      '당사자: 사는 게 지겹고 차라리 아침에 눈뜨지 않았으면 좋겠다는 생각이 들어요.',
      '실무자: 그 생각이 들 때 어떤 행동을 할지도 떠오르나요?',
      '당사자: 무슨 행동을 할지는 모르겠지만 가끔 그 생각이 아주 깊어져요.',
    ].join('\n'),
    [
      '[회기 목표] 정서 상태 확인',
      '수기 메모: 죽음과 가까운 표현이 있었으나 구체 행동은 확인되지 않았다.',
    ].join('\n'),
    '구체 행동은 없지만 눈뜨지 않기를 바라는 현재 발언이 있다. 안전 유형의 애매한 제안 사례다.',
  ),
  noFlagCase(
    'crisis-utterance-trap-1',
    'crisis_utterance',
    'trap',
    [
      '당사자: 실무자님이 걱정하셔서 말씀드리는데, 죽고 싶다는 생각은 전혀 없어요.',
      '실무자: 그동안 많이 힘드셨잖아요.',
      '당사자: 네, 힘들었지만 지금은 괜찮아요. 상담 덕분에 많이 좋아졌어요.',
    ].join('\n'),
    [
      '[회기 목표] 상태 확인 및 유지',
      '수기 메모: 당사자가 안심시키려는 듯 현재 상태가 괜찮다고 말했다.',
    ].join('\n'),
    '"죽고 싶다"는 단어가 나오지만 명시적으로 부정된다 — 플래그 없음(미끼).',
  ),

  // ── contact_loss_risk ─────────────────────────────────────────────────────
  clearCase(
    'contact-loss-risk-clear-1',
    'contact_loss_risk',
    [
      '실무자: 지난주부터 전화를 받지 않으셔서 걱정했습니다.',
      '당사자: 네... 집에 있긴 한데 전화받기가 싫었어요.',
      '실무자: 다음 회차에도 오실 수 있나요?',
      '당사자: 글쎄요. 별로 나가고 싶지 않아요.',
    ].join('\n'),
    [
      '[회기 목표] 연락 유지와 다음 회차 일정 확인',
      '수기 메모: 전화를 받지 않아 직접 방문으로 통화했다. 다음 회차 참석이 불확실하다.',
    ].join('\n'),
    '전화를 일부러 피하고 다음 회차 참석도 불확실하다 — 플래그.',
  ),
  clearCase(
    'contact-loss-risk-clear-2',
    'contact_loss_risk',
    [
      '당사자: 지금 좀 어수선해서... 집에만 있어요.',
      '실무자: 지난 두 번 예약에 안 나오셨는데, 혹시 연락이 어려운 상황인가요?',
      '당사자: 네, 좀 그랬어요. 핸드폰 요금도 밀려서 며칠 동안 전화를 못 받았어요.',
    ].join('\n'),
    [
      '[회기 목표] 연락 두절 원인 확인',
      '수기 메모: 두 차례 부재 후 통화에 성공했다. 연락 수단 유지가 불안정하다.',
    ].join('\n'),
    '두 차례 부재에 더해 전화 요금 연체로 연락 수단까지 위태롭다 — 플래그.',
  ),
  noFlagCase(
    'contact-loss-risk-ambiguous-1',
    'contact_loss_risk',
    'ambiguous',
    [
      '당사자: 요즘 일이 많아서 전화를 잘 못 받아요.',
      '실무자: 그래도 연락이 안 되면 걱정이 됩니다.',
      '당사자: 네, 미안해요. 그래도 문자는 꼭 확인해요.',
    ].join('\n'),
    [
      '[회기 목표] 연락 수단 확인',
      '수기 메모: 전화 응답이 늦지만 문자로는 계속 연락이 닿고 있다.',
    ].join('\n'),
    '전화 응답은 늦지만 문자 확인은 유지된다 — 완전한 두절 아님, 플래그 없음.',
  ),
  noFlagCase(
    'contact-loss-risk-ambiguous-2',
    'contact_loss_risk',
    'ambiguous',
    [
      '실무자: 어제 전화를 두 번 드렸는데 못 받으셨더라고요.',
      '당사자: 어제는 병원에 갔다 와서 늦게 들어왔어요. 미안해요.',
      '실무자: 다음에 연락이 안 되면 문자라도 남겨주시면 좋겠어요.',
      '당사자: 네, 알겠어요. 앞으로는 문자라도 할게요.',
    ].join('\n'),
    [
      '[회기 목표] 연락 규칙 확인',
      '수기 메모: 일시적 미응답이었고 사유가 분명하다. 연락 수단은 유지된다.',
    ].join('\n'),
    '일시적 미응답이지만 사유가 분명하고 연락 수단은 유지된다 — 플래그 없음.',
  ),
  noFlagCase(
    'contact-loss-risk-trap-1',
    'contact_loss_risk',
    'trap',
    [
      '당사자: 실무자님, 저희 이웃 할머니가 한 달째 연락이 안 돼요.',
      '실무자: 아, 그러시군요. 그 할머니 댁에 직접 가보셨나요?',
      '당사자: 네, 가봤는데 문을 안 열어주셔서 걱정이에요.',
    ].join('\n'),
    [
      '[회기 목표] 이웃 안부 확인',
      '수기 메모: 당사자가 이웃 할머니의 연락 두절을 걱정했다. 당사자 본인과는 연락이 닿는다.',
    ].join('\n'),
    '"연락이 안 된다"는 이웃 얘기이고 본인 연락은 유지된다 — 플래그 없음(미끼).',
  ),

  // ── housing_livelihood_shock ──────────────────────────────────────────────
  clearCase(
    'housing-livelihood-shock-clear-1',
    'housing_livelihood_shock',
    [
      '당사자: 집주인이 이번 달까지 나가라고 통보를 했어요.',
      '실무자: 그게 언제쯤이었나요?',
      '당사자: 지난주에요. 다음 달 초까지 나가야 하는데 갈 데가 없어요.',
    ].join('\n'),
    [
      '[회기 목표] 주거 상황 확인',
      '수기 메모: 퇴거 통보를 받았고 대안 주거가 없다고 호소했다.',
    ].join('\n'),
    '퇴거 통보에 대안이 없다 — 플래그.',
  ),
  clearCase(
    'housing-livelihood-shock-clear-2',
    'housing_livelihood_shock',
    [
      '당사자: 이번 달부터 일을 그만두게 됐어요.',
      '실무자: 무슨 일이 있었나요?',
      '당사자: 가게가 문을 닫았어요. 다음 달 집세를 어떻게 낼지 막막해요.',
    ].join('\n'),
    [
      '[회기 목표] 생계와 주거 여건 확인',
      '수기 메모: 실직으로 수입이 끊겼고 집세 부담을 호소했다.',
    ].join('\n'),
    '실직으로 수입이 끊기고 집세 부담이 닥쳤다 — 플래그.',
  ),
  noFlagCase(
    'housing-livelihood-shock-ambiguous-1',
    'housing_livelihood_shock',
    'ambiguous',
    [
      '당사자: 요즘 물가가 많이 올라서 생활비가 빠듯해요.',
      '실무자: 생활에 큰 문제가 있나요?',
      '당사자: 아직은 버티고 있어요. 남는 건 없지만 굶지는 않아요.',
    ].join('\n'),
    [
      '[회기 목표] 생활비 상황 확인',
      '수기 메모: 생활비 부담을 호소했으나 당장의 생활 위기는 없다.',
    ].join('\n'),
    '생활비가 빠듯하지만 당장의 위기는 없다 — 플래그 없음.',
  ),
  noFlagCase(
    'housing-livelihood-shock-ambiguous-2',
    'housing_livelihood_shock',
    'ambiguous',
    [
      '당사자: 집세를 이번 달에 조금 미뤘어요.',
      '실무자: 집주인과는 이야기하셨나요?',
      '당사자: 네, 사정을 말씀드렸더니 다음 달에 같이 내면 된다고 하셨어요.',
    ].join('\n'),
    [
      '[회기 목표] 주거비 상황 확인',
      '수기 메모: 월세를 한 차례 미뤘으나 집주인의 양해를 받았다.',
    ].join('\n'),
    '월세를 미뤘지만 집주인 양해로 위기로 번지지 않았다 — 플래그 없음.',
  ),
  noFlagCase(
    'housing-livelihood-shock-trap-1',
    'housing_livelihood_shock',
    'trap',
    [
      '당사자: 저는 예전에 살던 집에서 퇴거당한 적이 있어요.',
      '실무자: 그때 많이 힘드셨겠어요. 지금은 어떠세요?',
      '당사자: 지금은 공공임대에 살고 있어서 안정적이에요. 그때보다 훨씬 나아요.',
    ].join('\n'),
    [
      '[회기 목표] 주거 안정성 확인',
      '수기 메모: 과거 퇴거 경험을 이야기했으나 현재 주거는 안정적이다.',
    ].join('\n'),
    '"퇴거"라는 단어가 나오지만 과거 경험이고 현재는 안정적이다 — 플래그 없음(미끼).',
  ),

  // ── debt_deterioration ────────────────────────────────────────────────────
  clearCase(
    'debt-deterioration-clear-1',
    'debt_deterioration',
    [
      '당사자: 빚이 점점 늘고 있어요. 이번 달 카드값을 못 갚았어요.',
      '실무자: 지금 빚이 얼마나 되나요?',
      '당사자: 카드 두 장에 대출까지 합하면 삼천만 원쯤 돼요. 갚을 길이 없어요.',
    ].join('\n'),
    [
      '[회기 목표] 채무 상황 확인',
      '수기 메모: 카드값 연체와 채무 증가를 호소했다. 상환 계획이 없다.',
    ].join('\n'),
    '채무가 늘고 상환할 길이 없다고 말한다 — 플래그.',
  ),
  clearCase(
    'debt-deterioration-clear-2',
    'debt_deterioration',
    [
      '당사자: 대출을 더 받았어요. 월급으로 이자도 못 내고 있어요.',
      '실무자: 이자가 얼마나 되나요?',
      '당사자: 월 이자가 팔십만 원이에요. 원금은 더 늘고 있어요.',
    ].join('\n'),
    [
      '[회기 목표] 채무 악화 확인',
      '수기 메모: 이자도 감당하지 못하는 채무 상태를 호소했다.',
    ].join('\n'),
    '이자조차 내지 못하고 원금이 늘고 있다 — 플래그.',
  ),
  noFlagCase(
    'debt-deterioration-ambiguous-1',
    'debt_deterioration',
    'ambiguous',
    [
      '당사자: 카드값이 좀 남아 있어요.',
      '실무자: 얼마나 되나요?',
      '당사자: 삼십만 원쯤요. 다음 달에 받는 돈으로 갚을 수 있을 것 같아요.',
    ].join('\n'),
    [
      '[회기 목표] 채무 현황 확인',
      '수기 메모: 소액 카드값이 남아 있으나 상환 계획이 있다.',
    ].join('\n'),
    '소액 채무에 상환 계획이 있다 — 플래그 없음.',
  ),
  noFlagCase(
    'debt-deterioration-ambiguous-2',
    'debt_deterioration',
    'ambiguous',
    [
      '당사자: 예전에 비해 빚이 많이 줄었어요.',
      '실무자: 어떻게 갚고 계신가요?',
      '당사자: 매달 조금씩 갚고 있어요. 아직 이년은 걸릴 것 같지만 방향은 좋아요.',
    ].join('\n'),
    [
      '[회기 목표] 상환 진행 확인',
      '수기 메모: 채무가 감소 추세이고 계획적으로 상환 중이다.',
    ].join('\n'),
    '채무는 있으나 감소 추세에 계획적 상환 중이다 — 플래그 없음.',
  ),
  noFlagCase(
    'debt-deterioration-trap-1',
    'debt_deterioration',
    'trap',
    [
      '당사자: 작년에 빚을 다 갚았어요. 이제 빚이 하나도 없어요.',
      '실무자: 정말 다행이네요. 지금 부채가 전혀 없으신가요?',
      '당사자: 네, 카드도 다 정리했어요.',
    ].join('\n'),
    [
      '[회기 목표] 채무 정리 확인',
      '수기 메모: 작년에 전액 상환을 마쳤고 현재 부채가 없다고 말했다.',
    ].join('\n'),
    '"빚"이라는 단어가 나오지만 실제 채무가 전혀 없다 — 플래그 없음(미끼).',
  ),

  // ── repeated_noncompliance ────────────────────────────────────────────────
  clearCase(
    'repeated-noncompliance-clear-1',
    'repeated_noncompliance',
    [
      '실무자: 지난 세 차례 모두 서류를 가져오지 않으셨어요.',
      '당사자: 네... 계속 깜빡했어요.',
      '실무자: 오늘 가져오기로 하셨는데, 지금 가져오셨나요?',
      '당사자: 또 깜빡했어요. 죄송해요.',
    ].join('\n'),
    [
      '[회기 목표] 서류 제출 이행 확인',
      '수기 메모: 세 차례 연속 서류 미제출. 사유 없이 반복되고 있다.',
    ].join('\n'),
    '세 차례 반복된 약속 불이행에 사유가 없다 — 플래그.',
  ),
  clearCase(
    'repeated-noncompliance-clear-2',
    'repeated_noncompliance',
    [
      '실무자: 이번이 세 번째 예약인데요, 지난 두 번은 오지 않으셨어요.',
      '당사자: 네, 솔직히 오기 싫었어요.',
      '실무자: 오늘은 어떻게 하시겠어요?',
      '당사자: 모르겠어요. 지금은 별로 하고 싶은 말이 없어요.',
    ].join('\n'),
    [
      '[회기 목표] 상담 참여 이행 확인',
      '수기 메모: 두 차례 불참 후 세 번째 예약. 참여 의지가 낮아 보인다.',
    ].join('\n'),
    '반복된 상담 불참에 회피 태도까지 보인다 — 플래그.',
  ),
  noFlagCase(
    'repeated-noncompliance-ambiguous-1',
    'repeated_noncompliance',
    'ambiguous',
    [
      '당사자: 저번에 말씀드린 서류를 아직 못 가져왔어요.',
      '실무자: 처음이시죠?',
      '당사자: 네, 이번이 처음이에요. 다음 주에는 꼭 가져올게요.',
    ].join('\n'),
    [
      '[회기 목표] 서류 준비 확인',
      '수기 메모: 첫 서류 지연이었고 다음 회차 제출을 약속했다.',
    ].join('\n'),
    '첫 불이행이고 다음 회차 약속이 있다 — 반복 아님, 플래그 없음.',
  ),
  noFlagCase(
    'repeated-noncompliance-ambiguous-2',
    'repeated_noncompliance',
    'ambiguous',
    [
      '당사자: 서류 준비가 늦어지고 있어요.',
      '실무자: 무슨 일이 있으신가요?',
      '당사자: 회사 일이 갑자기 많아져서요. 그래도 이번 달 안에는 준비할 수 있어요.',
    ].join('\n'),
    [
      '[회기 목표] 서류 준비 일정 확인',
      '수기 메모: 사유가 있는 일회성 지연이고 기한을 제시했다.',
    ].join('\n'),
    '사유가 있는 일회성 지연에 기한을 제시했다 — 플래그 없음.',
  ),
  noFlagCase(
    'repeated-noncompliance-trap-1',
    'repeated_noncompliance',
    'trap',
    [
      '실무자: 지난 두 번, 서류를 못 가져오셨는데 특별한 사유가 있으셨나요?',
      '당사자: 어머니가 병원에 입원하셔서 돌봐야 했어요. 실무자님도 이해해 주셨잖아요.',
      '실무자: 네, 그 상황은 충분히 이해합니다.',
      '당사자: 이제 어머니가 퇴원하셔서 이번에는 꼭 가져올 수 있어요.',
    ].join('\n'),
    [
      '[회기 목표] 서류 제출 일정 재확인',
      '수기 메모: 두 차례 미제출은 간병 때문이었고 실무자가 양해했다. 이번 회차 제출 예정.',
    ].join('\n'),
    '두 차례 불이행이지만 불가항력적 사유에 실무자 양해가 있다 — 반복 불응 아님, 플래그 없음(미끼).',
  ),

  // ── violence_exploitation ─────────────────────────────────────────────────
  clearCase(
    'violence-exploitation-clear-1',
    'violence_exploitation',
    [
      '당사자: 남편이 화가 나면 저를 때려요. 지난주에도 팔을 잡아 비틀었어요.',
      '실무자: 다치신 데는 없나요?',
      '당사자: 멍이 들었지만 참고 있어요.',
    ].join('\n'),
    [
      '[회기 목표] 가정 내 안전 확인',
      '수기 메모: 배우자의 신체 폭력을 호소했다. 안전 확인이 필요하다.',
    ].join('\n'),
    '배우자의 신체 폭력 피해를 구체적으로 진술한다 — 플래그.',
  ),
  clearCase(
    'violence-exploitation-clear-2',
    'violence_exploitation',
    [
      '당사자: 오빠가 제 통장을 맡고 있어요. 돈을 달라고 하면 주지 않으면 큰소리를 쳐요.',
      '실무자: 그 돈은 본인 것을 쓰시는 건가요?',
      '당사자: 네, 그런데 제 마음대로 쓸 수가 없어요.',
    ].join('\n'),
    [
      '[회기 목표] 금전 통제 상황 확인',
      '수기 메모: 가족의 금전 통제와 갈취를 호소했다.',
    ].join('\n'),
    '가족이 통장을 통제하며 금전을 요구한다 — 플래그.',
  ),
  noFlagCase(
    'violence-exploitation-ambiguous-1',
    'violence_exploitation',
    'ambiguous',
    [
      '당사자: 남편이 화가 나면 문을 막고 제 휴대폰을 가져가요.',
      '실무자: 때리거나 직접 다치게 한 적도 있나요?',
      '당사자: 때린 적은 없는데 못 나가게 할 때는 많이 무서워요.',
    ].join('\n'),
    [
      '[회기 목표] 가정 내 안전 확인',
      '수기 메모: 이동과 연락을 막는 행동이 있었고 당사자가 두려움을 호소했다.',
    ].join('\n'),
    '신체 폭력은 확인되지 않았지만 이동과 연락 통제가 있다. 안전 유형은 애매해도 제안한다.',
  ),
  noFlagCase(
    'violence-exploitation-ambiguous-2',
    'violence_exploitation',
    'ambiguous',
    [
      '당사자: 가족이 제 지원금 카드를 가지고 필요할 때 대신 써요.',
      '실무자: 사용 전에 본인에게 허락을 구하나요?',
      '당사자: 일부는 돌려주지만 제가 마음대로 확인하거나 쓰지는 못해요.',
    ].join('\n'),
    [
      '[회기 목표] 지원금 사용 권한 확인',
      '수기 메모: 가족이 지원금 카드를 관리하고 당사자의 사용 권한이 제한돼 있다.',
    ].join('\n'),
    '가족이 일부를 돌려주지만 당사자의 자금 통제권이 제한돼 있다. 착취 가능성을 제안한다.',
  ),
  noFlagCase(
    'violence-exploitation-trap-1',
    'violence_exploitation',
    'trap',
    [
      '당사자: 옆집에서 부부 싸움이 자주 나요. 어젯밤에는 뭔가 깨지는 소리도 났어요.',
      '실무자: 직접 다치신 분은 없으셨나요?',
      '당사자: 저는 아니에요. 그런데 옆집이 걱정돼서요.',
    ].join('\n'),
    [
      '[회기 목표] 주변 안전 상황 확인',
      '수기 메모: 이웃 가정의 소란을 목격했다고 말했다. 당사자 본인은 안전하다.',
    ].join('\n'),
    '폭력은 이웃 가정의 일이고 본인 안전은 위협받지 않는다 — 플래그 없음(미끼).',
  ),
];

/**
 * 사례 하나를 호출 ① 요청으로 조립한다. 전사·메모를 줄 단위로 잘라 근거로 만들고,
 * 모든 대조 축은 applied(두 재료 모두 있음)로 둔다. 반환값은
 * validateAiProviderRequest 를 통과해야 한다(테스트가 보장).
 */
export function buildFlagEvalRequest(case_: FlagEvalCase): AiProviderRequest {
  const transcriptSourceRef = `eval-flag-${case_.id}-transcript`;
  const memoSourceRef = `eval-flag-${case_.id}-memo`;
  return {
    materials: [
      buildMaterial('transcript', transcriptSourceRef, case_.transcript, `eval-flag-${case_.id}-t`),
      buildMaterial('text_context', memoSourceRef, case_.textContext, `eval-flag-${case_.id}-m`),
    ],
    contrastAxes: {
      missing_from_memo: 'applied',
      missing_from_transcript: 'applied',
      undiscussed_session_goal: 'applied',
    },
  };
}

function buildMaterial(
  kind: 'transcript' | 'text_context',
  sourceRef: string,
  text: string,
  evidenceIdPrefix: string,
): AiProviderMaterial {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const evidence: AiEvidenceReference[] = [];
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    // 잘라낸 줄은 원문의 부분 문자열이므로 indexOf 로 구간을 찾을 수 있다.
    const start = text.indexOf(line, cursor);
    if (start < 0) throw new Error(`evidence line not found in material: ${line}`);
    const end = start + Array.from(line).length;
    const evidenceId = `${evidenceIdPrefix}-${index + 1}`;
    evidence.push({
      evidenceId,
      sourceRef,
      sourceSha256: deterministicSha256Placeholder(evidenceId),
      evidenceQuote: line,
      sourceStart: start,
      sourceEnd: end,
    });
    cursor = end;
  }
  return { kind, sourceRef, maskedText: text, evidence };
}

/**
 * 모양만 맞추는 결정적 64자리 16진 자리표시자. 실제 스냅샷은 마스킹 원문의 SHA-256 을
 * 싣지만(D57), 평가 요청의 근거는 shape 검증만 받으므로 동일하게 결정적이면 충분하다.
 * 네트워크·비동기 없이 재현 가능해야 한다.
 */
function deterministicSha256Placeholder(seed: string): string {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code << 8), 0x85ebca6b) >>> 0;
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0') + '0'.repeat(48);
}
