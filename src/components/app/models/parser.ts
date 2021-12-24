const r = String.raw;

export const emoji = r`([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])`;
export const separators = [
  emoji,
  "\\|",
  '"',
  "`",
  "''+",
  ":",
  "-\\s",
  "\\s-",
  "--+",
  "(\\s|^)\\.+(\\s|$)",
  "\\/\\/+",
];

export function unbrace(text: string): IUnbraced {
  const result: IUnbraced = {
    clean: "",
    parts: [],
  };

  const opening = "[({【「";
  const closing = "])}】」";
  let current = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const opened = opening.indexOf(char);
    const closed = closing.indexOf(char);

    if (opened >= 0) {
      if (current >= 0) continue;
      current = opened;
      result.parts.push("");
      continue;
    }
    if (current == -1) {
      result.clean += char;
      continue;
    }
    if (closed == current) {
      const lastChar = result.clean[result.clean.length - 1];
      if (lastChar) {
        result.clean += " - ";
      }
      current = -1;
      continue;
    }
    if (closed >= 0) continue;
    result.parts[result.parts.length - 1] += char;
  }

  result.clean = trim(result.clean);
  result.parts = result.parts.map((x) => x.trim()).filter((x) => x);

  return result;
}

export function isJunk(text: string): boolean {
  if (!text) return true;
  const url =
    /[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/;
  if (text.match(url)) return true;

  const junk = [
    r`album`,
    r`originals?`,
    r`of+icial?`,
    r`MV`,
    r`lyrics?`,
    r`video`,
    r`live`,
    r`only`,
    r`mix`,
    r`full`,
    r`sub(titles?)?`,
    r`quality`,
    r`(HD|HQ|[0-9]{3,4}p|4Kb)`,
    r`[0-9]{3,4}(p|bpmb)`,
    r`S[0-9]+E[0-9]+`,
    r`free`,
    r`download`,
    r`copyright`,
    r`royalty`,
    r`tutorial`,
    r`amv`,
    r`explicit`,
    r`remaster(ed)?`,
  ].map((x) => new RegExp(r`(\b|^|\s)${x}(\b|$|\s)`, "i"));

  return junk.some((x) => text.match(x));
}

export function unemojify(text: string): string {
  return text.replace(new RegExp(emoji, "ig"), "");
}

export function parseArtists(text?: string): string[] {
  if (!text) return [];
  text = text.replace(/ - Topic$/i, "");
  const joins = /,|\bft\.?|\bfeat\.?|&|\+|\/|\bfeaturing|\bmed\b|\band\b/i;

  return [
    ...new Set(
      text
        .split(joins)
        .map((x) => trim(x))
        .filter((x) => x)
    ),
  ];
}

export function toYear(text: string): [string, number] | null {
  const regex = /(^|\b)([1-2][0-9]{3})(\b|$)/;
  const match = text.match(regex);
  if (!match) return null;
  const year = +(match[0] || 0) || null;
  if (!year) return null;
  return [trim(text.replace(match[0], "")), year];
}

export function toArtist(text: string): [string, string[]] {
  const postfixes = [
    "edit(ed)?",
    "rmx",
    "remix",
    "version(\\s+cover)?",
    "ver(\\s+cover)?",
    "cover",
    "dub",
    "release",
  ];
  const prefixes = [
    "edit(ed)?",
    "rmx",
    "remix(ed)?",
    "cover(ed)?",
    "performed",
    "ft\\.",
    "feat\\.?",
    "featuring",
    "med",
    "(piano\\s+)?arrangement",
    "by",
  ];

  const regexes = [];
  regexes.push(
    ...postfixes.map((x) => new RegExp(r`^(?<artist>.*?)\s+${x}(\b|$)`, "i"))
  );
  regexes.push(
    ...prefixes.map(
      (x) => new RegExp(r`(^|\b)${x}(\s+by)?\s+(?<artist>.*?)$`, "i")
    )
  );

  const artists = [];
  for (const regex of regexes) {
    const match = text.match(regex);
    const artist = match?.groups?.artist;
    if (!match || !artist) continue;
    artists.unshift(artist);
    text = trim(text.replace(match[0], ""));
  }

  return [text, artists];
}

export function split(text: string): string[] {
  const url =
    /[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
  const splits = new RegExp(separators.join("|"), "i");
  return text.replace(url, "").split(splits);
}

export function trim(text: string): string {
  const trim = /^[@'"`«»|—\-–/\\:\s.]+|['"`«»|—\-–/\\:\s.]+$/gi;
  return text.replace(trim, "");
}

export function isGenere(text: string, strict: boolean = false): boolean {
  text = text.toLowerCase();
  const genres = require("../../../../assets/genres.json") as string[];

  if (strict) return genres.some((x) => x.toLowerCase() === text);
  return genres.some((x) =>
    text.match(new RegExp(r`(\s|^)${x.toLowerCase()}(\s|$)`))
  );
}

export default function parse(text: string): IParsed {
  const { parts, clean } = unbrace(text);
  let atoms = [...split(clean), ...parts].filter((x) => x);
  atoms = [...new Set(atoms)];
  atoms = atoms.map((x) => trim(x)).filter((x) => x);

  let title = clean;
  let album = "";
  let year = undefined;
  let artists = [];
  let meta = [] as string[];

  atoms = atoms.map((x) => {
    x = unemojify(x);
    const tryYear = toYear(x);
    if (tryYear) {
      x = tryYear[0];
      year = tryYear[1];
      if (!x) return "";
    }

    const parsedArtists = toArtist(x);
    x = parsedArtists[0];
    for (const artist of parsedArtists[1]) {
      artists.push(...parseArtists(artist));
    }

    if (isJunk(x)) {
      return "";
    }

    if (parts.includes(x)) {
      meta.push(x);
      return "";
    }

    return x;
  });
  atoms = atoms.filter((x) => x);

  switch (atoms.length) {
    case 0:
      title = [...split(clean)].filter((x) => !isJunk(x)).join("; ");
      if (!title) title = clean;
      if (!title) title = parts.join("; ");
      if (!title) title = text;
      break;
    case 1:
      title = atoms[0];
      break;
    case 2:
      artists.unshift(...parseArtists(atoms[0]));
      title = atoms[1];
      break;
    default:
      artists.unshift(...parseArtists(atoms[0]));
      title = atoms[1];
      meta.push(...atoms.slice(2, atoms.length - 1));
      album = atoms[atoms.length - 1];
      break;
  }

  meta = meta.filter((x) => !isGenere(x));
  artists = artists
    .map((x) => trim(x))
    .filter((x) => !isJunk(x) && !isGenere(x, true));

  album = album || title;
  if (meta.length) title += ` (${meta.join(", ")})`;

  return {
    title,
    artists,
    album,
    year,
  };
}

interface IUnbraced {
  clean: string;
  parts: string[];
}

interface IParsed {
  title: string;
  artists: string[];
  album: string;
  year?: number;
}
