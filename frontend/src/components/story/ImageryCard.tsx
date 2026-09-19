import { cn } from '@/lib/utils';

interface ImageryCardProps {
  src?: string;
  alt: string;
  sensor: string;
  channel: string;
  capturedAt: string;
  synthetic: boolean;
  className?: string;
}

/**
 * Image with 1px border and 10px radius, caption beneath in two lines: sensor
 * and channel on line one, UTC timestamp on line two, both 12px muted. A
 * synthetic frame never claims a real sensor and timestamp — the caption
 * states it is synthetic instead.
 */
export function ImageryCard({
  src,
  alt,
  sensor,
  channel,
  capturedAt,
  synthetic,
  className,
}: ImageryCardProps) {
  const sensorLine = synthetic ? `Synthetic frame · ${channel}` : `${sensor} · ${channel}`;
  const timeLine = synthetic ? `${capturedAt} · synthetic, illustrative` : `${capturedAt} · UTC`;

  return (
    <figure className={cn('story-imagery', className)}>
      <div className="story-imagery__frame">
        {src ? (
          <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div className="story-imagery__placeholder">
            <span>— no frame available —</span>
            {synthetic && <span>synthetic render</span>}
          </div>
        )}
      </div>
      <figcaption className="story-imagery__caption">
        <p className="story-imagery__sensor">{sensorLine}</p>
        <p className="story-imagery__timestamp">{timeLine}</p>
      </figcaption>
    </figure>
  );
}