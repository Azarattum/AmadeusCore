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
