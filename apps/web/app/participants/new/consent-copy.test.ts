import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONSENT_DETAIL_SECTIONS as canonicalSections,
  CONSENT_PRIVACY_NOTICE_TEXT,
  CONSENT_PRIVACY_SECTIONS as canonicalPrivacySections,
  CONSENT_RECORDING_AI_SECTIONS as canonicalRecordingAiSections,
} from '../../../../../db/consent-notice';
import {
  CONSENT_DETAIL_SECTIONS,
  CONSENT_PRIVACY_SECTIONS,
  CONSENT_RECORDING_AI_SECTIONS,
} from './consent-copy';

describe('consent copy single source (CCC-125)', () => {
  it('renders the canonical sections without a copied screen variant', () => {
    expect(CONSENT_DETAIL_SECTIONS).toBe(canonicalSections);
    expect(CONSENT_PRIVACY_SECTIONS).toBe(canonicalPrivacySections);
    expect(CONSENT_RECORDING_AI_SECTIONS).toBe(canonicalRecordingAiSections);
  });

  it('derives the privacy notice hash input from the same canonical sections', () => {
    const rendered = canonicalPrivacySections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.items ?? []),
    ]).join('\n');

    expect(CONSENT_PRIVACY_NOTICE_TEXT).toBe(rendered);
  });

  it('keeps each checkbox detail focused on its own rejection guidance', () => {
    const privacyParagraphs = CONSENT_PRIVACY_SECTIONS.at(-1)?.paragraphs ?? [];
    const recordingAiParagraphs = CONSENT_RECORDING_AI_SECTIONS.at(-1)?.paragraphs ?? [];

    expect(privacyParagraphs).toHaveLength(2);
    expect(recordingAiParagraphs).toHaveLength(1);
    expect(privacyParagraphs).not.toEqual(expect.arrayContaining(recordingAiParagraphs));
  });

  it('keeps the legal-review markdown copy exactly aligned with the canonical screen lines', () => {
    const path = resolve(process.cwd(), '../../docs/consent/consent-draft-v0.md');
    const markdown = readFileSync(path, 'utf8');
    const sourceLines: string[] = [];
    let insideConsentCopy = false;

    for (const rawLine of markdown.split('\n')) {
      if (/^## [1-6]\. /.test(rawLine)) insideConsentCopy = true;
      if (!insideConsentCopy) continue;
      if (rawLine === '---') break;
      if (rawLine.length === 0 || rawLine.startsWith('>')) continue;
      sourceLines.push(
        rawLine
          .replace(/^- /, '')
          .replaceAll('**', '')
          .replace('(D49)', ''),
      );
    }

    const canonicalLines = canonicalSections.flatMap((section) => [
      `## ${section.heading}`,
      ...(section.paragraphs ?? []),
      ...(section.items ?? []),
    ]);
    expect(sourceLines).toEqual(canonicalLines);
  });
});
