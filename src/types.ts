export type PlayerState = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  pitch: number; // in semitones
  volume: number;
  isLooping: boolean;
  cycleStart: number | null;
  cycleEnd: number | null;
  clipStart: number;
  clipEnd: number | null;
  mediaUrl: string | null;
  mediaType: 'audio' | 'video' | 'youtube' | null;
  fileName: string | null;
  loopDelay: number;
  isReady: boolean;
  isBuffering: boolean;
};
