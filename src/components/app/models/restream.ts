import Ffmpeg from "fluent-ffmpeg";
import { PassThrough, Readable, Transform, TransformCallback } from "stream";
import { promisify } from "util";
import { wrn } from "../../common/utils.class";
import { ITrack } from "./track.interface";

export default class Restream {
  private meta: IMeta;
  private cover?: IInput;
  private image?: Buffer;
  private audio: IInput;

  public constructor(meta: IMeta, audio: IInput, cover?: IInput) {
    this.meta = meta;
    this.cover = cover;
    this.audio = audio;
  }

  public async load(): Promise<void> {
    if (!this.cover) return;
    const jpg = this.cover.mime === "image/jpeg";
    if (!jpg) this.cover.stream.destroy();
    const stream = jpg
      ? this.cover.stream
      : (Ffmpeg(this.cover.url)
          .addOption(["-vf", "crop=ih:ih"])
          .format("mjpeg")
          .on("error", (e) => {
            e = e.toString().trim();
            if (e != "Error: Output stream closed") {
              wrn(`FFMpeg failed on image convertion!\n${e}`);
            }
          })
          .pipe(undefined, { end: true }) as PassThrough);

    const buffers: Buffer[] = [];
    stream.on("data", (buffer) => buffers.push(buffer));

    await promisify(stream.on.bind(stream))("end");
    this.image = Buffer.concat(buffers);
  }

  public get source(): Readable {
    const type = this.audio.mime;
    // if (type === "audio/mp4") return this.useMP4();
    if (type === "audio/mpeg") return this.useID3();

    //Covert to mp3
    this.audio.stream.destroy();
    this.audio.stream = Ffmpeg(this.audio.url)
      .format("mp3")
      .on("error", (e) => {
        e = e.toString().trim();
        if (e != "Error: Output stream closed") {
          wrn(`FFMpeg failed on audio convertion!\n${e}`);
        }
      })
      .pipe() as Readable;

    return this.useID3();
  }

