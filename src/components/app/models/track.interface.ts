export interface ITrack {
	title: string;
	artists: string[];
	album: string;

	length: number;
	year?: number;
	cover: string | null;
	url: string | null;
}
