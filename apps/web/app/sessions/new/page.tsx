import { redirect } from 'next/navigation';

export default function LegacyNewSessionPage() {
  // Values supplied to this obsolete entry route are never forwarded.
  // Participant and participation-program selection starts at the canonical home route.
  redirect('/');
}
