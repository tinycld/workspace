package translate

import (
	"encoding/xml"
	"math"
	"strconv"

	"github.com/ZeroHawkeye/wordZero/pkg/document"
)

// cellBorderAttr is the structured shape of the `borders` attribute we
// attach to tableCell / tableHeader PM nodes. Mirrors the TS-side
// CellBorders / CellBorder shape in @tinycld/text/lib/cell-borders.ts.
//
// JSON tag names match the camelCase used in the editor JSON; both the
// importer (we emit this struct, JSON encodes it via map[string]any
// round-trip below) and the emitter (we read it back from those maps)
// agree on the shape.
type cellBorderAttr struct {
	Top    *cellEdge `json:"top,omitempty"`
	Right  *cellEdge `json:"right,omitempty"`
	Bottom *cellEdge `json:"bottom,omitempty"`
	Left   *cellEdge `json:"left,omitempty"`
}

type cellEdge struct {
	Style   string `json:"style"`
	WidthPx int    `json:"widthPx"`
	Color   string `json:"color,omitempty"`
}

// parseTcBorders reads <w:tcBorders> off the current decoder cursor and
// returns a map ready to assign as the `borders` PM attr. The OOXML
// w:tcBorders contains top/start/bottom/end (and optionally
// insideH/insideV at the table level; we ignore those at the cell
// level — cells get only the edge borders). Returns nil when none of
// the four edges have a usable value.
//
// OOXML uses w:start / w:end for left/right in newer Word versions
// (locale-aware); older versions write w:left / w:right. Accept both.
func parseTcBorders(dec *xml.Decoder, start xml.StartElement) (map[string]any, error) {
	borders := &cellBorderAttr{}
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			edge := decodeBorderEdge(t)
			if edge != nil {
				switch t.Name.Local {
				case "top":
					borders.Top = edge
				case "bottom":
					borders.Bottom = edge
				case "left", "start":
					borders.Left = edge
				case "right", "end":
					borders.Right = edge
				}
			}
			if err := skipElement(dec, t); err != nil {
				return nil, err
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				if borders.Top == nil && borders.Right == nil &&
					borders.Bottom == nil && borders.Left == nil {
					return nil, nil
				}
				return bordersToAttr(borders), nil
			}
		}
	}
}

// decodeBorderEdge reads one w:top / w:start / w:bottom / w:end element
// into a cellEdge. Returns nil when the edge is `val="nil"` or `none` —
// Word's way of saying "explicitly no border here". A nil cellEdge in
// our shape will still serialize as `border-X: none` once it reaches
// the editor (see cell-borders.ts bordersToInlineStyleString).
//
// w:sz is in 1/8 of a point. We convert to whole CSS pixels assuming
// 96dpi: sz / 8 (= points) * (96 / 72) ≈ sz * 0.1667. Round up so a
// hair-thin Word border (sz=2 = 0.25pt) renders as at least 1px.
func decodeBorderEdge(start xml.StartElement) *cellEdge {
	val := attrValue(start, "val")
	if val == "" || val == "nil" || val == "none" {
		return &cellEdge{Style: "none"}
	}
	style := mapBorderStyle(val)
	szStr := attrValue(start, "sz")
	sz, _ := strconv.Atoi(szStr)
	widthPx := 1
	if sz > 0 {
		// sz / 8 points → pixels at 96dpi.
		widthPx = int(math.Ceil(float64(sz) / 8.0 * 96.0 / 72.0))
		if widthPx < 1 {
			widthPx = 1
		}
	}
	color := attrValue(start, "color")
	colorOut := ""
	if color != "" && color != "auto" {
		colorOut = "#" + color
	}
	return &cellEdge{Style: style, WidthPx: widthPx, Color: colorOut}
}

// mapBorderStyle maps OOXML's ST_Border enum to the much smaller CSS
// border-style subset we represent. Word has dozens of decorative
// variants (threeDEmboss, wave, dashSmallGap, …); we collapse them all
// to 'solid' since CSS has no equivalent and we'd otherwise drop the
// border entirely. The four CSS-native styles round-trip cleanly.
func mapBorderStyle(val string) string {
	switch val {
	case "none", "nil":
		return "none"
	case "dashed", "dashSmallGap", "dashDotStroked":
		return "dashed"
	case "dotted":
		return "dotted"
	case "double", "doubleWave":
		return "double"
	default:
		return "solid"
	}
}

