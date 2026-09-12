import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from 'react';
import {
  GridContainer,
  PageTitle,
  WireBadge,
  WireButton,
  WireCallout,
  WireCard,
  WireCardSection,
  WireChoice,
  WireDataRow,
  WireDataRows,
  WireEmpty,
  WireError,
} from '@ccc/wire';
import { deleteTrial, fetchStatus, fetchTranscript, fetchTrial, submitTrial, SttApiError } from './api';
import type { EngineId, StatusResponse, TranscriptResponse, TrialResponse } from './contract';
import {
  ENGINE_LABEL,
  ENGINE_NOT_READY,
  externalUploadLabel,
  formatBytes,
  formatTimecode,
  SPEAKER_NOT_PROVIDED,
  STATUS_LABEL,
  submitBlockReason,
  trialErrorMessage,
  type PickedFile,
} from './messages';

const POLL_INTERVAL_MS = 2000;

function errorCodeOf(cause: unknown): string | null {
  return cause instanceof SttApiError ? cause.code : null;
}

export function SttTrialPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [engine, setEngine] = useState<EngineId>('qwen3-asr');
  const [ownedTestRecording, setOwnedTestRecording] = useState(false);
  const [allowExternalUpload, setAllowExternalUpload] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [trial, setTrial] = useState<TrialResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const loadTranscript = useCallback(async (id: string) => {
    try {
      setTranscript(await fetchTranscript(id));
      setTranscriptError(null);
    } catch (cause) {
      setTranscriptError(trialErrorMessage(errorCodeOf(cause)));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setStatusError(null);
    } catch (cause) {
      setStatus(null);
      setStatusError(trialErrorMessage(errorCodeOf(cause)));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // 상태는 서버가 준 네 값만 보여 준다. 진행률을 추측해 만들지 않는다.
  const trialId = trial?.trialId ?? null;
  const settled = trial === null || trial.status === 'completed' || trial.status === 'failed';
  useEffect(() => {
    if (trialId === null || settled) return undefined;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const next = await fetchTrial(trialId);
          setTrial(next);
          if (next.status === 'completed') {
            await loadTranscript(trialId);
            void refreshStatus();
          }
          if (next.status === 'failed') void refreshStatus();
        } catch (cause) {
          setActionError(trialErrorMessage(errorCodeOf(cause)));
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [trialId, settled, refreshStatus, loadTranscript]);

  const localEngine = status?.engines['qwen3-asr'] ?? null;
  const azureEngine = status?.engines.azure ?? null;
  const engineConfigured = engine === 'azure' ? azureEngine?.configured === true : localEngine?.configured === true;

  const blockReason = submitBlockReason({
    file,
    limits: status?.upload ?? null,
    engine,
    engineConfigured,
    ownedTestRecording,
    allowExternalUpload,
    busy: status?.busy === true,
    submitting,
  });

  const submit = async () => {
    if (file === null || blockReason !== null) return;
    setSubmitting(true);
    setActionError(null);
    setTranscript(null);
    setTranscriptError(null);
    try {
      const created = await submitTrial(file, engine, allowExternalUpload);
      setTrial({
        trialId: created.trialId,
        status: created.status,
        engine,
        externalUploadAttempted: null,
      });
      void refreshStatus();
    } catch (cause) {
      setActionError(trialErrorMessage(errorCodeOf(cause)));
    } finally {
      setSubmitting(false);
    }
  };

  const removeTrial = async () => {
    if (trial === null) return;
    setActionError(null);
    try {
      await deleteTrial(trial.trialId);
      setTrial(null);
      setTranscript(null);
      setTranscriptError(null);
      void refreshStatus();
    } catch (cause) {
      setActionError(trialErrorMessage(errorCodeOf(cause)));
    }
  };

  return (
    <SttTrialView
      status={status}
      statusError={statusError}
      actionError={actionError}
      file={file === null ? null : { name: file.name, size: file.size, type: file.type }}
      engine={engine}
      ownedTestRecording={ownedTestRecording}
      allowExternalUpload={allowExternalUpload}
      blockReason={blockReason}
      trial={trial}
      transcript={transcript}
      transcriptError={transcriptError === null ? null : {
        message: transcriptError,
        onRetry: () => {
          if (trial?.status === 'completed') void loadTranscript(trial.trialId);
        },
      }}
      onFileChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
      onEngineChange={setEngine}
      onOwnedTestRecordingChange={setOwnedTestRecording}
      onAllowExternalUploadChange={setAllowExternalUpload}
      onSubmit={submit}
      onRemoveTrial={removeTrial}
    />
  );
}

/** 표시값과 조작 콜백만 받는다. 통신과 시험 상태 관리는 Page가 맡는다. */
export interface SttTrialViewProps {
  status: StatusResponse | null;
  statusError: string | null;
  actionError: string | null;
  file: PickedFile | null;
  engine: EngineId;
  ownedTestRecording: boolean;
  allowExternalUpload: boolean;
  blockReason: string | null;
  trial: TrialResponse | null;
  transcript: TranscriptResponse | null;
  transcriptError: { message: string; onRetry: () => void } | null;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onEngineChange: (engine: EngineId) => void;
  onOwnedTestRecordingChange: (checked: boolean) => void;
  onAllowExternalUploadChange: (checked: boolean) => void;
  onSubmit: () => void;
  onRemoveTrial: () => void;
}

export function SttTrialView({
  status,
  statusError,
  actionError,
  file,
  engine,
  ownedTestRecording,
  allowExternalUpload,
  blockReason,
  trial,
  transcript,
  transcriptError,
  onFileChange,
  onEngineChange,
  onOwnedTestRecordingChange,
  onAllowExternalUploadChange,
  onSubmit,
  onRemoveTrial,
}: SttTrialViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const localEngine = status?.engines['qwen3-asr'] ?? null;
  const azureEngine = status?.engines.azure ?? null;
  const localDesc =
    localEngine === null
      ? '준비 상태를 불러오지 못했습니다.'
      : localEngine.configured
        ? `${localEngine.modelId} ${localEngine.modelRevision}, 정렬 ${localEngine.alignerId} ${localEngine.alignerRevision}, 장치 ${localEngine.device}`
        : ENGINE_NOT_READY;
  const azureDesc =
    azureEngine === null
      ? '준비 상태를 불러오지 못했습니다.'
      : azureEngine.configured
        ? `${azureEngine.region}, ${azureEngine.apiVersion}. 원본 파일이 외부로 나갑니다.`
        : ENGINE_NOT_READY;
  const externalUploadDesc =
    azureEngine?.externalUploadAuthorizationRequired === true
      ? '가림 처리 전 원본이 외부로 나갑니다. 확인하지 않으면 서버가 요청을 받지 않습니다.'
      : '가림 처리 전 원본이 외부로 나갑니다. 로컬 엔진은 외부로 보내지 않습니다.';
  const engineDetail =
    trial === null
      ? '없음'
      : trial.engine === 'azure'
        ? azureEngine === null
          ? '확인 전'
          : `${azureEngine.region} ${azureEngine.apiVersion}`
        : localEngine === null
          ? '확인 전'
          : `${localEngine.modelId} ${localEngine.modelRevision}, 장치 ${localEngine.device}`;

  // pipeline 이 끼워 넣은 경고 줄은 발화 목록에서 빼고 경고 구획에서만 보인다.
  const speechSegments = transcript?.segments.filter((segment) => segment.warning !== true) ?? [];
  const warningSegments = transcript?.segments.filter((segment) => segment.warning === true) ?? [];
  const speakerProvided = speechSegments.some((segment) => segment.speaker !== undefined);
  // 파일 대화상자도 서버가 허용한 형식만 보여 준다. 상태를 아직 못 받았으면 넓게 연다.
  const acceptAttribute =
    status !== null && status.upload.contentTypes.length > 0 ? status.upload.contentTypes.join(',') : 'audio/*';

  return (
    <GridContainer as="main" className="page-content">
      <div className="page-header">
        <PageTitle>STT 내부 시험</PageTitle>
      </div>

      <WireCallout tone="info" title="내부 기능 시험 화면입니다">
        운영 승인 전 화면입니다. 본인의 비민감 시험 녹음만 올리고 실제 당사자 자료와 다른 사람 목소리는 쓰지 않습니다.
      </WireCallout>

      <WireCard as="section" labelledBy="stt-submit-heading" title={<h2 id="stt-submit-heading">시험 녹음 제출</h2>}>
        <WireCardSection title="녹음 파일">
          {/* 파일 대화상자는 버튼이 연다. 새 입력 모양을 만들지 않으려고 입력 자체는 숨긴다. */}
          <input
            ref={fileInput}
            hidden
            type="file"
            accept={acceptAttribute}
            onChange={onFileChange}
          />
          <WireButton variant="secondary" onClick={() => fileInput.current?.click()}>
            파일 고르기
          </WireButton>
          <WireDataRows>
            <WireDataRow label="고른 파일" value={file === null ? '없음' : file.name} />
            <WireDataRow label="크기" value={file === null ? '없음' : formatBytes(file.size)} />
            <WireDataRow label="형식" value={file === null || file.type === '' ? '알 수 없음' : file.type} />
            <WireDataRow
              label="허용 크기"
              value={status === null ? '확인 전' : formatBytes(status.upload.maxBytes)}
            />
          </WireDataRows>
        </WireCardSection>

        <WireCardSection title="엔진">
          <WireChoice
            type="radio"
            name="stt-engine"
            id="stt-engine-local"
            label={ENGINE_LABEL['qwen3-asr']}
            desc={localDesc}
            checked={engine === 'qwen3-asr'}
            disabled={localEngine?.configured !== true}
            onChange={() => onEngineChange('qwen3-asr')}
          />
          <WireChoice
            type="radio"
            name="stt-engine"
            id="stt-engine-azure"
            label={ENGINE_LABEL.azure}
            desc={azureDesc}
            checked={engine === 'azure'}
            disabled={azureEngine?.configured !== true}
            onChange={() => onEngineChange('azure')}
          />
        </WireCardSection>

        <WireCardSection title="확인">
          <WireChoice
            type="checkbox"
            id="stt-owned"
            label="본인의 비민감 시험 녹음입니다"
            desc="실제 당사자 자료와 다른 사람 목소리는 올리지 않습니다."
            checked={ownedTestRecording}
            onChange={onOwnedTestRecordingChange}
          />
          {engine === 'azure' && (
            <WireChoice
              type="checkbox"
              id="stt-external-upload"
              label="Azure 로 원본 파일을 보냅니다"
              desc={externalUploadDesc}
              checked={allowExternalUpload}
              onChange={onAllowExternalUploadChange}
            />
          )}
        </WireCardSection>

        <WireCardSection title="실행">
          <WireButton
            variant="primary"
            disabled={blockReason !== null}
            onClick={onSubmit}
          >
            시험 실행
          </WireButton>
          {blockReason !== null && <p role="status" className="panel-meta">{blockReason}</p>}
          {statusError !== null && <WireError>{statusError}</WireError>}
          {actionError !== null && <WireError>{actionError}</WireError>}
        </WireCardSection>
      </WireCard>

      <WireCard as="section" labelledBy="stt-status-heading" title={<h2 id="stt-status-heading">처리 상태</h2>}>
        {trial === null ? (
          <WireEmpty>아직 실행한 시험이 없습니다.</WireEmpty>
        ) : (
          <>
            <WireDataRows>
              <WireDataRow
                label="상태"
                value={<WireBadge tone={trial.status === 'completed' ? 'mint' : 'neutral'}>{STATUS_LABEL[trial.status]}</WireBadge>}
              />
              <WireDataRow label="엔진" value={ENGINE_LABEL[trial.engine]} />
              <WireDataRow label="엔진 구성" value={engineDetail} />
              <WireDataRow label="외부 전송" value={externalUploadLabel(trial.externalUploadAttempted)} />
              <WireDataRow label="구간 수" value={trial.segmentCount ?? '집계 전'} />
              <WireDataRow label="반복 경고" value={trial.repetitionWarningCount ?? '집계 전'} />
              <WireDataRow label="운영 활성화" value="아니오" />
              <WireDataRow label="시험 ID" value={trial.trialId} />
            </WireDataRows>
            {trial.status === 'failed' && <WireError>{trialErrorMessage(trial.errorCode)}</WireError>}
            <WireButton
              variant="neutral"
              disabled={trial.status === 'queued' || trial.status === 'running'}
              onClick={onRemoveTrial}
            >
              시험 기록 지우기
            </WireButton>
          </>
        )}
      </WireCard>

      <WireCard as="section" labelledBy="stt-result-heading" title={<h2 id="stt-result-heading">전사 결과</h2>}>
        {transcriptError !== null ? (
          <>
            <WireError>{transcriptError.message}</WireError>
            <WireButton variant="neutral" onClick={transcriptError.onRetry}>전사 결과 다시 불러오기</WireButton>
          </>
        ) : transcript === null ? (
          <WireEmpty>아직 결과가 없습니다.</WireEmpty>
        ) : (
          <>
            <WireCardSection title="발화 구간">
              {speechSegments.length === 0 ? (
                <WireEmpty>구간이 없습니다.</WireEmpty>
              ) : (
                <WireDataRows>
                  {speechSegments.map((segment, index) => (
                    <WireDataRow
                      key={`${segment.start}-${index}`}
                      label={`${formatTimecode(segment.start)} - ${formatTimecode(segment.end)}`}
                      value={
                        <>
                          {segment.speaker !== undefined && <span className="panel-meta">{segment.speaker}</span>}
                          {segment.speaker !== undefined && ' '}
                          {segment.text}
                        </>
                      }
                    />
                  ))}
                </WireDataRows>
              )}
            </WireCardSection>

            <WireCardSection title="화자 ID">
              {speakerProvided ? '파일별 익명 ID 로 제공됨' : SPEAKER_NOT_PROVIDED}
            </WireCardSection>

            <WireCardSection title="반복 경고" tone="lavender">
              {transcript.repetitionWarnings.length === 0 && warningSegments.length === 0 ? (
                <WireEmpty>없습니다.</WireEmpty>
              ) : (
                <WireDataRows>
                  {transcript.repetitionWarnings.map((warning, index) => (
                    <WireDataRow
                      key={`repetition-${warning.start}-${index}`}
                      label={`${formatTimecode(warning.start)} - ${formatTimecode(warning.end)}`}
                      value={`반복 ${warning.count}회`}
                    />
                  ))}
                  {warningSegments.map((segment, index) => (
                    <WireDataRow
                      key={`warning-${segment.start}-${index}`}
                      label={`${formatTimecode(segment.start)} - ${formatTimecode(segment.end)}`}
                      value={
                        <>
                          <WireBadge tone="lavender">경고 줄</WireBadge> {segment.text}
                        </>
                      }
                    />
                  ))}
                </WireDataRows>
              )}
            </WireCardSection>

            <WireCardSection title="무음 경계 분할">{`${transcript.forcedCuts}회`}</WireCardSection>

            <WireCardSection title="품질 평가">후속 단계입니다.</WireCardSection>
          </>
        )}
      </WireCard>
    </GridContainer>
  );
}
