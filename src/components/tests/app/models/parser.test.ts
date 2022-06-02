import parse, { parseArtists, unbrace } from "../../../app/models/parser";

describe("Parser", () => {
  it("unbrace", () => {
    expect(unbrace("clean (hello)")).toEqual({
      clean: "clean",
      parts: ["hello"],
    });

    expect(unbrace("clean [hello)")).toEqual({
      clean: "clean",
      parts: ["hello"],
    });

    expect(unbrace("clean ([)h(ello)")).toEqual({
      clean: "clean  - h",
      parts: ["ello"],
    });

    expect(unbrace("clean [text (here)]")).toEqual({
      clean: "clean",
      parts: ["text here"],
    });
  });

  it("parseTitles", () => {
    let val = parse(
      "Game of Thrones Theme Song - Karliene Version Cover (Oh La Lau) (Lyrics)"
    );
    expect(val.title).toBe("Game of Thrones Theme Song (Oh La Lau)");
    expect(val.artists).toEqual(["Karliene"]);

    val = parse(
      "Lau - Game of Thrones Theme - Karliene Version Cover (Audio Only)"
    );
    expect(val.title).toBe("Game of Thrones Theme");
    expect(val.artists).toEqual(["Lau", "Karliene"]);

    val = parse(
      "Karliene & Celtic Borders - You Win or You Die - Game of Thrones"
    );
    expect(val.title).toBe("You Win or You Die");
    expect(val.artists).toEqual(["Karliene", "Celtic Borders"]);
    expect(val.album).toBe("Game of Thrones");

    val = parse('"Pollution" by Tom Lehrer');
    expect(val.title).toBe("Pollution");
    expect(val.artists).toEqual(["Tom Lehrer"]);

    val = parse("Man with no name - Teleport (Original mix). HQ");
    expect(val.title).toBe("Teleport");
    expect(val.artists).toEqual(["Man with no name"]);

    val = parse("Varg  — Under Beige Nylon");
    expect(val.title).toBe("Under Beige Nylon");
    expect(val.artists).toEqual(["Varg"]);

    val = parse("varg - under beige nylon - 46bpm");
    expect(val.title).toBe("under beige nylon");
    expect(val.artists).toEqual(["varg"]);

    val = parse("Falling in drop C.");
    expect(val.title).toBe("Falling in drop C");
    expect(val.artists).toEqual([]);

    val = parse("Voodoo People - Quadsep - 1995");
    expect(val.year).toBe(1995);
    expect(val.title).toBe("Quadsep");
    expect(val.artists).toEqual(["Voodoo People"]);

    val = parse("Teste - The Wipe (5am Synaptic) - Plus 8 Records - 1992");
    expect(val.year).toBe(1992);
    expect(val.title).toBe("The Wipe (5am Synaptic)");
    expect(val.artists).toEqual(["Teste"]);
    expect(val.album).toBe("Plus 8 Records");

    val = parse("Varg | I Did Not Always Appear This Way [Ascetic House 2015]");
    expect(val.year).toBe(2015);
    expect(val.title).toBe("I Did Not Always Appear This Way");
    expect(val.artists).toEqual(["Varg"]);

    val = parse("Pig&Dan -The Saint Job San (Lee Van Dowski Remix)");
    expect(val.title).toBe("The Saint Job San");
    expect(val.artists).toEqual(["Pig", "Dan", "Lee Van Dowski"]);

    val = parse(
      "Ambi Sessions 12/11 {Ambient Techno-Tribal-Dub Techno-Meditative}"
    );
    expect(val.title).toBe("Ambi Sessions 12/11");
    expect(val.artists).toEqual([]);

    val = parse("PILLDRIVER // PITCH HIKER");
    expect(val.title).toBe("PITCH HIKER");
    expect(val.artists).toEqual(["PILLDRIVER"]);

    val = parse("Wu-Tang Clan -- One Blood instrumental");
    expect(val.title).toBe("One Blood instrumental");
    expect(val.artists).toEqual(["Wu-Tang Clan"]);

    val = parse('Mobb Deep "Peer Pressure"');
    expect(val.title).toBe("Peer Pressure");
    expect(val.artists).toEqual(["Mobb Deep"]);

    val = parse("The Prodigy - Voodoo People ( Parasense Rmx )");
    expect(val.title).toBe("Voodoo People");
    expect(val.artists).toEqual(["The Prodigy", "Parasense"]);

    val = parse('Giselle "Silk" Favored Nations Remix');
    expect(val.title).toBe("Silk");
    expect(val.artists).toEqual(["Giselle", "Favored Nations"]);

    val = parse("WITCHER 3 SONG- Wake The White Wolf By Miracle Of Sound");
    expect(val.title).toBe("Wake The White Wolf");
    expect(val.artists).toEqual(["WITCHER 3 SONG", "Miracle Of Sound"]);

    val = parse(
      "Miracle Of Sound - The Call - Elder Scrolls Online Song [pleer.com]"
    );
    expect(val.title).toBe("The Call");
    expect(val.artists).toEqual(["Miracle Of Sound"]);
    expect(val.album).toBe("Elder Scrolls Online Song");

    val = parse("Ambitiously Yours - S6E5 - New Friends and a Funeral");
    expect(val.title).toBe("New Friends and a Funeral");
    expect(val.artists).toEqual(["Ambitiously Yours"]);

    val = parse("Party in Peril: The Celestial Odyssey 06 (Oficial Audio)");
    expect(val.title).toBe("The Celestial Odyssey 06");
    expect(val.artists).toEqual(["Party in Peril"]);

    val = parse("Abandoned - Out Of The Grave (Feat. ENROSA) [NCS Release]");
    expect(val.title).toBe("Out Of The Grave");
    expect(val.artists).toEqual(["Abandoned", "ENROSA", "NCS"]);

    val = parse("Ali Sethi | Rung (Official Music Video)");
    expect(val.title).toBe("Rung");
    expect(val.artists).toEqual(["Ali Sethi"]);

    val = parse(
      "Bruno Mars, Anderson .Paak, Silk Sonic - Leave the Door Open [Official Video]"
    );
    expect(val.title).toBe("Leave the Door Open");
    expect(val.artists).toEqual(["Bruno Mars", "Anderson .Paak", "Silk Sonic"]);

    val = parse(
      "Galasy ZMesta - Ya Nauchu Tebya (I'll Teach You) - Belarus - Official Video - Eurovision 2021"
    );
    expect(val.title).toBe("Ya Nauchu Tebya (I'll Teach You, Belarus)");
    expect(val.year).toBe(2021);
    expect(val.album).toBe("Eurovision");
    expect(val.artists).toEqual(["Galasy ZMesta"]);

    val = parse(
      "Game Of Thrones Theme (Music Box Vocal Version -- Cover of Karliene Lyrics)"
    );
    expect(val.title).toBe("Game Of Thrones Theme");
    expect(val.artists).toEqual(["Music Box Vocal"]);

    val = parse(
      "🎵MiatriSs🎵 - Yandere Song (The Original Song) [Русская Версия] + ENG Subtitles"
    );
    expect(val.title).toBe("Yandere Song (Русская Версия)");
    expect(val.artists).toEqual(["MiatriSs"]);

    val = parse(
      "【Helltaker Original Song】 What the Hell by @OR3O , @Lollia  , and @Sleeping Forest   ft. Friends"
    );
    expect(val.title).toBe("What the Hell");
    expect(val.artists).toEqual([
      "OR3O",
      "Lollia",
      "Sleeping Forest",
      "Friends",
    ]);

    val = parse("Splatoon ★ Blitz It (Remix\\Cover) | MiatriSs");
    expect(val.title).toBe("Blitz It (Remix\\Cover)");
    expect(val.artists).toEqual(["Splatoon"]);
    expect(val.album).toEqual("MiatriSs");

    val = parse("ECHO【Gumi English】Crusher-P: MiatriSs Remix");
    expect(val.title).toBe("Crusher-P (Gumi English)");
    expect(val.artists).toEqual(["ECHO", "MiatriSs"]);

    val = parse(
      "Endless Mistakes Cover - check out the original at https://soundcloud.com/"
    );
    expect(val.title).toBe("Endless Mistakes Cover");
    expect(val.album).toBe("Endless Mistakes Cover");
    expect(val.artists).toEqual(["Endless Mistakes"]);

    val = parse("Rihanna - The Monster (NO RAP/NO EMINEM) Edit +Lyrics");
    expect(val.title).toBe("The Monster (NO RAP/NO EMINEM)");
    expect(val.artists).toEqual(["Rihanna"]);

    val = parse(
      "Fall - Ross Bugden ''Piano Tutorial'' (Piano Arrangement by AnubisMusic)"
    );
    expect(val.title).toBe("Ross Bugden");
    expect(val.album).toBe("Ross Bugden");
    expect(val.artists).toEqual(["Fall", "AnubisMusic"]);

    val = parse("Karliene. - Elizabeth");
    expect(val.title).toBe("Elizabeth");
    expect(val.artists).toEqual(["Karliene"]);

    val = parse(
      "My Darkest Days - Porn Star Dancing (Rock Version) ft. Zakk Wylde (Official Video)"
    );
    expect(val.title).toBe("Porn Star Dancing (Rock Version)");
    expect(val.album).toBe("Porn Star Dancing");
    expect(val.artists).toEqual(["My Darkest Days", "Zakk Wylde"]);

    val = parse("Epic Trailer Music - Fall", true);
    expect(val.title).toBe("Fall");
    expect(val.album).toBe("Epic Trailer Music");
    expect(val.artists).toEqual([]);

    val = parse("Epic Trailer Music - Fall - Nice Thing", true);
    expect(val.title).toBe("Fall (Nice Thing)");
    expect(val.album).toBe("Epic Trailer Music");
    expect(val.artists).toEqual([]);

    val = parse(
      "Epic and Dramatic Trailer Music - Olympus (Copyright and Royalty Free)",
      true
    );
    expect(val.title).toBe("Olympus");
    expect(val.album).toBe("Epic and Dramatic Trailer Music");
    expect(val.artists).toEqual([]);

    val = parse('I:Scintilla - "Swimmers Can Drown" OFFICIAL VIDEO');
    expect(val.title).toBe("Swimmers Can Drown");
    expect(val.album).toBe("Swimmers Can Drown");
    expect(val.artists).toEqual(["I:Scintilla"]);

    val = parse("The Pretty Reckless - Make Me Wanna Die (Acoustic Version)");
    expect(val.title).toBe("Make Me Wanna Die (Acoustic Version)");
    expect(val.album).toBe("Make Me Wanna Die");
    expect(val.artists).toEqual(["The Pretty Reckless"]);

    val = parse("Rock - Rock Song - Under a Rock");
    expect(val.title).toBe("Rock Song");
    expect(val.album).toBe("Under a Rock");
    expect(val.artists).toEqual(["Rock"]);
  });

  it("parseArtists", () => {
    expect(parseArtists("A & B")).toEqual(["A", "B"]);
    expect(parseArtists("A,B ,C feat. D")).toEqual(["A", "B", "C", "D"]);
    expect(parseArtists("A + 1")).toEqual(["A", "1"]);
    expect(parseArtists("lol/KEK")).toEqual(["lol", "KEK"]);
    expect(parseArtists("0///A+B,feat.D")).toEqual(["0", "A", "B", "D"]);
    expect(parseArtists("Amedoand and ft Smb")).toEqual(["Amedoand", "Smb"]);
  });
});
