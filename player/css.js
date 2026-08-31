export const PLAYER_CSS = `
.lmp-player {
  --lmp-ink: #fffef4;
  --lmp-fill: #7ef0e4;
  --lmp-track: rgba(8, 30, 40, 0.42);
  --lmp-font: "Trebuchet MS", "Avenir Next", "Segoe UI", ui-sans-serif, sans-serif;
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 10px 12px 12px;
  color: var(--lmp-ink);
  font-family: var(--lmp-font);
  background: rgba(8, 28, 38, 0.72);
  border: 3px solid rgba(255, 255, 255, 0.72);
  border-radius: 16px;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.lmp-player *,
.lmp-player *::before,
.lmp-player *::after { box-sizing: border-box; }
.lmp-audio {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
  pointer-events: none;
}
.lmp-eq-wrap {
  position: relative;
  width: 100%;
  height: 48px;
  min-height: 48px;
  background: #031018;
  overflow: hidden;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  pointer-events: none;
}
.lmp-eq {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  background: transparent;
  pointer-events: none;
}
.lmp-title {
  margin: 0;
  min-width: 0;
  min-height: 2.4em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.04em;
  text-align: center;
  color: var(--lmp-ink);
  text-shadow: 0 1px 2px #000, 0 0 6px #000, 0 0 14px rgba(0,0,0,.95);
}
.lmp-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 4px;
}
.lmp-player button {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--lmp-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
}
.lmp-player button:active { background: rgba(255, 255, 255, 0.16); }
.lmp-player button svg { width: 22px; height: 22px; fill: currentColor; }
.lmp-play .lmp-icon-pause { display: none; }
.lmp-play.is-playing .lmp-icon-play { display: none; }
.lmp-play.is-playing .lmp-icon-pause { display: block; }
.lmp-mute .lmp-icon-speaker-off,
.lmp-mute.is-muted .lmp-icon-speaker { display: none; }
.lmp-mute.is-muted .lmp-icon-speaker-off { display: block; }
.lmp-vol-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 22px;
}
.lmp-vol {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 22px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  accent-color: var(--lmp-fill);
}
.lmp-vol::-webkit-slider-runnable-track {
  height: 9px;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    var(--lmp-fill) 0%,
    var(--lmp-fill) var(--lmp-vol, 55%),
    var(--lmp-track) var(--lmp-vol, 55%),
    var(--lmp-track) 100%
  );
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.92);
  border: 0;
}
.lmp-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 30px;
  height: 20px;
  margin-top: -5.5px;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(18, 40, 70, 0.38), 0 1px 2px rgba(0, 0, 0, 0.18);
}
.lmp-vol::-moz-range-track {
  height: 9px;
  border-radius: 99px;
  background: var(--lmp-track);
  border: 1px solid rgba(255, 255, 255, 0.92);
}
.lmp-vol::-moz-range-progress {
  height: 9px;
  border-radius: 99px;
  background: var(--lmp-fill);
  border: 1px solid rgba(255, 255, 255, 0.92);
}
.lmp-vol::-moz-range-thumb {
  width: 30px;
  height: 20px;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(18, 40, 70, 0.38), 0 1px 2px rgba(0, 0, 0, 0.18);
}
.lmp-vol-pct {
  position: absolute;
  left: 50%;
  top: -18px;
  transform: translateX(-50%);
  padding: 2px 7px;
  border-radius: 8px;
  background: rgba(42, 20, 8, 0.82);
  color: #fff6c8;
  font-size: 11px;
  font-weight: 800;
  pointer-events: none;
  white-space: nowrap;
}
.lmp-vol-pct[hidden] { display: none !important; }
.lmp-player.is-empty .lmp-title { opacity: 0.55; }
`;
