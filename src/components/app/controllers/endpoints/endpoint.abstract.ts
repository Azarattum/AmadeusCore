import { Playlist } from "@prisma/client";
import { IComponentOptions } from "../../../common/component.interface";
import Controller from "../../../common/controller.abstract";
import Tenant from "../../models/tenant";
import { ITrack } from "../../models/track.interface";

export default abstract class Endpoint extends Controller<
	"searched" | "extended" | "playlists" | "playlisted" | "relist"
>() {
	public tenant: Tenant;

	public constructor(args: IComponentOptions) {
		super(args);
		this.tenant = args.relation as Tenant;
	}

	public static get relations(): object[] {
		return Tenant.tenants;
	}

	public abstract setPlaylists(playlists: string[]): Promise<void>;

	public abstract clearPlaylist(playlist: Playlist): Promise<void>;

	public abstract sendTracks(tracks: ITrack[]): Promise<void>;

	public abstract playlistTrack(
		track: ITrack,
		playlist: Playlist
	): Promise<void>;
}
