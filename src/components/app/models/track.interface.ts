export interface IPreview {
	title: string;
	artists: string[];
	album: string;
	cover?: string;

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
