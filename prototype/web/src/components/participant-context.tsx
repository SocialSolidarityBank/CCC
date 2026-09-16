import { useEffect, useState } from 'react';
import { ParticipantHeroCard } from '../../../../apps/web/app/components/wire/participant-hero-card';
import { api, type Participant } from '../lib/api';

export function ParticipantContext({ participantId }: { participantId: string }) {
  const [participant, setParticipant] = useState<Participant | null>(null);

  useEffect(() => {
    let active = true;
    api.participant(participantId).then((value) => {
      if (active) setParticipant(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [participantId]);

  return <ParticipantHeroCard name={participant?.name ?? null} beneficiaryId={participantId} />;
}
