// Deterministic Serbian Cyrillic → Latin map. Whisper Serbian fine-tunes often
// emit Cyrillic; everything downstream (intent parsing, name matching) works
// on latinica, so transcripts are normalized here. Digraphs (љ→lj, њ→nj,
// џ→dž) are single Cyrillic characters — a plain char map handles them.
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z',
  И: 'I', Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj', О: 'O',
  П: 'P', Р: 'R', С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C',
  Ч: 'Č', Џ: 'Dž', Ш: 'Š'
}

export function toLatin(s: string): string {
  let out = ''
  for (const ch of s) out += MAP[ch] ?? ch
  return out
}
