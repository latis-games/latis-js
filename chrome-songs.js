/** Titles pass playlist as song title strings (slug.m4a). Objects with .title also work. */
export function playlistSongs(skin, settings) {
  const s = skin || {};
  const g = settings || {};
  const raw = s.songs || g.songs || s.playlist || g.playlist || [];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (item && typeof item.title === "string" && item.title.trim()) out.push(item.title.trim());
  }
  return out;
}

export function playlistMediaBase(skin, settings) {
  const s = skin || {};
  const g = settings || {};
  const b = s.mediaBase || g.mediaBase;
  return b ? String(b) : "/media/";
}
