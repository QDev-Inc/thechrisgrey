import { typography } from '../../utils/typography';
import { Waitlist } from './Waitlist';
import Icon from '../icons/Icon';

interface RateLimitedCardProps {
  message: string;
}

export function RateLimitedCard({ message }: RateLimitedCardProps) {
  return (
    <div className="space-y-6">
      <div className="p-6 rounded-lg border border-altivum-gold/30 bg-altivum-navy/60" role="status" aria-live="polite">
        <div className="flex items-start gap-3">
          <Icon name="hourglass_bottom" className="text-altivum-gold shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-white mb-2" style={typography.cardTitleSmall}>
              You've used your free blueprint for this 30-day window.
            </h3>
            <p className="text-altivum-silver" style={typography.bodyText}>
              {message}
            </p>
            <p className="text-altivum-silver/80 mt-3" style={typography.smallText}>
              The free tier includes a limited number of architecture generations. A higher-limit Pro tier is coming —
              join the waitlist below to hear about it first.
            </p>
          </div>
        </div>
      </div>

      <Waitlist
        heading="Want more blueprints?"
        subheading="Join the Pro waitlist for higher limits, private blueprints, and priority generation."
      />
    </div>
  );
}

export default RateLimitedCard;