// bordersToAttr returns the borders struct as a map[string]any tree —
// the shape PMNode.Attrs uses end-to-end. Encoding as a map (rather
// than the typed struct) keeps it symmetric with how every other PM
// attr is shaped, and lets the yjs bridge JSON-marshal it without
// special cases.
func bordersToAttr(b *cellBorderAttr) map[string]any {
	out := map[string]any{}
	if b.Top != nil {
		out["top"] = edgeToMap(b.Top)
	} else {
		out["top"] = nil
	}
	if b.Right != nil {
		out["right"] = edgeToMap(b.Right)
	} else {
		out["right"] = nil
	}
	if b.Bottom != nil {
		out["bottom"] = edgeToMap(b.Bottom)
	} else {
		out["bottom"] = nil
	}
	if b.Left != nil {
		out["left"] = edgeToMap(b.Left)
	} else {
		out["left"] = nil
	}
	return out
}

func edgeToMap(e *cellEdge) map[string]any {
	out := map[string]any{
		"style":   e.Style,
		"widthPx": e.WidthPx,
	}
	if e.Color != "" {
		out["color"] = e.Color
	} else {
		out["color"] = nil
	}
	return out
}

// tcBordersFromAttr builds a WordZero TableCellBorders from the
// `borders` PM attr. Returns nil when the attr is missing, the wrong
// shape, or all four edges are nil (no border data). The emitter
// attaches the result to TableCellProperties.TcBorders if non-nil.
//
// Width conversion is the inverse of decodeBorderEdge: px → 1/8 point.
// w:sz="8" = 1pt = "thin" Word border, which is also the common
// default. We clamp to >= 4 (≈ 0.5pt) so editors that emit a 0px
// border (effectively "hairline") still produce a visible Word line.
func tcBordersFromAttr(attrs map[string]any) *document.TableCellBorders {
	raw, ok := attrs["borders"].(map[string]any)
	if !ok {
		return nil
	}
	out := &document.TableCellBorders{}
	if e := edgeFromAttr(raw["top"]); e != nil {
		out.Top = e
	}
	if e := edgeFromAttr(raw["right"]); e != nil {
		out.Right = e
	}
	if e := edgeFromAttr(raw["bottom"]); e != nil {
		out.Bottom = e
	}
	if e := edgeFromAttr(raw["left"]); e != nil {
		out.Left = e
	}
	if out.Top == nil && out.Right == nil && out.Bottom == nil && out.Left == nil {
		return nil
	}
	return out
}

func edgeFromAttr(raw any) *document.TableCellBorder {
	m, ok := raw.(map[string]any)
	if !ok || m == nil {
		return nil
	}
	style, _ := m["style"].(string)
	if style == "" {
		return nil
	}
	width := 1
	if v, ok := m["widthPx"].(float64); ok {
		width = int(v)
	} else if v, ok := m["widthPx"].(int); ok {
		width = v
	}
	color, _ := m["color"].(string)

	if style == "none" {
		return &document.TableCellBorder{Val: "nil"}
	}

	// px → 1/8 point: px * 72 / 96 * 8 = px * 6
	sz := width * 6
	if sz < 4 {
		sz = 4
	}
	out := &document.TableCellBorder{
		Val: cssStyleToBorderVal(style),
		Sz:  strconv.Itoa(sz),
	}
	if color != "" {
		// Strip leading '#' if present; Word stores colors as raw RRGGBB.
		if len(color) > 0 && color[0] == '#' {
			color = color[1:]
		}
		out.Color = color
	} else {
		out.Color = "auto"
	}
	return out
}

func cssStyleToBorderVal(style string) string {
	switch style {
	case "dashed":
		return "dashed"
	case "dotted":
		return "dotted"
	case "double":
		return "double"
	default:
		return "single"
	}
}
