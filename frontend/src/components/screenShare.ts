const SCREEN_SHARE_MAX_WIDTH = 1920;
const SCREEN_SHARE_MAX_HEIGHT = 1080;
const SCREEN_SHARE_FRAMES_PER_SECOND = 15;
const SCREEN_SHARE_MAX_BITRATE = 1_800_000;

type ExtendedDisplayMediaStreamOptions = DisplayMediaStreamOptions & {
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
};

export async function acquireScreenShareStream() {
  const options: ExtendedDisplayMediaStreamOptions = {
    video: {
      width: { ideal: SCREEN_SHARE_MAX_WIDTH },
      height: { ideal: SCREEN_SHARE_MAX_HEIGHT },
      frameRate: { ideal: SCREEN_SHARE_FRAMES_PER_SECOND },
    },
    audio: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    for (const candidate of stream.getTracks()) candidate.stop();
    throw new Error("No screen was selected.");
  }

  track.contentHint = "detail";
  await track
    .applyConstraints({
      width: { max: SCREEN_SHARE_MAX_WIDTH },
      height: { max: SCREEN_SHARE_MAX_HEIGHT },
      frameRate: { max: SCREEN_SHARE_FRAMES_PER_SECOND },
    })
    .catch(() => undefined);
  return stream;
}

export async function optimizeScreenShareSender(sender: RTCRtpSender) {
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) {
    parameters.encodings = [{}];
  }
  parameters.encodings[0].maxBitrate = SCREEN_SHARE_MAX_BITRATE;
  parameters.encodings[0].maxFramerate =
    SCREEN_SHARE_FRAMES_PER_SECOND;
  parameters.degradationPreference = "maintain-resolution";
  await sender.setParameters(parameters).catch(() => undefined);
}
