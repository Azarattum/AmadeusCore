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
	public tenant: Tenant;
	private prisma: PrismaClient;

	public static get relations(): Tenant[] {
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

	public getPlaylists(dynamic = false): Promise<Playlist[]> {
		return this.prisma.playlist.findMany({
			where: {
				type: !dynamic
					? {
							lte: 0
					  }
					: {
							gte: 1
					  }
			}
		});
	}

	public async addTrack(track: ITrack, playlist: string): Promise<void> {
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

		this.emit("playlisted", track, updated);
	}

	public async getTracks(
		count: number
	): Promise<(Track & { artists: string[] })[]> {
		const results = (await this.prisma.track.findMany({
			where: {
				playlists: {
					some: { type: 0 }
				}
			},
			include: {
				artists: true
			},
			orderBy: {
				id: "desc"
			},
			take: count
		})) as (Track & { artists: any[] })[];

		results.forEach(result => {
			result.artists = result.artists.map(x => x.name);
		});

		return results;
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
