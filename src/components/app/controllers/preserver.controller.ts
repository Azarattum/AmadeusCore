import { Playlist, PrismaClient, Track } from "@prisma/client";
import { copyFileSync } from "fs";
import { existsSync } from "fs";
import { IComponentOptions } from "../../common/component.interface";
import Controller from "../../common/controller.abstract";
import Tenant from "../models/tenant";
import { ITrack } from "../models/track.interface";

/**
 * Stores and manages Amadeus' user's data
 */
export default class Preserver extends Controller<"playlisted">() {
	private tenant: Tenant;
	private prisma: PrismaClient;

	public static get relations(): object[] {
		return Tenant.tenants;
	}

	public async close(): Promise<void> {
		return this.prisma.$disconnect();
	}

	public constructor(args: IComponentOptions) {
		super(args);
		this.tenant = args.relation as Tenant;

		const db = `data/${this.tenant.identifier.toLowerCase()}.db`;
		if (!existsSync(db)) {
			copyFileSync("data/dummy.db", db);
		}

		this.prisma = new PrismaClient({
			datasources: {
				db: {
					url: `file:../${db}`
				}
			}
		});
	}

	public async updatePlaylist(
		playlist: string,
		update: IPlaylistUpdate
	): Promise<void> {
		await this.prisma.playlist.upsert({
			where: {
				title: playlist
			},
			create: {
				title: playlist,
				...update
			},
			update: update
		});
	}

	public async playlistTrack(track: ITrack, playlist: string): Promise<void> {
		let found = await this.prisma.track.findFirst({
			where: {
				title: track.title,
				artists: {
					every: { name: { in: track.artists } }
				}
			}
		});

		if (found) {
			found = await this.prisma.track.update({
				where: { id: found.id },
				data: {
					playlists: {
						connectOrCreate: {
							where: { title: playlist },
							create: { title: playlist }
						}
					}
				}
			});
		} else {
			found = await this.createTrack(track, playlist);
		}

		const updated = await this.prisma.playlist.findUnique({
			where: {
				title: playlist
			}
		});

		this.emit("playlisted", this.tenant, track, updated);
	}

	public getPlaylist(query: string): Promise<Playlist | null> {
		return this.prisma.playlist.findUnique({
			where: { title: query }
		});
	}

	public getPlaylists(): Promise<Playlist[]> {
		return this.prisma.playlist.findMany();
	}

	public getLastTracks(count: number): Promise<Track[]> {
		return this.prisma.track.findMany({
			where: {
				playlists: {
					some: { type: 0 }
				}
			},
			orderBy: {
				id: "desc"
			},
			take: count
		});
	}

	private async createTrack(track: ITrack, playlist: string): Promise<Track> {
		return this.prisma.track.create({
			data: {
				title: track.title,
				album: {
					connectOrCreate: {
						where: { title: track.album },
						create: { title: track.album }
					}
				},
				artists: {
					connectOrCreate: track.artists.map(x => {
						return { create: { name: x }, where: { name: x } };
					})
				},
				year: track.year,
				cover: track.cover,
				length: Math.round(track.length),
				sources: JSON.stringify(track.sources),
				playlists: {
					connectOrCreate: {
						create: { title: playlist },
						where: { title: playlist }
					}
				}
			}
		});
	}
}

interface IPlaylistUpdate {
	telegram?: number;
	type?: number;
}
