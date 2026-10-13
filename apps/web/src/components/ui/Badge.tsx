import type { ReactNode } from 'react';
import {
  ASSIGNMENT_STATUS_LABELS,
  CONFIDENTIALITY_LABELS,
  JOB_STATUS_LABELS,
  LETTER_STATUS_LABELS,
  OUTGOING_STATUS_LABELS,
  PRIORITY_LABELS,
  PROCESSING_STATUS_LABELS,
  DISPOSITION_STATUS_LABELS,
} from '@sisurat/shared';
import { cn } from '../../lib/cn';

type Tone = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo' | 'orange';
const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

const LETTER_TONE: Record<string, Tone> = {
  DRAFT: 'gray', REGISTERED: 'blue', AWAITING_DISPOSITION: 'yellow', ASSIGNED: 'indigo', IN_PROGRESS: 'purple',
  WAITING_REVIEW: 'orange', NEEDS_REVISION: 'red', COMPLETED: 'green', ARCHIVED: 'gray', CANCELLED: 'gray',
};
const PROCESSING_TONE: Record<string, Tone> = { UPLOADED: 'gray', PROCESSING: 'blue', NEEDS_REVIEW: 'yellow', PROCESSING_FAILED: 'red', VERIFIED: 'green' };
const ASSIGNMENT_TONE: Record<string, Tone> = { ASSIGNED: 'indigo', IN_PROGRESS: 'purple', WAITING_REVIEW: 'orange', NEEDS_REVISION: 'red', COMPLETED: 'green', CANCELLED: 'gray' };
const OUTGOING_TONE: Record<string, Tone> = { DRAFT: 'gray', WAITING_REVIEW: 'orange', NEEDS_REVISION: 'red', APPROVED: 'blue', FINAL: 'green', CANCELLED: 'gray' };
const JOB_TONE: Record<string, Tone> = { QUEUED: 'gray', RUNNING: 'blue', SUCCEEDED: 'green', FAILED: 'red', CANCELLED: 'gray' };
const PRIORITY_TONE: Record<string, Tone> = { RENDAH: 'gray', NORMAL: 'blue', TINGGI: 'orange', SEGERA: 'red' };
const CONF_TONE: Record<string, Tone> = { BIASA: 'gray', TERBATAS: 'yellow', RAHASIA: 'red' };

type Kind = 'letter' | 'processing' | 'assignment' | 'outgoing' | 'job' | 'priority' | 'confidentiality' | 'disposition';
const MAP: Record<Kind, [Record<string, string>, Record<string, Tone>]> = {
  letter: [LETTER_STATUS_LABELS, LETTER_TONE],
  processing: [PROCESSING_STATUS_LABELS, PROCESSING_TONE],
  assignment: [ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_TONE],
  outgoing: [OUTGOING_STATUS_LABELS, OUTGOING_TONE],
  job: [JOB_STATUS_LABELS, JOB_TONE],
  priority: [PRIORITY_LABELS, PRIORITY_TONE],
  confidentiality: [CONFIDENTIALITY_LABELS, CONF_TONE],
  disposition: [DISPOSITION_STATUS_LABELS, { ACTIVE: 'indigo', COMPLETED: 'green', CANCELLED: 'gray' }],
};

/** Consistent status badge across the app. */
export function StatusBadge({ kind, value }: { kind: Kind; value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">-</span>;
  const [labels, toneMap] = MAP[kind];
  return <Badge tone={toneMap[value] ?? 'gray'}>{labels[value] ?? value}</Badge>;
}
