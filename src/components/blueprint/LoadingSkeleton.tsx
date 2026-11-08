import { typography } from '../../utils/typography';

const MESSAGES = [
  'Sketching the data flow…',
  'Picking services that fit the budget…',
  'Drafting the IaC scaffold…',
  'Scoping IAM policies…',
  'Shaping Claude artifacts…',
  'Checking the diagram…',
];

interface LoadingSkeletonProps {
  message?: string;
}

export function LoadingSkeleton({ message }: LoadingSkeletonProps) {
  return (
    <div role="status" aria-live="polite" aria-label="Generating blueprint" className="space-y-6">
      <div className="flex items-center gap-3 text-altivum-silver" style={typography.bodyText}>
        <span
          className="w-5 h-5 border-2 border-altivum-gold/30 border-t-altivum-gold rounded-full animate-spin"
          aria-hidden="true"
        />
        <span>{message ?? 'Designing your architecture…'}</span>
      </div>

      <ul className="space-y-2 text-altivum-silver/70" style={typography.smallText}>
        {MESSAGES.map((msg) => (
          <li key={msg} className="flex items-start gap-2">
            <span className="text-altivum-gold/60 mt-0.5" aria-hidden="true">
              •
            </span>
            <span>{msg}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <div className="h-24 rounded-lg bg-altivum-navy/40 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-32 rounded-lg bg-altivum-navy/40 animate-pulse" />
          <div className="h-32 rounded-lg bg-altivum-navy/40 animate-pulse" />
        </div>
        <div className="h-48 rounded-lg bg-altivum-navy/40 animate-pulse" />
      </div>
    </div>
  );
}

export default LoadingSkeleton;