  public get filename(): string {
    // const type = this.audio.mime === "audio/mpeg" ? "mp3" : "m4a";
    const type = "mp3";
    let name = !this.meta.artists
      ? `${this.meta.title}.${type}`
      : `${this.meta.artists.join(", ")} - ${this.meta.title}.${type}`;

    name = name.replace(/[\\/:*?"<>|]/g, "");
    return name;
  }

  private useMP4(): Readable {
    return this.audio.stream.pipe(this.mp4Transform);
  }

  private useID3(): Readable {
    const streams = [this.id3Header, this.id3Tags];
    if (this.image) streams.push(this.id3Cover);
    streams.push(this.audio.stream);

    const pass = new PassThrough();
    const pipe = async () => {
      for await (const stream of streams) {
        stream.pipe(pass, { end: false });
        await promisify(stream.on.bind(stream))("end");
        stream.destroy();
      }
      pass.end();
    };
    pipe();

    return pass;
  }

  private toSyncBuffer(int: number): Buffer {
    let mask = 0x7f;
    let synchsafed = 0;

    while ((mask ^ 0x7fffffff) !== 0) {
      synchsafed = int & ~mask;
      synchsafed <<= 1;
      synchsafed |= int & mask;
      mask = ((mask + 1) << 8) - 1;
      int = synchsafed;
    }

    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(synchsafed);
    return buffer;
  }

  public static async fromUrl(
    meta: IMeta,
    audioUrl: string,
    coverUrl?: string
  ): Promise<Restream> {
    const audioLoading = fetch(audioUrl);
    const coverLoading = coverUrl ? fetch(coverUrl) : null;

    const [audio, cover] = await Promise.all([audioLoading, coverLoading]);

    const coverData = cover
      ? {
          url: coverUrl as string,
          stream: cover.body as unknown as Readable,
          mime: cover.headers.get("content-type") || undefined,
        }
      : undefined;

    const audioData = {
      url: audioUrl,
      stream: audio.body as unknown as Readable,
      mime: audio.headers.get("content-type") || undefined,
    };

    const restream = new Restream(meta, audioData, coverData);
    await restream.load();
    return restream;
  }

  public static async fromTrack(track: ITrack): Promise<Restream> {
    return this.fromUrl(track, track.url, track.cover);
  }

  private mp4Process(box: Buffer): Buffer {
    const sections: Record<string, [number, number]> = {};

    let offset = 8;
    const size = box.readUInt32BE();

    while (offset < size) {
      const size = box.readUInt32BE(offset);
      const name = box.slice(offset + 4, offset + 8).toString();
      sections[name] = [offset, offset + size];
      offset += size;
    }

    if ("udta" in sections) {
      box = Buffer.concat([
        box.slice(0, sections["udta"][0]),
        box.slice(sections["udta"][1]),
      ]);
    }

    box = Buffer.concat([box, this.mp4Tags]);
    box.writeInt32BE(box.length);
    return box;
  }

  private get mp4Transform(): Transform {
    // Part of code that tries to covert from MPEG-DASH (unsuccessful)
    //   Unfortunately we do not know sample sizes in advance
    //   which are needed in "moov.trak" of the top level
    //
    // const data = {
    // 	header: Buffer.from("\0\0\0 ftypM4A \0\0\0\x01iso6mp41M4A mp42")
    // };
    // let firstMdat = true;
    // let global = 0;

    let state = TransformState.StartBox;
    let boxSize: number, boxType: string;
    const box: Buffer[] = [];

    const transform = (boxPart: Buffer, final = false): Buffer => {
      if (boxType === "moov") {
        box.push(boxPart);
        if (final) return this.mp4Process(Buffer.concat(box));
        return Buffer.alloc(0);
      }
      return boxPart;
      // Part of code that tries to covert from MPEG-DASH (unsuccessful)
      //   Unfortunately we do not know sample sizes in advance
      //   which are needed in "moov.trak" of the top level
      //
      // if (boxType === "ftyp") {
      // 	if (global) return Buffer.alloc(0);
      // 	return data.header;
      // }
      // if (boxType === "mdat") {
      // 	if (global) return boxPart;
      // 	if (firstMdat) {
      // 		boxPart.writeUInt32BE(4294967295);
      // 		firstMdat = false;
      // 		return boxPart;
      // 	}
      // 	return boxPart.slice(8);
      // }
      // if (boxType === "sidx") return Buffer.alloc(0);
      // if (boxType === "moof") return Buffer.alloc(0);
      // return boxPart;
    };

    const update = (chunk: Buffer): [Buffer, Buffer] => {
      let local = 0;
      const result = [];

      if (state == TransformState.StartBox) {
        // global = 0;
        boxSize = chunk.readUInt32BE(local);
        boxType = chunk.slice(local + 4, local + 8).toString();
        state = TransformState.ReadBox;
      }
      if (state == TransformState.ReadBox) {
        const length = Math.min(chunk.length - local, boxSize);
        const final = boxSize <= chunk.length - local;

        result.push(transform(chunk.slice(local, local + length), final));

        if (final) state = TransformState.StartBox;
        local += length;
        boxSize -= length;
      }

      // global += local;
      return [Buffer.concat(result), chunk.slice(local)];
    };

    const stream = new Transform({
      transform: async (
        chunk: Buffer,
        encoding: string,
        callback: TransformCallback
      ) => {
        const parts = [];
        let [part, left] = update(chunk);
        parts.push(part);
        while (left.length) {
          [part, left] = update(left);
          parts.push(part);
        }
        callback(null, Buffer.concat(parts));
      },
    });

    return stream;
  }

  private get mp4Tags(): Buffer {
    const buffers: Buffer[] = [];

    for (const tag in this.meta) {
      if (!(tag in MP4)) continue;
      let value = this.meta[tag as keyof IMeta];
      if (!value) continue;
      if (Array.isArray(value)) value = value.join(", ");
      if (typeof value === "number") value = value.toString();

      const data = Buffer.from(value, "utf-8");
      const size = 4 * 4 + 8 + data.byteLength;

      const sizeBuffer = Buffer.alloc(4);
      sizeBuffer.writeInt32BE(size);
      buffers.push(sizeBuffer);

      buffers.push(Buffer.from(MP4[tag as keyof typeof MP4], "ascii"));

      const dataBuffer = Buffer.alloc(4);
      dataBuffer.writeInt32BE(size - 8);
      buffers.push(dataBuffer);

      buffers.push(Buffer.from("data"));
      buffers.push(Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]));
      buffers.push(data);
    }

    if (this.cover) buffers.push(this.mp4Cover);

    const header = Buffer.from("    udta    meta");
    const hldt = Buffer.from(
      "\0\0\0\0\0\0\0\x21hdlr\0\0\0\0\0\0\0\0mdirappl\0\0\0\0\0\0\0\0\0"
    );
    const ilst = Buffer.from("    ilst");

    let result = Buffer.concat([ilst, ...buffers]);
    result.writeInt32BE(result.length);
    result = Buffer.concat([header, hldt, result]);
    result.writeInt32BE(result.length);
    result.writeInt32BE(result.length - 8, 8);

    return result;
  }

