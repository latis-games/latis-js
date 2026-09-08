export const islandWgsl = "fn island_vs() {}";
export const islandVertex = "attribute vec2 a_island; void main(){ gl_Position = vec4(a_island,0.0,1.0); }";
export const islandFragment = "void main(){ gl_FragColor = vec4(0.2, 0.5, 0.6, 1.0); }";
export function islandPaint(canvas) {
  if (canvas) canvas._islandPainted = true;
}
