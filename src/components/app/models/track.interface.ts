export interface ITrackPreview {
	title: string;
	artists: string[];
	album: string;
	cover?: string;
	source: string;

	track: () => Promise<ITrack>;
}

export interface ITrackMeta {
	title: string;
	artists: string[];
	album: string;

	length: number;
	year?: number;
	cover?: string;
	sources: string[];
}

export interface ITrackInfo {
	title: string;
	artists: string[];
}

export interface ITrack extends ITrackMeta {
	url: string;
}

export type Tracks = AsyncGenerator<ITrackPreview>;

export function hash(track: ITrackPreview): string {
	const val = `${stringify(track)} - ${track.album.toLowerCase()}`;
	const buff = Buffer.from(val, "utf-8");
	return buff.toString("base64");
}

export function stringify(
	track: ITrackPreview | ITrackInfo | ITrack,
	reverse = false
): string {
	const title = track.title.toLowerCase().trim();
	const artists = track.artists.sort().join().toLowerCase().trim();

	if (!artists) return purify(title);
	if (reverse) return purify(`${title} - ${artists}`);
	return purify(`${artists} - ${title}`);
}

export function purify(title: string): string {
	return title.replace(/[+,&]/g, " ");
}
