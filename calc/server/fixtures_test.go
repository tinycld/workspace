package calc

// tinyXlsxPath points at the user-curated fixture under
// calc/tests/assets. It's read with os.ReadFile (not go:embed)
// because go:embed paths cannot escape the containing package.
const tinyXlsxPath = "../tests/assets/tiny.xlsx"
