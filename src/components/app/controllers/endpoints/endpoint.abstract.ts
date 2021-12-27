import { Playlist } from "prisma/client/tenant";
import { ComponentOptions } from "../../../common/component.interface";
import Controller from "../../../common/controller.abstract";
import { TrackSource } from "../../models/providers/provider.abstract";
import Tenant from "../../models/tenant";
import { Tracks, Track } from "../../models/track.interface";
import { PlaylistUpdate } from "../preserver.controller";

export default abstract class Endpoint extends Controller<
  //Events
  | ["playlisted", (track: Track, playlist: string) => void]
  | ["triggered", (playlist: string) => void]
  | ["relisted", (playlist: string, update: PlaylistUpdate) => void],
  //Whishes
  | ["query", (query: string, from: TrackSource) => Tracks]
  | ["similar", (query: string) => Tracks]
  | ["tracks", (playlist?: number) => Promise<Track[]>]
  | ["recognise", (audio: string) => Promise<string | null>]
  | ["lyrics", (query: string) => Promise<string>]
  | ["playlists", () => Promise<Playlist[]>]
>() {
  public tenant: Tenant;

  public constructor(args: ComponentOptions) {
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
