import { Playlist, PrismaClient } from "prisma/client/tenant";
import { copyFileSync } from "fs";
import { existsSync } from "fs";
import { ComponentOptions } from "../../common/component.interface";
import Controller from "../../common/controller.abstract";
import Tenant from "../models/tenant";
import { Track } from "../models/track.interface";

/**
 * Stores and manages Amadeus' user's data
 */
export default class Preserver extends Controller<
  ["playlisted", (track: Track, updated: Playlist, manually: boolean) => void]
>() {
  public tenant: Tenant;
  private prisma: PrismaClient;

  public static get relations(): Tenant[] {
    return Tenant.tenants;
  }

  public async close(): Promise<void> {
    return this.prisma.$disconnect();
  }

  public constructor(args: ComponentOptions) {
    super(args);
    this.tenant = args.relation as Tenant;

    const db = `data/${this.tenant.identifier.toLowerCase()}.db`;
    if (!existsSync(db)) {
      copyFileSync("data/tenant.dummy", db);
    }

    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:../${db}`,
        },
      },
    });
  }

  public async updatePlaylist(
    playlist: string,
    update: PlaylistUpdate
  ): Promise<void> {
    await this.prisma.playlist.upsert({
      where: {
        title: playlist,
      },
      create: {
        title: playlist,
        ...update,
      },
      update: update,
    });
  }

  public getPlaylists(
    type: "normal" | "dynamic" | "all" = "normal"
  ): Promise<Playlist[]> {
    return this.prisma.playlist.findMany({
      where:
        type === "all"
          ? {}
          : { type: type === "normal" ? { lte: 0 } : { gte: 1 } },
    });
  }

  public async clearPlaylist(playlist: string): Promise<void> {
    await this.prisma.playlist.update({
      where: { title: playlist },
      data: {
        tracks: { set: [] },
      },
    });
    await this.prisma.track.deleteMany({
      where: {
        playlists: {
          none: {},
        },
      },
    });
  }

  public async addTrack(
    track: Track,
    playlist: string,
    manually = true
  ): Promise<void> {
    let found = await this.prisma.track.findFirst({
      where: {
        title: track.title,
        artists: {
          every: { name: { in: track.artists } },
        },
      },
    });

    if (found) {
      found = await this.prisma.track.update({
        where: { id: found.id },
        data: {
          playlists: {
            connectOrCreate: {
              where: { title: playlist },
              create: { title: playlist },
            },
          },
        },
      });
    } else {
      await this.createTrack(track, playlist);
    }

    const updated = await this.prisma.playlist.findUnique({
      where: {
        title: playlist,
      },
    });

    if (updated) this.emit("playlisted", track, updated, manually);
  }

  public async getPlaylist(id?: number, count?: number): Promise<Track[]> {
    const results = await this.prisma.track.findMany({
      where: {
        playlists: {
          some: id != null ? { id } : { type: 0 },
        },
      },
      include: {
        artists: true,
        album: true,
      },
      orderBy: {
        id: id != null ? "asc" : "desc",
      },
      take: id != null ? count : count || 30,
    });

    return results.map((x) => ({
      title: x.title,
      artists: x.artists.map((y) => y.name),
      album: x.album.title,
      length: x.length,
      year: x.year || undefined,
      cover: x.cover || undefined,
      sources: JSON.parse(x.sources),
    }));
  }

  private async createTrack(track: Track, playlist: string): Promise<void> {
    this.prisma.track.create({
      data: {
        title: track.title,
        album: {
          connectOrCreate: {
            where: { title: track.album },
            create: { title: track.album },
          },
        },
        artists: {
          connectOrCreate: track.artists.map((x) => {
            return { create: { name: x }, where: { name: x } };
          }),
        },
        year: track.year,
        cover: track.cover,
        length: Math.round(track.length),
        sources: JSON.stringify(track.sources),
        playlists: {
          connectOrCreate: {
            create: { title: playlist },
            where: { title: playlist },
          },
        },
      },
    });
  }
}

export interface PlaylistUpdate {
  telegram?: number | null;
  type?: number;
}
