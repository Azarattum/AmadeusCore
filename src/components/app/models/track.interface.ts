export interface Track {
  title: string;
  artists: string[];
  album: string;

  length: number;
  year?: number;
  cover?: string;
  sources: string[];
}

export interface TrackPreview extends Track {
  load: () => Promise<TrackLoaded>;
}

export interface TrackLoaded extends Track {
  url: string;
}

export type Tracks = AsyncGenerator<TrackPreview>;

export function hash(track: Track): string {
  return `${stringify(track)} - ${track.album.toLowerCase()}`;
}

export function stringify(
  { title, artists }: { title: string; artists: string[] | string },
  reverse = false
): string {
  title = title.toLowerCase().trim();
  artists = Array.isArray(artists)
    ? artists.sort().join(", ").toLowerCase().trim()
    : artists.toLowerCase().trim();

  if (!artists) return purify(title);
  if (reverse) return purify(`${title} - ${artists}`);
  return purify(`${artists} - ${title}`);
}

export function purify(title: string): string {
  return title.replace(/[+,&]/g, " ");
}
