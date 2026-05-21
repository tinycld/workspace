package translate

import "math"

// Font size conversion between OOXML half-points and CSS pixels.
//
// Word stores <w:sz w:val="N"/> where N is half-points (so val=24 means
// 12pt). One typographic point is 1/72 inch; at 96 CSS DPI that's
// 96/72 = 4/3 px per point, or 2/3 px per half-point.
//
// We round to the nearest integer pixel on import so a value typed into
// the editor (px) round-trips byte-stable through the dropdown set —
// see TestFontSizeRoundTripIntegerPx for the cases.
const (
	// pxPerHalfPoint = 96/144 = 2/3. Kept as numerator/denominator
	// constants so the rounding direction is explicit in the helpers.
	pxPerInch       = 96
	pointsPerInch   = 72
	halfPointsPerPt = 2
)

// HalfPointsToPx converts an OOXML half-points size (the value Word
// writes into <w:sz w:val="…"/>) into the nearest integer CSS pixel.
// Negative or zero input returns 0 so the caller can treat "absent"
// uniformly with "explicitly zero" — both mean "no fontSize attr".
func HalfPointsToPx(halfPoints int) int {
	if halfPoints <= 0 {
		return 0
	}
	v := float64(halfPoints) * float64(pxPerInch) / float64(pointsPerInch*halfPointsPerPt)
	return int(math.Round(v))
}

// PxToHalfPoints converts an integer CSS pixel size into the nearest
// OOXML half-points value (suitable for <w:sz w:val="…"/>). Non-
// positive input returns 0 — the caller decides whether to omit the
// element when the result is 0.
func PxToHalfPoints(px int) int {
	if px <= 0 {
		return 0
	}
	v := float64(px) * float64(pointsPerInch*halfPointsPerPt) / float64(pxPerInch)
	return int(math.Round(v))
}