  private get mp4Cover(): Buffer {
    if (!this.image) return Buffer.from([]);

    let buffers = [];
    const size = 4 * 4 + 8 + this.image.byteLength;

    const sizeBuffer = Buffer.alloc(4);
    sizeBuffer.writeInt32BE(size);
    buffers.push(sizeBuffer);

    buffers.push(Buffer.from(MP4.picture, "ascii"));

    const dataBuffer = Buffer.alloc(4);
    dataBuffer.writeInt32BE(size - 8);
    buffers.push(dataBuffer);

    buffers.push(Buffer.from("data"));
    buffers.push(Buffer.from([0, 0, 0, 0x0d, 0, 0, 0, 0]));
    buffers.push(this.image);

    const result = Buffer.concat(buffers);
    buffers = [];
    delete this.image;

    return result;
  }

  private get id3Header(): Readable {
    const buffers = [
      Buffer.from("ID3"),
      Buffer.from([3, 0, 0]),
      this.toSyncBuffer(this.id3Length),
    ];

    return Readable.from(buffers);
  }

  private get id3Length(): number {
    const tag = 4;
    const size = 4;
    const flags = 2;
    const encoding = 3;

    let length = 0;
    for (const name in this.meta) {
      if (!(name in ID3)) continue;
      let item = this.meta[name as keyof IMeta];
      if (!item) continue;
      if (Array.isArray(item)) item = item.join(", ");
      if (typeof item === "number") item = item.toString();

      length += tag + size + flags + encoding;
      length += Buffer.from(item, "ucs-2").length;
    }

    if (this.image) {
      length += tag + size + flags;
      length += 8 + "image/jpeg".length + this.image.byteLength; //Image & header
    }

    return length;
  }

  private get id3Tags(): Readable {
    const buffers: Buffer[] = [];

    for (const tag in this.meta) {
      if (!(tag in ID3)) continue;
      let value = this.meta[tag as keyof IMeta];
      if (!value) continue;
      if (Array.isArray(value)) value = value.join(", ");
      if (typeof value === "number") value = value.toString();

      const bytes = Buffer.from(value, "ucs-2");
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(Buffer.byteLength(bytes) + 3);

      buffers.push(Buffer.from(ID3[tag as keyof typeof ID3]));
      buffers.push(buffer);
      buffers.push(Buffer.from([0, 0, 1]));
      buffers.push(Buffer.from([0xff, 0xfe]));
      buffers.push(bytes);
    }

    return Readable.from(buffers);
  }

  private get id3Cover(): Readable {
    const buffers: Buffer[] = [];

    if (!this.image) return Readable.from([]);
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(this.image.byteLength + "image/jpeg".length + 8);

    buffers.push(Buffer.from(ID3.picture));
    buffers.push(buffer);
    buffers.push(Buffer.from([0, 0]));

    buffers.push(Buffer.from([0]));
    buffers.push(Buffer.from("image/jpeg"));
    buffers.push(Buffer.from([0, 3]));
    buffers.push(Buffer.from("JFIF"));
    buffers.push(Buffer.from([0]));

    buffers.push(this.image);

    return Readable.from(buffers);
  }
}

interface IMeta {
  title?: string;
  artists?: string[];
  album?: string;
  length?: number;
  year?: number;
}

interface IInput {
  url: string;
  stream: Readable;
  mime?: string;
}

enum TransformState {
  StartBox,
  ReadBox,
}

enum ID3 {
  title = "TIT2",
  artists = "TPE1",
  album = "TALB",
  length = "TLEN",
  year = "TYER",
  picture = "APIC",
}

enum MP4 {
  title = "\xA9nam",
  artists = "\xA9ART",
  album = "\xA9alb",
  year = "\xA9day",
  picture = "covr",
}
