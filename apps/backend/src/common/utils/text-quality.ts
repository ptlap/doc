export interface TextQualityMetrics {
  totalCharacters: number;
  totalWhitespace: number;
  nonWhitespaceCharacters: number;
  whitespaceRatio: number; // 0..1
  charactersPerPage: number; // avg
  nonPrintableRatio: number; // 0..1
  uniqueCharacterRatio: number; // 0..1
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function computeTextQualityMetrics(
  rawText: unknown,
  numPagesUnknown: unknown,
): TextQualityMetrics {
  const text: string = typeof rawText === 'string' ? rawText : '';
  const numPages: number = isFinitePositiveNumber(numPagesUnknown)
    ? Math.max(1, Math.floor(numPagesUnknown))
    : 1;

  const totalCharacters = text.length;
  const totalWhitespace = (text.match(/\s/g) || []).length;
  const nonWhitespaceCharacters = Math.max(
    0,
    totalCharacters - totalWhitespace,
  );
  const whitespaceRatio =
    totalCharacters > 0 ? totalWhitespace / totalCharacters : 1;
  const charactersPerPage = nonWhitespaceCharacters / numPages;

  // Approximate non-printable ratio (control chars excluding standard whitespace)
  let nonPrintableCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // 0..8, 11, 12, 14..31, 127
    const isControl =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127;
    if (isControl) nonPrintableCount++;
  }
  const nonPrintableRatio =
    totalCharacters > 0 ? nonPrintableCount / totalCharacters : 0;

  // Unique character ratio as a proxy for font/text variety (higher tends to be real text)
  const uniqueChars = new Set(text.replace(/\s/g, '').split(''));
  const uniqueCharacterRatio =
    nonWhitespaceCharacters > 0
      ? uniqueChars.size / nonWhitespaceCharacters
      : 0;

  return {
    totalCharacters,
    totalWhitespace,
    nonWhitespaceCharacters,
    whitespaceRatio: clamp01(whitespaceRatio),
    charactersPerPage,
    nonPrintableRatio: clamp01(nonPrintableRatio),
    uniqueCharacterRatio: clamp01(uniqueCharacterRatio),
  };
}

export function computeBornDigitalConfidence(
  metrics: TextQualityMetrics,
): number {
  // Heuristics tuned for printed PDFs: ~1200+ non-whitespace characters/page is strong
  const densityScore = clamp01(metrics.charactersPerPage / 1200);

  // Ideal whitespace ratio ~0.15-0.30
  const whitespaceCenter = 0.22;
  const whitespaceTolerance = 0.15;
  const whitespaceDeviation = Math.abs(
    metrics.whitespaceRatio - whitespaceCenter,
  );
  const whitespaceScore = clamp01(
    1 - whitespaceDeviation / whitespaceTolerance,
  );

  // Fewer non-printables indicates cleaner text
  const printableScore = clamp01(1 - metrics.nonPrintableRatio * 5);

  // Some variety in characters (avoids repeated garbage)
  const varietyScore = clamp01(metrics.uniqueCharacterRatio / 0.12);

  // Weighted aggregate
  const confidence =
    0.55 * densityScore +
    0.2 * whitespaceScore +
    0.15 * printableScore +
    0.1 * varietyScore;

  return clamp01(confidence);
}

export function shouldUseDirectExtraction(
  confidence: unknown,
  thresholdUnknown?: unknown,
): boolean {
  const conf = isFinitePositiveNumber(confidence) ? confidence : 0;
  const threshold = isFinitePositiveNumber(thresholdUnknown)
    ? thresholdUnknown
    : 0.8;
  return conf >= threshold;
}
