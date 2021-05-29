export interface IPreview {
	title: string;
	artists: string[];
	album: string;
	cover?: string;
	source: string;

	track: () => Promise<ITrack>;
}

export interface ITrack {
	title: string;
	artists: string[];
	album: string;

	length: number;
	year?: number;
	cover?: string;
	url: string;
	sources: string[];
}

export type Tracks = AsyncGenerator<IPreview>;

export function hash(track: IPreview): string {
	const val = `${stringify(track)} - ${track.album.toLowerCase()}`;
	const buff = Buffer.from(val, "utf-8");
	return buff.toString("base64");
}

export function stringify(track: IPreview, reverse = false): string {
	const title = track.title.toLowerCase().trim();
	const artists = track.artists.sort().join().toLowerCase().trim();

	if (!artists) return purify(title);
	if (reverse) return purify(`${title} - ${artists}`);
	return purify(`${artists} - ${title}`);
}

export function purify(title: string): string {
	return title.replace(/[+,&]/g, " ");
}
