import { Playlist } from "prisma/client/tenant";
import { IComponentOptions } from "../../../common/component.interface";
import Controller from "../../../common/controller.abstract";
import { TrackSource } from "../../models/providers/provider.abstract";
import Tenant from "../../models/tenant";
import { IPreview, ITrackInfo, Tracks } from "../../models/track.interface";
import { IPlaylistUpdate } from "../preserver.controller";

export default abstract class Endpoint extends Controller<
	//Events
	| ["playlisted", (track: IPreview, playlist: string) => void]
	| ["triggered", (playlist: string) => void]
	| ["relisted", (playlist: string, update: IPlaylistUpdate) => void],
	//Whishes
	| ["query", (query: string, from: TrackSource) => Tracks]
	| ["similar", (track: ITrackInfo) => Tracks]
	| ["tracks", (playlist?: string) => Tracks]
>() {
	public tenant: Tenant;

	public constructor(args: IComponentOptions) {
		super(args);
		this.tenant = args.relation as Tenant;
	}

	public static get relations(): obj[] {
		return Tenant.tenants;
	}

	/**
	 * Removes all the tracks from the given playlist
	 * @param playlist Playlist to clear
	 */
	public async clear(playlist: Playlist): Promise<void> {}

	/**
	 * Adds new tracks to a playlist in the current endpoint
	 * @param tracks Added tracks
	 * @param playlist Playlist to add
	 */
	public async add(tracks: Tracks, playlist: Playlist): Promise<void> {}
}
