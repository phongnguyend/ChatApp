import { LoaderCircle, Radio } from "lucide-react";
import { useState } from "react";

type LiveLocationShareButtonProps = {
  disabled?: boolean;
  isStarting: boolean;
  onStart: (durationMinutes: number) => Promise<void>;
  onError: (message: string) => void;
};

const DURATIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 480, label: "8 hours" },
];

export function LiveLocationShareButton({
  disabled = false,
  isStarting,
  onStart,
  onError,
}: LiveLocationShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  async function start(durationMinutes: number) {
    onError("");
    try {
      await onStart(durationMinutes);
      setIsOpen(false);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Live location sharing could not start.",
      );
    }
  }

  return (
    <>
      <button
        className="live-location-button"
        type="button"
        disabled={disabled || isStarting}
        aria-label="Share live location"
        title="Share live location"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isStarting ? (
          <LoaderCircle className="spin" size={18} />
        ) : (
          <Radio size={18} />
        )}
      </button>
      {isOpen && !disabled && (
        <div className="live-location-duration-menu">
          <strong>Share live location for</strong>
          {DURATIONS.map((duration) => (
            <button
              type="button"
              key={duration.minutes}
              disabled={isStarting}
              onClick={() => void start(duration.minutes)}
            >
              {duration.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
