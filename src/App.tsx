/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactPlayer from 'react-player';
import WaveSurfer from 'wavesurfer.js';
import * as Tone from 'tone';
import { 
  Play, Pause, SkipBack, SkipForward, 
  RotateCcw, RotateCw, Scissors, Repeat, 
  Trash2, Music, Video, 
  Youtube, Upload, X, ChevronUp, ChevronDown,
  Keyboard, Plus, Settings, Volume2, VolumeX,
  FastForward, Rewind
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { PlayerState } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const INITIAL_STATE: PlayerState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  pitch: 0,
  volume: 0.8,
  isLooping: false,
  cycleStart: null,
  cycleEnd: null,
  clipStart: 0,
  clipEnd: null,
  mediaUrl: null,
  mediaType: null,
  fileName: null,
};

export default function App() {
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSkipMenu, setActiveSkipMenu] = useState<'single' | 'double' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [skipIntervals, setSkipIntervals] = useState({ single: 5, double: 10 });
  const [draggingHandle, setDraggingHandle] = useState<'clipStart' | 'clipEnd' | 'cycleStart' | 'cycleEnd' | 'playhead' | null>(null);
  const [isSelectingCycle, setIsSelectingCycle] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const playerRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const pitchShiftRef = useRef<any>(null);
  const toneSourceRef = useRef<any>(null);
  const mouseDownRef = useRef<{ x: number; time: number } | null>(null);
  const lastSpaceTap = useRef<number>(0);
  const spaceTimer = useRef<NodeJS.Timeout | null>(null);
  const isHoldingSpace = useRef(false);
  const isHoldingShift = useRef(false);
  const lastArrowTap = useRef<{ [key: string]: number }>({ ArrowLeft: 0, ArrowRight: 0 });
  const arrowTimer = useRef<{ [key: string]: NodeJS.Timeout | null }>({ ArrowLeft: null, ArrowRight: null });
  const lastValidCycle = useRef<{ start: number | null, end: number | null, isLooping: boolean } | null>(null);

  // Global Drag and Drop Handlers
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragOver = (e: DragEvent) => {
      preventDefault(e);
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        e.dataTransfer.dropEffect = 'copy';
        setIsDragging(true);
      }
    };

    const handleDragEnter = (e: DragEvent) => {
      preventDefault(e);
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      preventDefault(e);
      if (e.relatedTarget === null) {
        setIsDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      preventDefault(e);
      setIsDragging(false);
      
      const file = e.dataTransfer?.files[0];
      if (file && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
        loadLocalFile(file);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Cleanup Object URLs to prevent memory leaks and "aborted" errors
  useEffect(() => {
    const currentUrl = state.mediaUrl;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [state.mediaUrl]);

  // Initialize WaveSurfer - Stable version
  useEffect(() => {
    if (!waveformContainerRef.current || !state.mediaUrl || state.mediaType === 'youtube') return;

    const ws = WaveSurfer.create({
      container: waveformContainerRef.current,
      waveColor: '#4f46e5',
      progressColor: '#818cf8',
      cursorColor: '#f59e0b',
      height: 80,
      // normalize: true,
      barHeight: .9,
      interact: false, // Disable default interaction to handle our own click/drag
      media: state.mediaType === 'video' ? videoRef.current || undefined : undefined,
    });

    ws.on('ready', () => {
      setState(prev => ({ ...prev, duration: ws.getDuration(), clipEnd: prev.clipEnd === null ? ws.getDuration() : prev.clipEnd }));
      
      // Initialize Tone.js for pitch shifting (only for local files)
      if (state.mediaType !== 'youtube') {
        const mediaElement = ws.getMediaElement();
        if (mediaElement && !pitchShiftRef.current) {
          const pitchShift = new Tone.PitchShift().toDestination();
          const source = Tone.getContext().createMediaElementSource(mediaElement);
          
          // Initial connection logic
          if (state.pitch === 0) {
            Tone.connect(source, Tone.getDestination());
            pitchShift.wet.value = 0;
          } else {
            Tone.connect(source, pitchShift);
            pitchShift.pitch = state.pitch;
            pitchShift.wet.value = 1;
          }
          
          pitchShiftRef.current = pitchShift;
          toneSourceRef.current = source;
        }
      }
    });

    ws.on('timeupdate', (time) => {
      setState(prev => ({ ...prev, currentTime: time }));
    });

    wavesurferRef.current = ws;
    ws.load(state.mediaUrl).catch(err => {
      if (err.name !== 'AbortError') console.error('WaveSurfer load error:', err);
    });

    return () => {
      ws.destroy();
      if (pitchShiftRef.current) {
        try {
          pitchShiftRef.current.dispose();
        } catch (e) {
          console.error('Error disposing pitchShift:', e);
        }
        pitchShiftRef.current = null;
      }
      if (toneSourceRef.current) {
        try {
          // toneSourceRef.current is a MediaElementAudioSourceNode, not a Tone object
          toneSourceRef.current.disconnect();
        } catch (e) {
          console.error('Error disconnecting toneSource:', e);
        }
        toneSourceRef.current = null;
      }
    };
  }, [state.mediaUrl, state.mediaType]);

  // Handle Looping and Clip End Logic
  useEffect(() => {
    if (!wavesurferRef.current) return;
    const ws = wavesurferRef.current;

    const checkLoop = (time: number) => {
      if (state.isLooping && state.cycleStart !== null && state.cycleEnd !== null) {
        if (time >= state.cycleEnd) {
          ws.setTime(state.cycleStart);
        }
      }
      
      if (state.clipEnd !== null && time >= state.clipEnd) {
        ws.pause();
        ws.setTime(state.clipStart);
        setState(prev => ({ ...prev, isPlaying: false }));
      }
    };

    const unsubscribe = ws.on('timeupdate', checkLoop);
    return () => unsubscribe();
  }, [state.isLooping, state.cycleStart, state.cycleEnd, state.clipEnd, state.clipStart]);

  // Handle Media Loading
  const loadLocalFile = (file: File) => {
    if (wavesurferRef.current) wavesurferRef.current.pause();
    
    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('video') ? 'video' : 'audio';
    const newState = { 
      ...INITIAL_STATE, 
      mediaUrl: url, 
      mediaType: type as any, 
      fileName: file.name 
    };
    setState(newState);
  };

  const loadYoutube = () => {
    if (ReactPlayer.canPlay(youtubeUrl)) {
      const newState = { 
        ...INITIAL_STATE, 
        mediaUrl: youtubeUrl, 
        mediaType: 'youtube' as any, 
        fileName: 'YouTube Video' 
      };
      setState(newState);
    }
  };

  const Player = ReactPlayer as any;

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;

        const now = Date.now();
        const isDoubleTap = now - lastSpaceTap.current < 300;
        
        if (isDoubleTap) {
          if (spaceTimer.current) clearTimeout(spaceTimer.current);
          const targetRate = e.shiftKey ? 0.5 : 2;
          setState(prev => ({ 
            ...prev, 
            playbackRate: prev.playbackRate === targetRate ? 1 : targetRate 
          }));
          lastSpaceTap.current = 0;
        } else {
          lastSpaceTap.current = now;
          isHoldingSpace.current = true;
          isHoldingShift.current = e.shiftKey;
          
          spaceTimer.current = setTimeout(() => {
            if (isHoldingSpace.current) {
              setState(prev => ({ ...prev, playbackRate: e.shiftKey ? 0.5 : 2, isPlaying: true }));
            } else {
              setState(prev => {
                const isStarting = !prev.isPlaying;
                let nextTime = prev.currentTime;
                
                // If starting playback and playhead is before clip/cycle start, jump to start
                if (isStarting) {
                  let lowerBound = prev.clipStart;
                  if (prev.isLooping && prev.cycleStart !== null) {
                    lowerBound = Math.max(lowerBound, prev.cycleStart);
                  }
                  if (prev.currentTime < lowerBound) {
                    nextTime = lowerBound;
                    if (wavesurferRef.current) wavesurferRef.current.setTime(nextTime);
                    if (playerRef.current) playerRef.current.seekTo(nextTime);
                  }
                }
                
                return { ...prev, isPlaying: isStarting, currentTime: nextTime };
              });
            }
            spaceTimer.current = null;
          }, 200);
        }
      }

      if (e.code === 'Enter') {
        e.preventDefault();
        const targetTime = state.isLooping && state.cycleStart !== null ? state.cycleStart : state.clipStart;
        if (wavesurferRef.current) wavesurferRef.current.setTime(targetTime);
        if (playerRef.current) playerRef.current.seekTo(targetTime);
      }

      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const key = e.code;
        const now = Date.now();
        const isDoubleTap = now - lastArrowTap.current[key] < 300;
        
        if (arrowTimer.current[key]) {
          clearTimeout(arrowTimer.current[key]!);
          arrowTimer.current[key] = null;
        }

        const performSkip = (interval: number) => {
          const direction = key === 'ArrowRight' ? 1 : -1;
          let newTime = state.currentTime + direction * interval;
          
          // Respect boundaries
          if (direction === -1) {
            let lowerBound = state.clipStart;
            // If in a cycle, don't skip past the cycle start
            if (state.isLooping && state.cycleStart !== null) {
              lowerBound = Math.max(lowerBound, state.cycleStart);
            }
            newTime = Math.max(lowerBound, newTime);
          } else {
            newTime = Math.min(state.clipEnd || state.duration, newTime);
          }
          
          if (wavesurferRef.current) wavesurferRef.current.setTime(newTime);
          if (playerRef.current) playerRef.current.seekTo(newTime);
        };

        if (isDoubleTap) {
          performSkip(skipIntervals.double);
          lastArrowTap.current[key] = 0;
        } else {
          lastArrowTap.current[key] = now;
          arrowTimer.current[key] = setTimeout(() => {
            performSkip(skipIntervals.single);
            arrowTimer.current[key] = null;
          }, 350); // Increased delay for better double-tap detection
        }
      }

      if (e.key.toLowerCase() === 'k') {
        setState(prev => ({ 
          ...prev, 
          cycleStart: prev.currentTime,
          isLooping: prev.cycleEnd !== null
        }));
      }

      if (e.key.toLowerCase() === 'l') {
        setState(prev => ({ 
          ...prev, 
          cycleEnd: prev.currentTime, 
          isLooping: prev.cycleStart !== null 
        }));
      }

      if (e.code === 'Escape') {
        if (state.playbackRate !== 1) {
          setState(prev => ({ ...prev, playbackRate: 1 }));
        } else if (state.isLooping || state.cycleStart !== null || state.cycleEnd !== null) {
          setState(prev => ({ ...prev, isLooping: false, cycleStart: null, cycleEnd: null }));
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (isHoldingSpace.current && !spaceTimer.current) {
          setState(prev => ({ ...prev, playbackRate: 1 }));
        }
        isHoldingSpace.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [state, skipIntervals]);

  // Handle Handle Dragging
  useEffect(() => {
    if (!draggingHandle) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!waveformContainerRef.current) return;
      const rect = waveformContainerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const time = (x / rect.width) * state.duration;

      setState(prev => {
        const newState = { ...prev };
        if (draggingHandle === 'clipStart') {
          const maxStart = prev.cycleStart !== null && prev.cycleEnd !== null 
            ? Math.min(prev.cycleStart, prev.cycleEnd) 
            : (prev.clipEnd || state.duration);
          newState.clipStart = Math.min(time, maxStart);
        }
        if (draggingHandle === 'clipEnd') {
          const minEnd = prev.cycleStart !== null && prev.cycleEnd !== null 
            ? Math.max(prev.cycleStart, prev.cycleEnd) 
            : prev.clipStart;
          newState.clipEnd = Math.max(time, minEnd);
        }
        if (draggingHandle === 'cycleStart') {
          newState.cycleStart = Math.max(prev.clipStart, Math.min(time, prev.clipEnd || state.duration));
          newState.isLooping = newState.cycleEnd !== null;
        }
        if (draggingHandle === 'cycleEnd') {
          newState.cycleEnd = Math.max(prev.clipStart, Math.min(time, prev.clipEnd || state.duration));
          newState.isLooping = newState.cycleStart !== null;
        }
        if (draggingHandle === 'playhead') {
          let lowerBound = prev.clipStart;
          if (prev.isLooping && prev.cycleStart !== null) {
            lowerBound = Math.max(lowerBound, prev.cycleStart);
          }
          const nextTime = Math.max(lowerBound, time);
          newState.currentTime = nextTime;
          if (wavesurferRef.current) wavesurferRef.current.setTime(nextTime);
          if (playerRef.current) playerRef.current.seekTo(nextTime);
        }
        return newState;
      });
    };

    const handleMouseUp = () => {
      if (draggingHandle === 'cycleStart' || draggingHandle === 'cycleEnd') {
        setState(prev => {
          if (prev.cycleStart !== null && prev.cycleEnd !== null) {
            const start = Math.min(prev.cycleStart, prev.cycleEnd);
            const end = Math.max(prev.cycleStart, prev.cycleEnd);
            const duration = end - start;

            // Enforce 1s minimum duration even when adjusting
            if (duration < 1) {
              // Revert to last valid cycle if it exists
              if (lastValidCycle.current) {
                const { start: oldStart, end: oldEnd, isLooping: oldIsLooping } = lastValidCycle.current;
                if (wavesurferRef.current && oldStart !== null) wavesurferRef.current.setTime(oldStart);
                if (playerRef.current && oldStart !== null) playerRef.current.seekTo(oldStart);
                return {
                  ...prev,
                  cycleStart: oldStart,
                  cycleEnd: oldEnd,
                  isLooping: oldIsLooping,
                  currentTime: oldStart !== null ? Math.max(oldStart, prev.currentTime) : prev.currentTime
                };
              }
              return {
                ...prev,
                cycleStart: null,
                cycleEnd: null,
                isLooping: false
              };
            }

            if (wavesurferRef.current) wavesurferRef.current.setTime(start);
            if (playerRef.current) playerRef.current.seekTo(start);
            return { 
              ...prev, 
              cycleStart: start,
              cycleEnd: end,
              currentTime: start 
            };
          }
          return prev;
        });
      }
      setDraggingHandle(null);
      lastValidCycle.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingHandle, state.duration]);

  // Handle Cycle Selection Dragging
  useEffect(() => {
    if (!isSelectingCycle) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!waveformContainerRef.current) return;
      const rect = waveformContainerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const time = (x / rect.width) * state.duration;

      setState(prev => ({
        ...prev,
        cycleEnd: Math.max(prev.clipStart, Math.min(time, prev.clipEnd || state.duration))
      }));
    };

    const handleMouseUp = () => {
      setIsSelectingCycle(false);
      setSelectionStart(null);
      setState(prev => {
        if (prev.cycleStart === null || prev.cycleEnd === null) return prev;

        const start = Math.min(prev.cycleStart, prev.cycleEnd);
        const end = Math.max(prev.cycleStart, prev.cycleEnd);
        const duration = end - start;

        if (duration < 1) {
          // Discard cycle if less than 1s
          return {
            ...prev,
            cycleStart: null,
            cycleEnd: null,
            isLooping: false
          };
        }

        // Seek to start of cycle
        if (wavesurferRef.current) wavesurferRef.current.setTime(start);
        if (playerRef.current) playerRef.current.seekTo(start);

        return {
          ...prev,
          cycleStart: start,
          cycleEnd: end,
          currentTime: start,
          isLooping: true
        };
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSelectingCycle, state.duration]);

  // Sync state with WaveSurfer, ReactPlayer, and Tone.js
  useEffect(() => {
    if (wavesurferRef.current) {
      if (state.isPlaying) {
        // Resume Tone context on play
        if (Tone.getContext().state !== 'running') {
          Tone.start().catch(err => console.error('Tone start error:', err));
        }
        wavesurferRef.current.play().catch(err => {
          if (err.name !== 'AbortError') console.error('Playback error:', err);
        });
      } else {
        wavesurferRef.current.pause();
      }
      wavesurferRef.current.setPlaybackRate(state.playbackRate);
      wavesurferRef.current.setVolume(state.volume);
    }

    // Handle Pitch Shift "Unloading" (Bypassing)
    if (toneSourceRef.current && pitchShiftRef.current) {
      try {
        toneSourceRef.current.disconnect();
        if (state.pitch === 0) {
          // Connect directly to destination to avoid any processing artifacts
          Tone.connect(toneSourceRef.current, Tone.getDestination());
          pitchShiftRef.current.wet.value = 0;
        } else {
          // Connect through pitch shifter
          Tone.connect(toneSourceRef.current, pitchShiftRef.current);
          pitchShiftRef.current.pitch = state.pitch;
          pitchShiftRef.current.wet.value = 1;
        }
      } catch (e) {
        console.error("Error syncing pitch shift:", e);
      }
    }
    
    // Sync volume to Tone.js destination
    Tone.getDestination().volume.value = Tone.gainToDb(state.volume);
  }, [state.isPlaying, state.playbackRate, state.pitch, state.volume]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-indigo-500/30 relative">
      {/* Global Drag Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-indigo-600/20 backdrop-blur-sm border-4 border-dashed border-indigo-500 m-4 rounded-3xl flex flex-col items-center justify-center pointer-events-none"
          >
            <div className="w-24 h-24 rounded-full bg-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-500/40 mb-6">
              <Upload className="text-white animate-bounce" size={48} />
            </div>
            <h2 className="text-3xl font-bold">Drop to Load Media</h2>
            <p className="text-white/60 mt-2">Audio and Video files supported</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="p-4 border-b border-white/10 flex items-center justify-between bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Music className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Virtuoso</h1>
            <p className="text-xs text-white/40 font-mono uppercase tracking-widest">Practice Tool</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.fileName && (
            <div className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-full flex items-center gap-2 group">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-white/70 truncate max-w-[200px]">
                {state.fileName}
              </span>
              <button 
                onClick={() => {
                  if (wavesurferRef.current) wavesurferRef.current.pause();
                  setState(INITIAL_STATE);
                }}
                className="p-0.5 hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                title="Close Media"
              >
                <X size={14} className="text-white/50 hover:text-white" />
              </button>
            </div>
          )}

          <button 
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'audio/*,video/*';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) loadLocalFile(file);
              };
              input.click();
            }}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/70 hover:text-white"
            title="Load New File"
          >
            <Plus size={20} />
          </button>

          <div className="w-px h-6 bg-white/10 mx-2" />
          <button 
            onClick={() => setShowShortcuts(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors border border-white/10"
          >
            <Keyboard size={16} />
            <span>Shortcuts</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Media Loader */}
        {!state.mediaUrl && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ 
              opacity: 1, 
              y: 0,
              scale: isDragging ? 0.98 : 1,
              borderColor: isDragging ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255, 255, 255, 0.1)'
            }}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'audio/*,video/*';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) loadLocalFile(file);
              };
              input.click();
            }}
            className={cn(
              "aspect-video border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-6 transition-all duration-500 cursor-pointer",
              isDragging ? "bg-indigo-500/5" : "bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/20"
            )}
          >
            <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-500/10 transition-all duration-500">
              <Upload className="text-white/20 group-hover:text-indigo-400 transition-colors" size={40} />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-medium text-white/80">Drop or Click to load audio/video</p>
              <p className="text-sm text-white/40">or paste a YouTube URL below</p>
            </div>
            
            <div 
              className="flex w-full max-w-md gap-2 p-2 bg-white/5 rounded-2xl border border-white/10 focus-within:border-indigo-500/50 transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <input 
                type="text" 
                placeholder="https://youtube.com/watch?v=..." 
                className="flex-1 bg-transparent border-none focus:ring-0 px-4 text-sm"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
              />
              <button 
                onClick={loadYoutube}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition-colors"
              >
                Load
              </button>
            </div>
          </motion.div>
        )}

        {/* Player Area */}
        {state.mediaUrl && (
          <div className="space-y-6">
            <div 
              className="relative group cursor-pointer"
              onClick={() => setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
            >
              <div className="aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/10">
                {state.mediaType === 'youtube' ? (
                  <Player
                    ref={playerRef}
                    url={state.mediaUrl}
                    width="100%"
                    height="100%"
                    playing={state.isPlaying}
                    playbackRate={state.playbackRate}
                    volume={state.volume}
                    onProgress={(p: any) => setState(prev => ({ ...prev, currentTime: p.playedSeconds }))}
                    onReady={(player: any) => {
                      const d = player.getDuration();
                      setState(prev => ({ ...prev, duration: d, clipEnd: prev.clipEnd === null ? d : prev.clipEnd }));
                    }}
                  />
                ) : state.mediaType === 'video' ? (
                  <video 
                    ref={videoRef}
                    src={state.mediaUrl} 
                    className="w-full h-full"
                    onTimeUpdate={(e) => {
                      const currentTime = e.currentTarget.currentTime;
                      setState(prev => ({ ...prev, currentTime }));
                    }}
                    onLoadedMetadata={(e) => {
                      const duration = e.currentTarget.duration;
                      setState(prev => ({ ...prev, duration, clipEnd: prev.clipEnd === null ? duration : prev.clipEnd }));
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-900/20 to-black">
                    <div className="relative">
                      <motion.div 
                        animate={{ scale: state.isPlaying ? [1, 1.1, 1] : 1 }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="w-32 h-32 rounded-full bg-indigo-500/10 flex items-center justify-center"
                      >
                        <Music className="text-indigo-400" size={48} />
                      </motion.div>
                    </div>
                    <p className="mt-6 text-lg font-medium text-white/60">{state.fileName}</p>
                  </div>
                )}
              </div>
              
              {/* Transparent click layer to capture clicks over iframe/video */}
              <div className="absolute inset-0 z-10" />
              
              {/* Overlay Controls (Hidden by default, shown on hover) */}
              <div className="absolute inset-0 z-20 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-6 pb-8 pointer-events-none">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    let lowerBound = state.clipStart;
                    if (state.isLooping && state.cycleStart !== null) {
                      lowerBound = Math.max(lowerBound, state.cycleStart);
                    }
                    const newTime = Math.max(lowerBound, state.currentTime - skipIntervals.single);
                    if (wavesurferRef.current) wavesurferRef.current.setTime(newTime);
                    if (playerRef.current) playerRef.current.seekTo(newTime);
                  }} 
                  className="p-3 hover:bg-white/10 rounded-full transition-all hover:scale-110 text-white/80 pointer-events-auto"
                >
                  <RotateCcw size={24} />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setState(prev => {
                      const isStarting = !prev.isPlaying;
                      let nextTime = prev.currentTime;
                      
                      // If starting playback and playhead is before cycle start, jump to cycle start
                      if (isStarting && prev.isLooping && prev.cycleStart !== null && prev.currentTime < prev.cycleStart) {
                        nextTime = prev.cycleStart;
                        if (wavesurferRef.current) wavesurferRef.current.setTime(nextTime);
                        if (playerRef.current) playerRef.current.seekTo(nextTime);
                      }
                      
                      return { ...prev, isPlaying: isStarting, currentTime: nextTime };
                    });
                  }}
                  className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center shadow-xl shadow-indigo-500/40 hover:scale-105 active:scale-95 transition-all text-white pointer-events-auto"
                >
                  {state.isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    const newTime = state.currentTime + skipIntervals.single;
                    if (wavesurferRef.current) wavesurferRef.current.setTime(newTime);
                    if (playerRef.current) playerRef.current.seekTo(newTime);
                  }} 
                  className="p-3 hover:bg-white/10 rounded-full transition-all hover:scale-110 text-white/80 pointer-events-auto"
                >
                  <RotateCw size={24} />
                </button>
              </div>
            </div>

            {/* Unified Control Bar */}
            <div id="unified-control-bar" className="bg-white/5 rounded-3xl border border-white/10 shadow-xl relative">
              {/* Timeline Area */}
              <div id="timeline-area" className="p-4 pb-0 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-white/40 px-1">
                  <span>{formatTime(state.currentTime)}</span>
                  <div className="flex gap-4">
                    {state.cycleStart !== null && <span className="text-amber-400">Cycle: {formatTime(state.cycleStart)} - {state.cycleEnd !== null ? formatTime(state.cycleEnd) : '...'}</span>}
                    <div className="flex gap-3">
                      {state.clipStart !== 0 && <span className="text-indigo-400">Clip Start: {formatTime(state.clipStart)}</span>}
                      {state.clipEnd !== null && state.clipEnd !== state.duration && <span className="text-indigo-400">Clip End: {formatTime(state.clipEnd)}</span>}
                    </div>
                  </div>
                  <span>{formatTime(state.duration)}</span>
                </div>
                
                <div 
                  className="relative bg-white/5 rounded-xl border border-white/5 group/timeline h-20 overflow-visible select-none"
                  draggable="false"
                  onDragStart={(e) => e.preventDefault()}
                  onMouseMove={(e) => {
                    if (!waveformContainerRef.current) return;
                    const rect = waveformContainerRef.current.getBoundingClientRect();
                    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                    const time = (x / rect.width) * state.duration;
                    setHoverTime(time);

                    if (mouseDownRef.current && !draggingHandle && !isSelectingCycle) {
                      const dist = Math.abs(e.clientX - mouseDownRef.current.x);
                      // Reduced threshold to 1px for more immediate feedback
                      if (dist > 1) {
                        setIsSelectingCycle(true);
                        setSelectionStart(mouseDownRef.current.time);
                        setState(prev => {
                          const clampedStart = Math.max(prev.clipStart, Math.min(mouseDownRef.current!.time, prev.clipEnd || state.duration));
                          const clampedEnd = Math.max(prev.clipStart, Math.min(time, prev.clipEnd || state.duration));
                          return { 
                            ...prev, 
                            cycleStart: clampedStart, 
                            cycleEnd: clampedEnd, 
                            isLooping: false 
                          };
                        });
                      }
                    }
                  }}
                  onMouseLeave={() => {
                    setHoverTime(null);
                    mouseDownRef.current = null;
                  }}
                  onMouseDown={(e) => {
                    if (!waveformContainerRef.current) return;
                    const rect = waveformContainerRef.current.getBoundingClientRect();
                    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                    const time = (x / rect.width) * state.duration;
                    mouseDownRef.current = { x: e.clientX, time };
                    const playheadX = (state.currentTime / state.duration) * rect.width;
                    if (Math.abs(x - playheadX) < 10) {
                      setDraggingHandle('playhead');
                      return;
                    }
                  }}
                  onMouseUp={(e) => {
                    if (mouseDownRef.current && !draggingHandle && !isSelectingCycle) {
                      const rect = waveformContainerRef.current!.getBoundingClientRect();
                      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                      let time = (x / rect.width) * state.duration;
                      
                      // Clamp to clip start and cycle start if looping
                      let lowerBound = state.clipStart;
                      if (state.isLooping && state.cycleStart !== null) {
                        lowerBound = Math.max(lowerBound, state.cycleStart);
                      }
                      time = Math.max(lowerBound, time);
                      
                      if (wavesurferRef.current) wavesurferRef.current.setTime(time);
                      if (playerRef.current) playerRef.current.seekTo(time);
                      setState(prev => ({ ...prev, currentTime: time }));
                    }
                    mouseDownRef.current = null;
                  }}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div 
                        ref={waveformContainerRef} 
                        className={cn(
                          "w-full h-20 transition-opacity", 
                          state.mediaType === 'youtube' && "opacity-20"
                        )} 
                      />
                      {state.mediaType === 'youtube' && (
                        <div className="absolute inset-0 flex items-center px-4">
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-indigo-500 transition-all duration-100" 
                              style={{ width: `${(state.currentTime / state.duration) * 100}%` }} 
                            />
                          </div>
                        </div>
                      )}
                      {state.cycleStart !== null && state.cycleEnd !== null && (
                        <div 
                          className="absolute top-0 bottom-0 bg-yellow-400/20 border-x border-yellow-400/50 pointer-events-none z-10"
                          style={{ 
                            left: `${(Math.min(state.cycleStart, state.cycleEnd) / state.duration) * 100}%`,
                            width: `${(Math.abs(state.cycleEnd - state.cycleStart) / state.duration) * 100}%`
                          }}
                        />
                      )}
                      <div 
                        className="absolute top-0 bottom-0 left-0 bg-black/60 pointer-events-none z-20 border-r border-white/20"
                        style={{ width: `${(state.clipStart / state.duration) * 100}%` }}
                      />
                      {state.clipEnd !== null && (
                        <div 
                          className="absolute top-0 bottom-0 right-0 bg-black/60 pointer-events-none z-20 border-l border-white/20"
                          style={{ left: `${(state.clipEnd / state.duration) * 100}%`, right: 0 }}
                        />
                      )}
                    </div>
                  </div>

                  {hoverTime !== null && !draggingHandle && !isSelectingCycle && (
                    <div 
                      className="absolute top-0 bottom-0 w-px bg-yellow-400/50 pointer-events-none z-40"
                      style={{ left: `${(hoverTime / state.duration) * 100}%` }}
                    />
                  )}

                  <div 
                    className="absolute top-0 bottom-0 w-px bg-white z-50 pointer-events-none"
                    style={{ left: `${(state.currentTime / state.duration) * 100}%` }}
                  >
                    <div className="absolute top-0 -left-1 w-2 h-2 bg-white rotate-45 transform origin-center -translate-y-1/2 shadow-lg" />
                  </div>

                  {state.duration > 0 && (
                    <>
                      <div 
                        className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-30 group/handle flex items-center justify-center"
                        style={{ left: `${(state.clipStart / state.duration) * 100}%` }}
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingHandle('clipStart'); }}
                      >
                        <div className="w-[1px] h-full bg-indigo-500 group-hover/handle:w-0.5 transition-all" />
                        <div className="absolute top-0 w-2.5 h-2.5 bg-indigo-500 rounded-full shadow-lg flex items-center justify-center -translate-y-1/2">
                          <div className="w-1 h-1 bg-white rounded-full" />
                        </div>
                      </div>
                      {state.clipEnd !== null && (
                        <div 
                          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-30 group/handle flex items-center justify-center"
                          style={{ left: `${(state.clipEnd / state.duration) * 100}%` }}
                          onMouseDown={(e) => { e.stopPropagation(); setDraggingHandle('clipEnd'); }}
                        >
                          <div className="w-[1px] h-full bg-indigo-500 group-hover/handle:w-0.5 transition-all" />
                          <div className="absolute top-0 w-2.5 h-2.5 bg-indigo-500 rounded-full shadow-lg flex items-center justify-center -translate-y-1/2">
                            <div className="w-1 h-1 bg-white rounded-full" />
                          </div>
                        </div>
                      )}
                      {state.cycleStart !== null && (
                        <div 
                          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-30 group/handle flex items-center justify-center"
                          style={{ left: `${(state.cycleStart / state.duration) * 100}%` }}
                          onMouseDown={(e) => { 
                            e.stopPropagation(); 
                            lastValidCycle.current = { start: state.cycleStart, end: state.cycleEnd, isLooping: state.isLooping };
                            setDraggingHandle('cycleStart'); 
                          }}
                        >
                          <div className="w-[1px] h-full bg-yellow-400 group-hover/handle:w-0.5 transition-all" />
                          <div className="absolute bottom-0 w-2.5 h-2.5 bg-yellow-400 rounded-full shadow-lg flex items-center justify-center translate-y-1/2">
                            <div className="w-1 h-1 bg-black rounded-full" />
                          </div>
                        </div>
                      )}
                      {state.cycleEnd !== null && (
                        <div 
                          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-30 group/handle flex items-center justify-center"
                          style={{ left: `${(state.cycleEnd / state.duration) * 100}%` }}
                          onMouseDown={(e) => { 
                            e.stopPropagation(); 
                            lastValidCycle.current = { start: state.cycleStart, end: state.cycleEnd, isLooping: state.isLooping };
                            setDraggingHandle('cycleEnd'); 
                          }}
                        >
                          <div className="w-[1px] h-full bg-yellow-400 group-hover/handle:w-0.5 transition-all" />
                          <div className="absolute bottom-0 w-2.5 h-2.5 bg-yellow-400 rounded-full shadow-lg flex items-center justify-center translate-y-1/2">
                            <div className="w-1 h-1 bg-black rounded-full" />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Controls Area */}
              <div id="controls-area" className="px-4 py-3 flex items-center justify-between gap-4">
                {/* Left: Playback Controls */}
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-0.5 mr-2 bg-white/5 rounded-xl border border-white/5 p-0.5">
                    <div className="relative">
                      <button 
                        onClick={() => {
                          let lowerBound = state.clipStart;
                          if (state.isLooping && state.cycleStart !== null) {
                            lowerBound = Math.max(lowerBound, state.cycleStart);
                          }
                          const newTime = Math.max(lowerBound, state.currentTime - skipIntervals.single);
                          if (wavesurferRef.current) wavesurferRef.current.setTime(newTime);
                          if (playerRef.current) playerRef.current.seekTo(newTime);
                        }}
                        className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                        title={`Skip Back ${skipIntervals.single}s`}
                      >
                        <Rewind size={18} fill="currentColor" />
                      </button>
                    </div>
                    
                    <div className="relative">
                      <button 
                        onClick={() => setActiveSkipMenu(activeSkipMenu === 'single' ? null : 'single')}
                        className="px-2 h-8 text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-300 hover:bg-white/5 rounded-md transition-all flex items-center cursor-text"
                        title="Click to change skip interval"
                      >
                        {skipIntervals.single}s
                      </button>
                      
                      <AnimatePresence>
                        {activeSkipMenu === 'single' && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveSkipMenu(null)} />
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 10 }}
                              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-24 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 p-1.5"
                            >
                              <div className="text-[9px] font-bold text-white/20 uppercase tracking-tighter mb-1 px-1">Presets</div>
                              <div className="grid grid-cols-2 gap-1">
                                {[2, 5, 10, 15, 30, 60].map(v => (
                                  <button 
                                    key={v}
                                    onClick={() => {
                                      setSkipIntervals(prev => ({ ...prev, single: v }));
                                      setActiveSkipMenu(null);
                                    }}
                                    className={cn(
                                      "py-1 text-[10px] font-mono rounded-md transition-colors",
                                      skipIntervals.single === v ? "bg-indigo-600 text-white" : "text-white/40 hover:bg-white/5"
                                    )}
                                  >
                                    {v}s
                                  </button>
                                ))}
                              </div>
                              <div className="mt-2 pt-2 border-t border-white/5">
                                <div className="text-[9px] font-bold text-white/20 uppercase tracking-tighter mb-1 px-1">Custom</div>
                                <input 
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="w-full bg-black/40 border border-white/10 rounded px-1 py-1 text-[10px] font-mono text-center focus:border-indigo-500 outline-none text-white"
                                  value={skipIntervals.single === 0 ? '' : skipIntervals.single}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(/\D/g, '');
                                    setSkipIntervals(prev => ({ ...prev, single: parseInt(val) || 0 }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      setActiveSkipMenu(null);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                />
                              </div>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>

                    <button 
                      onClick={() => {
                        const newTime = Math.min(state.clipEnd || state.duration, state.currentTime + skipIntervals.single);
                        if (wavesurferRef.current) wavesurferRef.current.setTime(newTime);
                        if (playerRef.current) playerRef.current.seekTo(newTime);
                      }}
                      className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                      title={`Skip Forward ${skipIntervals.single}s`}
                    >
                      <FastForward size={18} fill="currentColor" />
                    </button>
                  </div>

                  <button 
                    onClick={() => setState(prev => {
                      const isStarting = !prev.isPlaying;
                      let nextTime = prev.currentTime;
                      
                      if (isStarting) {
                        let lowerBound = prev.clipStart;
                        if (prev.isLooping && prev.cycleStart !== null) {
                          lowerBound = Math.max(lowerBound, prev.cycleStart);
                        }
                        if (prev.currentTime < lowerBound) {
                          nextTime = lowerBound;
                          if (wavesurferRef.current) wavesurferRef.current.setTime(nextTime);
                          if (playerRef.current) playerRef.current.seekTo(nextTime);
                        }
                      }
                      
                      return { ...prev, isPlaying: isStarting, currentTime: nextTime };
                    })}
                    className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-all text-white shadow-lg"
                  >
                    {state.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
                  </button>

                  <div className="w-px h-4 bg-white/10 mx-2" />

                  <div className="flex items-center gap-2 group/volume">
                    <button 
                      onClick={() => setState(prev => ({ ...prev, volume: prev.volume === 0 ? 0.8 : 0 }))}
                      className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                    >
                      {state.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={state.volume} 
                      onChange={(e) => setState(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                      className="w-0 group-hover/volume:w-20 transition-all duration-300 accent-indigo-500 overflow-hidden"
                    />
                  </div>
                </div>

                {/* Center: Time & Speed */}
                <div className="flex items-center gap-3">
                  <div className="text-xs font-mono text-white/60 bg-black/40 px-3 py-1.5 rounded-full border border-white/5 shadow-inner">
                    <span className="text-white">{formatTime(state.currentTime)}</span>
                    <span className="mx-2 opacity-30">/</span>
                    <span>{formatTime(state.duration)}</span>
                  </div>
                  
                  <div className="flex items-center bg-white/5 rounded-full p-0.5 border border-white/5">
                    {[0.5, 1, 1.5, 2].map(rate => (
                      <button 
                        key={rate}
                        onClick={() => setState(prev => ({ ...prev, playbackRate: rate }))}
                        className={cn(
                          "px-2.5 py-1 text-[10px] font-bold rounded-full transition-all",
                          state.playbackRate === rate ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white/5 text-white/40"
                        )}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Tools */}
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-0.5 bg-white/5 rounded-xl border border-white/5 p-0.5">
                    <button 
                      onClick={() => setState(prev => ({ ...prev, isLooping: !prev.isLooping }))}
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        state.isLooping ? "bg-amber-500/20 text-amber-400" : "text-white/40 hover:bg-white/10"
                      )}
                      title="Toggle Loop"
                    >
                      <Repeat size={18} />
                    </button>

                    <button 
                      onClick={() => setState(prev => ({ ...prev, cycleStart: null, cycleEnd: null, isLooping: false }))}
                      className="p-2 text-white/40 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all"
                      title="Clear Cycle"
                    >
                      <Trash2 size={18} />
                    </button>

                    <button 
                      onClick={() => setState(prev => ({ ...prev, clipStart: 0, clipEnd: state.duration }))}
                      className="p-2 text-white/40 hover:bg-indigo-500/10 hover:text-indigo-400 rounded-lg transition-all"
                      title="Reset Clip"
                    >
                      <RotateCcw size={18} />
                    </button>
                  </div>

                  <div className="w-px h-4 bg-white/10 mx-2" />

                  <div className="relative">
                    <button 
                      onClick={() => setShowSettings(!showSettings)}
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        showSettings ? "bg-indigo-500/20 text-indigo-400" : "text-white/40 hover:bg-white/10"
                      )}
                    >
                      <Settings size={18} />
                    </button>

                    <AnimatePresence>
                      {showSettings && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="absolute bottom-full right-0 mb-4 w-72 bg-[#1a1a1a] border border-white/10 rounded-2xl p-4 shadow-2xl z-50 space-y-6"
                          >
                            {/* Playback Speed (Extended) */}
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Playback Speed</h4>
                              <div className="flex flex-wrap gap-1 bg-black rounded-lg p-1 border border-white/10">
                                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => (
                                  <button 
                                    key={rate}
                                    onClick={() => setState(prev => ({ ...prev, playbackRate: rate }))}
                                    className={cn(
                                      "flex-1 min-w-[40px] py-1 text-[10px] rounded-md transition-colors",
                                      state.playbackRate === rate ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-white/40"
                                    )}
                                  >
                                    {rate}x
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Pitch Shift */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Pitch Shift</h4>
                                {state.mediaType === 'youtube' && <span className="text-[8px] text-amber-500/60 font-bold uppercase">N/A for YouTube</span>}
                              </div>
                              <div className="flex items-center justify-between bg-black rounded-lg p-1 border border-white/10">
                                <button 
                                  onClick={() => setState(prev => ({ ...prev, pitch: prev.pitch - 1 }))} 
                                  disabled={state.mediaType === 'youtube'}
                                  className="p-2 hover:bg-white/5 rounded-md disabled:opacity-20 transition-colors"
                                >
                                  <ChevronDown size={16} />
                                </button>
                                <div className="flex flex-col items-center">
                                  <span className={cn("text-sm font-mono font-bold", state.mediaType === 'youtube' && "opacity-20")}>
                                    {state.pitch > 0 ? `+${state.pitch}` : state.pitch}
                                  </span>
                                  <span className="text-[8px] text-white/20 uppercase">Semitones</span>
                                </div>
                                <button 
                                  onClick={() => setState(prev => ({ ...prev, pitch: prev.pitch + 1 }))} 
                                  disabled={state.mediaType === 'youtube'}
                                  className="p-2 hover:bg-white/5 rounded-md disabled:opacity-20 transition-colors"
                                >
                                  <ChevronUp size={16} />
                                </button>
                              </div>
                            </div>

                            {/* Double Tap Skip Interval */}
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Double Tap Skip</h4>
                              <div className="flex bg-black rounded-lg p-1 border border-white/10">
                                {[10, 20, 30, 40].map(v => (
                                  <button 
                                    key={v}
                                    onClick={() => setSkipIntervals(prev => ({ ...prev, double: v }))}
                                    className={cn(
                                      "flex-1 py-1 text-[10px] rounded-md transition-colors",
                                      skipIntervals.double === v ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-white/40"
                                    )}
                                  >
                                    {v}s
                                  </button>
                                ))}
                              </div>
                              <div className="p-1 border-t border-white/5 mt-1">
                                <input 
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="w-full bg-black/40 border border-white/10 rounded px-1 py-1 text-[10px] font-mono text-center focus:border-indigo-500 outline-none text-white placeholder-white/20"
                                  placeholder="0"
                                  value={skipIntervals.double === 0 ? '' : skipIntervals.double}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(/\D/g, '');
                                    setSkipIntervals(prev => ({ ...prev, double: parseInt(val) || 0 }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      setActiveSkipMenu(null);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                />
                              </div>
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Shortcuts Modal */}
      <AnimatePresence>
        {showShortcuts && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShortcuts(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600" />
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Keyboard className="text-indigo-400" size={24} />
                  <h2 className="text-2xl font-bold">Keyboard Shortcuts</h2>
                </div>
                <button onClick={() => setShowShortcuts(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                <ShortcutItem keys={['Space']} desc="Play / Pause" />
                <ShortcutItem keys={['Enter']} desc="Go to Start / Cycle Start" />
                <ShortcutItem keys={['←', '→']} desc={`Skip ${skipIntervals.single}s (Double Tap ${skipIntervals.double}s)`} />
                <ShortcutItem keys={['K']} desc="Set Cycle Start" />
                <ShortcutItem keys={['L']} desc="Set Cycle End" />
                <ShortcutItem keys={['Esc']} desc="Clear State / Speed" />
                <ShortcutItem keys={['Hold Space']} desc="Fast Forward (2x)" />
                <ShortcutItem keys={['Double Space']} desc="Lock Fast Forward" />
                <ShortcutItem keys={['Shift', 'Space']} desc="Slow Motion (0.5x)" />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}} />
    </div>
  );
}

function ShortcutItem({ keys, desc }: { keys: string[], desc: string }) {
  return (
    <div className="flex items-center justify-between group">
      <span className="text-white/60 group-hover:text-white transition-colors">{desc}</span>
      <div className="flex gap-1.5">
        {keys.map(k => (
          <kbd key={k} className="px-2 py-1 bg-white/10 border border-white/10 rounded-md text-[10px] font-mono min-w-[32px] text-center shadow-sm">
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  const parts = [
    h > 0 ? h.toString().padStart(2, '0') : null,
    m.toString().padStart(2, '0'),
    s.toString().padStart(2, '0')
  ].filter(Boolean);
  
  return `${parts.join(':')}.${ms.toString().padStart(2, '0')}`;
}
