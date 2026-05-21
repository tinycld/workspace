package calc

import (
	"tinycld.org/packages/calc/render"
)

// workbookForRender converts the calc package's WorkbookModel into
// the renderer's input shape. This shim exists so the render
// subpackage stays free of any dependency on calc's wire types —
// renderer changes don't propagate to the wider package and vice
// versa.
//
// The conversion is structural: every field the renderer uses gets
// copied; fields the renderer ignores (RowCount, Merges, frozen
// rows, conditional formats, etc.) are dropped at the boundary.
// Adding a render-relevant field on either side starts here.
func workbookForRender(in WorkbookModel) render.Workbook {
	out := render.Workbook{
		Sheets: make([]render.Worksheet, 0, len(in.Sheets)),
	}
	for _, s := range in.Sheets {
		ws := render.Worksheet{
			Name:   s.Name,
			Hidden: s.Hidden,
		}
		if len(s.Cells) > 0 {
			ws.Cells = make(map[string]render.Cell, len(s.Cells))
			for key, cell := range s.Cells {
				ws.Cells[key] = render.Cell{
					Display: cell.Display,
					Style:   cellStyleForRender(cell.Style),
				}
			}
		}
		if len(s.Merges) > 0 {
			ws.Merges = make([]render.MergeRange, 0, len(s.Merges))
			for _, m := range s.Merges {
				ws.Merges = append(ws.Merges, render.MergeRange{
					AnchorRow: m.AnchorRow,
					AnchorCol: m.AnchorCol,
					RowSpan:   m.RowSpan,
					ColSpan:   m.ColSpan,
				})
			}
		}
		if len(s.ColWidths) > 0 {
			ws.ColWidths = make(map[int]int, len(s.ColWidths))
			for col, px := range s.ColWidths {
				ws.ColWidths[col] = px
			}
		}
		out.Sheets = append(out.Sheets, ws)
	}
	return out
}

func cellStyleForRender(in *CellStyle) *render.CellStyle {
	if in == nil {
		return nil
	}
	out := &render.CellStyle{}
	if in.Font != nil {
		out.Font = &render.CellFont{
			Bold:      in.Font.Bold,
			Italic:    in.Font.Italic,
			Underline: in.Font.Underline,
			Strike:    in.Font.Strike,
			Size:      in.Font.Size,
			Name:      in.Font.Name,
			Color:     in.Font.Color,
		}
	}
	if in.Fill != nil {
		out.Fill = &render.CellFill{
			FgColor: in.Fill.FgColor,
			BgColor: in.Fill.BgColor,
		}
	}
	if in.Alignment != nil {
		out.Alignment = &render.CellAlignment{
			Horizontal: in.Alignment.Horizontal,
			Vertical:   in.Alignment.Vertical,
			WrapText:   in.Alignment.WrapText,
		}
	}
	if in.Borders != nil {
		out.Borders = &render.CellBorders{
			Top:    edgeForRender(in.Borders.Top),
			Right:  edgeForRender(in.Borders.Right),
			Bottom: edgeForRender(in.Borders.Bottom),
			Left:   edgeForRender(in.Borders.Left),
		}
	}
	return out
}

func edgeForRender(in *CellBorderEdge) *render.CellBorderEdge {
	if in == nil {
		return nil
	}
	return &render.CellBorderEdge{
		Style:   in.Style,
		Color:   in.Color,
		IsClear: in.IsClear,
	}
}
